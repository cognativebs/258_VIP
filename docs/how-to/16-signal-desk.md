# Signal Desk, daily Orchestr8 brief and theses

What it is: one page to read what SIGNALS found and what Orchestr8 made of it.
Once a day Orchestr8 reads the curated daily lists (sports, collectibles, headlines,
markets), the surfaced Pokémon signals and your open theses, and writes a short brief.
It may propose new **theses** (a claim with a horizon and an action). They arrive as
**drafts** (inferred · unverified). Only you activate, retire or invalidate one.

## Where you see it

- **Desk** (`http://localhost:3000/signals/desk`):
  - top strip: how many feeds are OK, last ingest, last brief, and any feed that is stale or failing
  - **Orchestr8 briefs**: today's brief (headline, summary, points per group, cost, run id); earlier briefs fold away
  - **Theses**: action, what is withheld (Buy / Sell / Grade wait for sold comps), confidence (max 0.75), horizon, the articles it rests on, Orchestr8's latest verdict, and **Activate / Retire / Invalidate**
  - **Calls to score**: each thesis is checked at +7 / +30 / +90 / +180 / +365 days; press **Held** or **Did not hold** when one is due. The Brier score appears once there are enough calls (lower is better; 0.25 = coin flip)
  - **Articles · last 72h**: every signal article, newest first; filter by group, search, hide Pokémon noise; each title links to the source
  - **Feed health** (fold-out): every source, its state and the last success
- **Theses** (`/theses`): all theses grouped by status.
- **Orchestr8 console**: briefs are runs with task `signals_brief`; open theses also ride along in `/api/signals/context`, so the Analysis tab and councils see them.

## How it runs

The jobs scheduler (window **IQVault Jobs**) checks every hour and runs the brief once a
day after 07:00 local, or later in the day if the PC was asleep. It retries up to 3 times
a day if Orchestr8 or the API is down, and stops for the day at $1 of model spend.
A day with no new signals counts as done.

Run one by hand (the VIP API and Orchestr8 must be running):

```powershell
cd D:\Projects\Business_Ideas\258_Labs\258_VIP-signals-spine
npm run signals-brief -w @vip/jobs -- --dry-run   # shows what would be sent; no model call
npm run signals-brief -w @vip/jobs -- --force     # run now even if today's is done (cap still applies)
```

Settings (in `services\api\.env`): `VIP_SIGNALS_BRIEF_HOUR` (default 7),
`VIP_SIGNALS_BRIEF_CAP_USD` (default 1), `VIP_SIGNALS_BRIEF_MODEL` (default `gpt-4o-mini`).
Sent to the model: headline titles, links, source names and our own fields; never article bodies.

## Rules it keeps

- Every thesis cites signals from that day's brief, or it is dropped (listed under "rejected" in the job output).
- Buy, Sell and Grade become **Watch** with the proposal shown as withheld until sold comps exist.
- Orchestr8 never changes a thesis's status; its verdict shows as a badge.
- News is never a price.

## When the stack restarts

Windows task **VIP IQVault Stack at Logon** starts everything 2 minutes after you log on
(after a Windows Update restart, for example). It first fast-forwards the live folder, so a
PR merged to `main` goes live then. Re-register it with
`powershell -NoProfile -ExecutionPolicy Bypass -File scripts\register_iqvault_logon_task.ps1 -Root <live folder>`.
While the PC sleeps nothing runs; feeds and the brief catch up when it wakes.
