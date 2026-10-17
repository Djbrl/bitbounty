import { App } from "@octokit/app";

export interface GithubAppEnv {
  GITHUB_APP_ID?: string;
  GITHUB_PRIVATE_KEY?: string;
  GITHUB_WEBHOOK_SECRET?: string;
}

export interface GithubAppConfig {
  appId: string;
  privateKey: string;
  webhookSecret: string;
}

/**
 * Reads the GitHub App config from env. The private key may be pasted as a single
 * line with literal `\n` (Railway / .env style) or base64-encoded PEM.
 */
export function readGithubAppConfig(env: GithubAppEnv = process.env): GithubAppConfig {
  const missing = (["GITHUB_APP_ID", "GITHUB_PRIVATE_KEY", "GITHUB_WEBHOOK_SECRET"] as const).filter(
    (k) => !env[k],
  );
  if (missing.length) throw new Error(`Missing env: ${missing.join(", ")} (see docs/github-app.md)`);
  return {
    appId: env.GITHUB_APP_ID!,
    privateKey: normalizePrivateKey(env.GITHUB_PRIVATE_KEY!),
    webhookSecret: env.GITHUB_WEBHOOK_SECRET!,
  };
}

export function normalizePrivateKey(key: string): string {
  const k = key.trim();
  if (k.includes("BEGIN")) return k.replace(/\\n/g, "\n").trim();
  return Buffer.from(k, "base64").toString("utf8").trim();
}

/**
 * GitHub App client. Use `app.getInstallationOctokit(event.installationId)` in
 * handlers to comment, label (G3) or create check runs (A2) as the bot.
 */
export function createGithubApp(config: GithubAppConfig = readGithubAppConfig()): App {
  return new App({
    appId: config.appId,
    privateKey: config.privateKey,
    webhooks: { secret: config.webhookSecret },
  });
}
