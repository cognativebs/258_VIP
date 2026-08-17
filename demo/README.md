# VaultOS Demo

Interactive demo for **VaultOS / IQVault** — the universal collectible identity and valuation platform defined in the parent SQL schema files.

## What it demonstrates

- **Overview** — Architecture layers (`vault_core`, category schemas, `vault_market`, ID feedback)
- **Scan** — Simulated 4-stage identification pipeline with parallel disambiguation
- **Catalog** — Browse assets across Pokémon, Sports, MTG, and Comics with tiered offers
- **Acquire** — Collection intake: photo upload → mock catalog ID → offer sheet + deal grade
- **Review** — Human-in-the-loop ID correction queue (`id_observation` training loop)

## Run locally

```bash
cd demo
npm install
npm run dev
```

Opens at http://127.0.0.1:5174

Or from the IQVault folder: double-click `start_demo.bat`

**Full walkthrough (setup, iPhone photos/clips, test checklist):** see [`../DEMO_WALKTHROUGH.md`](../DEMO_WALKTHROUGH.md)

### iPhone photo & clip upload

1. Double-click **`start_demo_mobile.bat`** (same folder as `start_demo.bat`)
2. On PC: open **Acquire** — scan the QR code (or copy the link)
3. On iPhone: same Wi‑Fi as PC → Safari → **Acquire** → **Photo Library** (photos + clips), **Take Photo**, or **Record Clip**

If Windows Firewall prompts, allow Node/Vite on private networks. HEIC photos and MOV/MP4 clips from Camera Roll are supported.

## Acquisition engine

Offer logic lives in `src/lib/offerEngine.js`:

- Tiered buy percentages by price band (Bulk → Grail)
- Demand + velocity adjustments
- Buy vs avoid rules
- Collection deal grade (A–C), sell-through, projected profit

The **Acquire** tab uses mock photo matching against the IQVault catalog — no browser API keys. Production would proxy vision ID through a backend.

## Schema reference

| File | Layer |
|------|-------|
| `../infra/db/migrations/20260701_01_core_spine.sql` | Universal asset identity |
| `../infra/db/migrations/20260702_02_tcg.sql` | Pokémon + MTG |
| `../infra/db/migrations/20260703_03_sports_comics.sql` | Sports parallel ladder + comic printings |
| `../infra/db/migrations/20260704_04_market_sealed_id.sql` | Market value, sealed, ID observations |

Mock data in `src/data/mockCatalog.js` mirrors these table structures.

## Suggested demo flow

1. **Overview** → architecture + pipeline
2. **Scan** → Sports parallel disambiguation
3. **Acquire** → upload 2–3 photos → offer sheet + deal grade
4. **Catalog** → drill into an identified asset
5. **Review** → confirm a pending scan
