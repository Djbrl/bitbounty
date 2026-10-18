# bitbounty-demo

Small helpers for **FCFA (XOF) amounts and Lightning sats**, with messages in English and French. No dependencies, Node 20+.

This is the demo repository of [BitBounty](https://github.com/Djbrl/bitbounty): some issues here are funded, and whoever fixes one is **paid in sats over Lightning** as soon as the PR is merged.

## Use it
```js
import { formatXof, formatSats, xofToSats } from "./src/fcfa.js";
import { t } from "./src/i18n.js";

formatXof(25000);              // "25 000 FCFA"
formatXof(1500000);            // "1 500 000 FCFA"
xofToSats(10000, 62_000_000);  // 16129 (rate in FCFA per bitcoin)
formatSats(16129);             // "16 129 sats"
t("fr", "welcome", { name: "Awa" }); // "Bienvenue, Awa !"
```

## Test
```sh
npm test   # node --test, nothing to install
```

## Earn sats on an issue
1. Find an issue with a 💰 label: it is funded, the money is already held.
2. Comment `/claim` on it. You have 72 hours (`/extend` for more).
3. Open a pull request that says `Fixes #<issue number>`. Check the **Done when** list of the issue: Claude checks your PR against it.
4. Once the maintainer merges, you are paid in sats to your Lightning Address, in a few seconds. Set it once at [bitbounty-app.vercel.app/me](https://bitbounty-app.vercel.app/me).

## Contributing
- One issue per pull request, with a test when you change code.
- Messages live in `locales/<language>.json`. Every file has the same keys as `en.json` (a test checks it).

## License
MIT
