# FlowScope

An options-flow scanner you can run on your own computer. Filter alerts by symbol, contract type, premium, expiration, sweeps and volume/open interest. Inspect contracts, save scanners, maintain a watchlist and import or export CSV snapshots.

**It starts with 64 clearly labeled synthetic sample alerts.** Live data requires your own Unusual Whales API subscription and token. No credentials or paid data are included.

## Run on your computer

Install [Node.js](https://nodejs.org/) 24 and [Git](https://git-scm.com/downloads), then run:

```sh
git clone https://github.com/LouisGou/flowscope.git
cd flowscope
npm ci
npm run dev
```

Open **http://localhost:3000** in Chrome or another browser. Windows, macOS and Linux use the same commands. You can also download the repository ZIP, extract it, open a terminal in that folder and run the last two commands.

Open the folder in Visual Studio Code to edit it. Stop the server with **Ctrl+C**.

## Let others view it on your Wi-Fi

```sh
npm run build
npm run share
```

The server prints a **Same-network viewing** address. Send that address to someone on the same Wi-Fi/network; they can open it in their browser without installing anything. Keep your computer awake and the server running. If prompted, allow the server through your firewall on your trusted private network. Guest Wi-Fi isolation, a VPN or a firewall can prevent access.

This address works only on the same network. People elsewhere can clone this repository and run their own copy. Shared mode serves the production build; after editing, stop it, rebuild and restart. Use `npm run start` to serve the production build on this computer only. `PORT` can override port 3000 in shared mode if needed.

## Connect market data

Choose **Connect a feed** and enter a token from an [Unusual Whales API subscription](https://unusualwhales.com/public-api). Ordinary website access may not include API access.

The server requests the documented `/api/option-trades/flow-alerts` endpoint, with up to 200 aggregated alerts. Auto-refresh polls every 60 seconds while the tab is visible. This is a snapshot scanner, not the complete trade tape or a tick-by-tick stream. Your provider's coverage, delays and entitlements apply. Failed refreshes keep the last successful snapshot with a warning; sample alerts are never substituted into a connected feed.

Tokens stay in the current tab's memory, pass through the local server to the provider and are never saved to browser storage, source files or application logs. Reloading requires reconnection. Each viewer supplies their own token; the server has no shared API key, database or account system. **Enter a token on your own localhost or an HTTPS deployment. Shared local-network HTTP is intended for sample/CSV viewing, because it does not encrypt browser-to-server traffic.** Imported data stays in the importing tab, so another viewer sees their own workspace.

Provider reference: [official flow-alert API specification](https://api.unusualwhales.com/docs/operations/PublicApi.OptionTradeController.flow_alerts).

## Import a snapshot

Choose **Import CSV**, paste data or choose a file. A downloadable template is available in the app and at [`public/flowscope-sample.csv`](public/flowscope-sample.csv).

Required columns:

| Column | Format |
| --- | --- |
| `ticker` | Symbol, e.g. `NVDA` |
| `type` | `call` or `put` |
| `expiry` | `YYYY-MM-DD` |
| `strike` | Positive number in USD |
| `time` | ISO timestamp with `Z` or a timezone offset |
| `premium` | Total alert premium in USD |
| `size` | Positive whole number of contracts |

Optional: `price`, `spot`, `volume`, `oi`, `ask_share`, `bid_share`, `sweep`, `floor`, `multileg`, `opening`, `trades`, `rule`, `iv`, `delta`. Shares and IV use decimals (`0.8` means 80%). Flags accept `true`/`false` or `1`/`0`. Provider column names such as `created_at`, `total_premium`, `total_size` and `open_interest` are supported. Invalid and duplicate rows are skipped with a count. Missing optional fields remain unknown. Imports are limited to 5 MB and 10,000 rows.

## Understand the results

- DTE uses the alert's New York market date and expiration, not today's date.
- Volume/OI compares cumulative contract volume with open interest. Missing or zero OI is unknown.
- Unusual score: premium divided by $50,000 (rounded, capped at 30), volume/OI × 6 (rounded, capped at 30), sweep flag (20), ask-side share × 20 (rounded, capped at 20). Missing fields add zero.
- Bias uses at least 60% ask-side premium (calls bullish, puts bearish), or 60% bid-side premium (the reverse). Mixed and multi-leg alerts are neutral. Execution side does not prove intent.
- Aggregated alerts may overlap; summed premiums can double count transactions and are not market totals.
- Scores rank activity and do not predict profit. Demo prices and October 1, 2026 alerts are fabricated.
- Only filters, preset names and watchlist symbols are saved on your device. Tokens and CSV snapshots stay in the tab.

## Development and verification

Built with Next.js, React and TypeScript; no hosting plugin or cloud account is required.

```sh
npm test
npm run typecheck
npm run build
```

Tests cover normalization, CSV safety, filters and the real provider route with a mocked upstream service. They do not require credentials. The live provider connection requires a valid subscription to verify end to end.

Main files: `components/scanner.tsx` (interface), `lib/flow.ts` (data and scoring), `app/api/flow/route.ts` (provider proxy) and `app/globals.css` (styles). Local startup follows the [Next.js installation guide](https://nextjs.org/docs/app/getting-started/installation).
