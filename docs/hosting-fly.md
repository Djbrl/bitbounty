# Hosting the API on Fly.io (handoff)

Goal: move the API server and its database off Jib's Mac. After this, the Mac runs nothing.

| Piece | Today (Mac) | After |
|---|---|---|
| API server | Docker `server` container | Fly.io app `bitbounty-api` (this repo's `Dockerfile` + `fly.toml`) |
| Database | Docker `db` (Postgres 16) | Neon Postgres (free tier) |
| Public URL | Cloudflare quick tunnel (changes on restart) | `https://bitbounty-api.fly.dev` (stable) |
| GitHub webhooks | smee.io relay → Mac | GitHub App → Fly directly |
| Bitnob calls | Mac's IP (changes with the Wi-Fi) | Fly static egress IP (fixed) |
| Web app | Vercel `bitbounty-app` | unchanged, only `NEXT_PUBLIC_API_URL` changes |

Cost: about $7/month on Fly (small machine about $3–4 + static egress IP about $3.60), Neon free. Fly's free trial is not enough: trial machines stop after 5 minutes and run 2 hours at most, so add a card.

Steps marked **(you)** need your logins, a card or 2FA. Everything else can be run by Claude Code from `~/code-chain-dakar/bitbounty`.
Commands are for fish. Never paste a secret in a chat: copy it to the clipboard and use the `pbpaste` commands below.

---

## 1. Accounts (you)

1. Install the Fly CLI and sign in. Then add a card in the Fly dashboard → Billing.
   ```fish
   brew install flyctl
   fly auth login
   ```
2. Create a Neon account at neon.tech, then a project named `bitbounty` in the **AWS Europe Central 1 (Frankfurt)** region (the Fly app runs in `fra`).
   Copy the **direct** connection string (not the pooled one). It looks like `postgresql://…@….eu-central-1.aws.neon.tech/neondb?sslmode=require`.

## 2. Create the Fly app

```fish
cd ~/code-chain-dakar/bitbounty
fly apps create bitbounty-api
```
If the name is taken, pick another one and change `app = …` in `fly.toml` (and every `bitbounty-api.fly.dev` below).

## 3. Static egress IP for Bitnob

Bitnob only accepts calls from allowlisted IPs.
```fish
fly ips allocate-egress --app bitbounty-api --region fra
fly ips list --app bitbounty-api
```
If `allocate-egress` is unknown or its flags differ, check `fly ips --help`; Fly's docs: https://fly.io/docs/networking/egress-ips. Use the **app-scoped** kind, which survives machine re-creation.

**(you)** In the Bitnob dashboard → API keys → `bitbounty-server-sandbox` → Allowed IPs, add the egress IPv4 (and the IPv6 if Bitnob accepts it). This needs your Touch ID / TOTP. Keep the Mac's IPs until step 9.

## 4. Secrets

Import everything from the repo-root `.env`, except the smee relay (no longer used):
```fish
grep -v -e '^#' -e '^$' -e '^WEBHOOK_PROXY_URL=' .env | fly secrets import --app bitbounty-api --stage
```
Then the database. Copy the Neon connection string to the clipboard first:
```fish
pbpaste | sed 's/^/DATABASE_URL=/' | fly secrets import --app bitbounty-api --stage
printf '' | pbcopy
```
And the web URL the bot links to:
```fish
fly secrets set WEB_BASE_URL=https://bitbounty-app.vercel.app --app bitbounty-api --stage
```
`--stage` saves without restarting; the first deploy picks them up. Check names only (values stay hidden): `fly secrets list --app bitbounty-api`.

Optional:
- `DEV_PROXY_TOKEN` keeps the teammates' `/dev/bitnob` sandbox proxy on.
- `DEV_HOOK_TOKEN` stays unset, so `/dev/fund` stays off.

## 5. Copy the data (Mac → Neon)

Stop writes on the Mac first, so nothing is lost between the copy and the switch. The old server goes down here.
```fish
docker compose stop server smee
```
Then dump and restore. Copy the Neon string to the clipboard first:
```fish
set -lx NEON (pbpaste); printf '' | pbcopy
docker compose exec -T db pg_dump -U postgres -d bitbounty --no-owner --no-privileges \
  | docker run --rm -i -e NEON postgres:16-alpine sh -c 'psql "$NEON" -v ON_ERROR_STOP=1'
set -e NEON
```
The dump includes Drizzle's migration table, so the server won't re-run old migrations at start.
To start with an empty database instead, skip this step: the server runs its migrations on first boot.

## 6. Deploy

```fish
fly deploy --app bitbounty-api
curl -s https://bitbounty-api.fly.dev/health
```
Expect `{"status":"ok"}`. Logs: `fly logs --app bitbounty-api`. Look for `[db] migrations applied` and `listening`.

## 7. Point everything at Fly

1. **GitHub App (you)**: github.com → Settings → Developer settings → GitHub Apps → BitBounty Dakar → General → Webhook URL = `https://bitbounty-api.fly.dev/webhooks/github`. Keep the same webhook secret. Save.
2. **Bitnob webhook (you)**: Bitnob dashboard → Webhooks → `bitbounty-webhook2` → URL = `https://bitbounty-api.fly.dev/webhooks/bitnob`.
3. **Vercel**: project `bitbounty-app` → Settings → Environment Variables → set `NEXT_PUBLIC_API_URL` to `https://bitbounty-api.fly.dev` for Production, Preview and Development. Then redeploy from a clean `main`:
   ```fish
   cd ~/code-chain-dakar/bitbounty; and git switch main; and git pull; and vercel deploy --prod --yes
   ```
   `NEXT_PUBLIC_*` values are baked in at build time, so the redeploy is required.
4. **Teammates (only if they still use the sandbox proxy)**: `BITNOB_BASE_URL=https://bitbounty-api.fly.dev/dev/bitnob`.

## 8. Check end to end

- `https://bitbounty-app.vercel.app`: signing in works, `/app/explore` lists the projects, the old bounties show (if you copied the data).
- On a demo issue, comment `/bounty 1000`: the bot answers within seconds (GitHub → Fly works).
- Comment `/funded`: the bounty becomes funded (Fly → Bitnob works, so the egress IP is allowlisted).
- GitHub App → Advanced → Recent deliveries: recent deliveries are green (200).

## 9. Turn off the Mac (only after step 8 passes)

```fish
cd ~/code-chain-dakar/bitbounty
docker compose down
```
`down` keeps the `pgdata` volume, so the old database stays as a backup. Delete it only weeks later, once you're sure (`docker volume rm bitbounty_pgdata`).
**(you)** In Bitnob, remove the old Mac IPs from the allowlist (`37.168.163.180`, `41.83.144.121` and any later ones).
Optional: delete the smee channel and `WEBHOOK_PROXY_URL` from `.env`.

## Rollback

If something breaks after step 7:
1. Run `docker compose up -d` on the Mac.
2. Point the GitHub App webhook back to the smee URL in `.env` (`WEBHOOK_PROXY_URL`).
3. Set `NEXT_PUBLIC_API_URL` back to the tunnel URL and redeploy Vercel.

The tunnel URL changes when its container restarts; read it with `docker compose logs tunnel | grep trycloudflare`.

## Known gotchas

- **Bitnob 403 "IP address not whitelisted"**: the Fly egress IP isn't allowlisted (step 3), or the machine was created before the app-scoped IP. Run `fly ips list` and compare.
- **Webhook 401/invalid signature**: `GITHUB_WEBHOOK_SECRET` on Fly differs from the one in the GitHub App settings.
- **The bot replies twice**: smee and Fly are both receiving. Make sure the Mac's `smee` container is stopped.
- **Neon cold starts**: the free tier suspends the database when idle. The first request after a pause can take about a second; this is harmless.
- **Machine size**: 512 MB in `fly.toml`. If `fly logs` shows out-of-memory restarts, run `fly scale memory 1024 --app bitbounty-api`.
