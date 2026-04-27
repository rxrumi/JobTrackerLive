# Job Tracker — Cloudflare deployment

Self-contained Cloudflare Worker that:
- Serves the live job-search tracker at `/`
- Exposes `/api/jobs` returning the latest dynamic postings (KV-backed)
- Runs a daily cron at `0 3 * * *` UTC (07:00 Dubai) that scans ~55 Greenhouse-hosted careers boards, filters by 15 target countries + RevOps/BizOps/Sales-Ops/Marketing-Ops keywords, and updates KV with NEW / Filled state

Free tier on Cloudflare handles all of this — Workers + KV + Cron all included at zero cost for this volume.

---

## Prerequisites

- A Cloudflare account (you already have one: `Main Workspace`)
- Node.js 18+ installed locally
- A terminal

KV namespace is **already provisioned** in your account:
- Title: `job-tracker-state`
- ID: `8cf95c7c04054745bff09d88ea57d707`

(The ID is already wired into `wrangler.toml`.)

---

## Deploy

From the `cloudflare-deploy/` folder:

```bash
# 1. Install Wrangler (Cloudflare CLI)
npm install

# 2. Authenticate (opens a browser tab)
npx wrangler login

# 3. Deploy
npx wrangler deploy
```

That's it. The CLI prints your live URL — something like:

```
https://job-tracker.<your-subdomain>.workers.dev
```

Open it. The page loads with all 95 static entries immediately. The dynamic feed shows "No scans yet" on first load.

---

## Trigger the first scan immediately (don't wait for the cron)

```bash
# Add a secret used to authorize manual scan triggers
npx wrangler secret put SCAN_KEY
# (paste any random string when prompted, e.g. a UUID — save it)

# Then hit the manual-scan endpoint
curl "https://job-tracker.<your-subdomain>.workers.dev/api/scan-now?key=<your-secret>"
```

Response is JSON: `{ okCount, failCount, total }`. Reload the page and dynamic postings appear with **NEW** badges.

---

## Custom domain (optional)

In the Cloudflare dashboard → Workers & Pages → `job-tracker` → Settings → Triggers → Custom Domains, add `jobs.yourdomain.com`. SSL is automatic.

---

## How the cron works

`wrangler.toml` declares:

```toml
[triggers]
crons = ["0 3 * * *"]
```

That's 03:00 UTC daily = 07:00 Dubai. The Worker's `scheduled()` handler fetches Greenhouse boards in batches of 8 (parallel), filters, diffs against KV state, and writes:

- `state` key — full posting history with first_seen / last_seen / last_filled
- `jobs` key — flattened public payload the page consumes

If more than half of fetches fail in a run, the Worker aborts the KV write to protect against partial-state corruption. Filled postings auto-prune after 7 days of being absent.

---

## Inspecting & debugging

```bash
# Live tail Worker logs (cron + HTTP)
npx wrangler tail

# Read KV directly
npx wrangler kv:key get jobs --binding KV
npx wrangler kv:key get state --binding KV

# Force-clear and re-scan from scratch
npx wrangler kv:key delete state --binding KV
curl "https://<url>/api/scan-now?key=<your-secret>"
```

---

## What's in this bundle

```
cloudflare-deploy/
├── wrangler.toml         # Worker config + KV binding + cron + static assets
├── src/worker.js         # Fetch handler, scheduled handler, scan logic
├── public/index.html     # The tracker UI (static + fetches /api/jobs)
├── package.json          # Wrangler dependency
└── README.md             # This file
```

---

## Local scanner (hybrid scraping)

Some careers pages can't be scanned from a Cloudflare Worker IP — Workday and similar systems either rate-limit Worker traffic or require browser-like sessions. The repo includes a Node.js scanner you run from your Mac that hits those APIs and POSTs results to the live Worker via `POST /api/local-jobs`.

```bash
# One-time
SCAN_KEY=<your-key> node scripts/local-scan.mjs

# Add to a daily cron / Cowork schedule:
0 5 * * *   SCAN_KEY=<your-key> node /path/to/scripts/local-scan.mjs
```

The script ships with one scanner (Zendesk via Workday). To add more, follow the `scanWorkday` template in `scripts/local-scan.mjs` — pattern is identical for any Workday tenant once you find the right `host` and `site` from their careers page.

The Worker's `/api/local-jobs` endpoint replaces all `source: "local"` postings with the new batch each call, so an empty array clears local jobs. Cloud-scanned and locally-scanned postings live in the same KV but never overwrite each other.

---

## Modifying the tracked companies / keywords

Edit `src/worker.js`:

- `GREENHOUSE_TOKENS` — add or remove board tokens
- `CITY_TO_COUNTRY` — add cities to expand geography
- `ROLE_KEYWORDS` — adjust title-matching
- `HIGH_FIT_COMPANIES` — companies that get the High stack-fit boost
- `[triggers] crons` in wrangler.toml — adjust schedule

Run `npx wrangler deploy` to push changes.

---

## Cost

Free tier covers:
- 100,000 Worker requests/day (you'll use < 100)
- 100,000 KV reads, 1,000 writes per day (you'll use < 200)
- Unlimited cron invocations

Total cost: $0/month indefinitely at this volume.
