# IQVault / VaultOS Demo — Start-to-Finish Walkthrough

> **Live collector face is not this demo.** Double-click **Launch IQVault.bat** and use
> http://127.0.0.1:3000 (Comics / TCG / Sports). Vite IQVault on `:5175` is archived.

This guide is the **VaultOS store demo** (`demo/` on `:5174`) plus the old bridge. Do not
follow it to run the production IQVault collector.

---

## What you're running (archived demo stack)

| App | Folder | URL | Login |
|-----|--------|-----|-------|
| **VaultOS** (store ops demo) | `demo/` | http://127.0.0.1:5174 | `store@vaultos.demo` / `demo` |
| **IQVault** (archived Vite proof) | `iqvault/` | do not run — use `:3000` | — |
| **Bridge** (links the two demos) | `bridge/` | http://127.0.0.1:5199 | — |

For iPhone photo/clip upload, you only need **VaultOS** in mobile mode. IQVault and the bridge are optional.

---

## Prerequisites

1. **Windows PC** on the same Wi‑Fi network as your iPhone (for mobile upload).
2. **Node.js 18+** — check with:
   ```powershell
   node -v
   npm -v
   ```
   Install from https://nodejs.org if missing.
3. **iPhone** with Safari (Camera app for QR scan is fine too).
4. **Firewall**: when Windows asks to allow Node/Vite on private networks, choose **Allow**.

---

## One-time setup

Open PowerShell or Command Prompt and install dependencies once:

```powershell
cd D:\Projects\Business_Ideas\258_Labs\IQVault\demo
npm install
```

Optional — only if you plan to test IQVault or account linking:

```powershell
cd D:\Projects\Business_Ideas\258_Labs\IQVault\iqvault
npm install
```

---

## Choose how to launch

### Option A — VaultOS only (PC browser)

Best for a quick desktop demo. iPhone upload will **not** work (PC is on `127.0.0.1` only).

1. Double-click **`start_vaultos.bat`** in the IQVault folder.
2. Browser opens http://127.0.0.1:5174
3. Skip to [Login](#login) below.

### Option B — VaultOS + iPhone upload (recommended for Acquire testing)

Use this when you want photos and clips from your iPhone.

1. Double-click **`start_demo_mobile.bat`** in the IQVault folder.
2. A terminal window shows two URLs:
   - **PC:** `http://127.0.0.1:5174`
   - **iPhone:** `http://192.168.x.x:5174` (your PC's LAN IP)
3. The script writes `demo/.env.local` with `VITE_MOBILE_URL` so the QR code panel appears.
4. On PC: open http://127.0.0.1:5174 → go to **Acquire** — you should see the **Use your iPhone** QR card.
5. Continue to [iPhone setup](#iphone-setup-photos--video-clips).

### Option C — Full ecosystem (VaultOS + IQVault + Bridge)

For testing hunts, portfolio sync, and cross-app linking.

1. Double-click **`start_ecosystem.bat`**.
2. Three terminal windows open (Bridge, VaultOS, IQVault).
3. For iPhone upload, still use **`start_demo_mobile.bat`** instead of `start_vaultos.bat` — or run mobile mode in the VaultOS window after stopping the PC-only server.

---

## iPhone setup (photos + video clips)

### Step 1 — Same Wi‑Fi

Confirm iPhone and PC are on the **same Wi‑Fi network** (not cellular, not a guest network that blocks device-to-device traffic).

### Step 2 — Open VaultOS on iPhone

**Method 1 — QR code (easiest)**

1. On PC, log into VaultOS and open the **Acquire** tab.
2. Scan the gold QR code with iPhone Camera.
3. Tap the banner → opens **Safari**.
4. URL should look like `http://192.168.x.x:5174/?tab=acquire` (not `127.0.0.1`).

**Method 2 — Copy link**

1. On PC Acquire tab, click **Copy link** in the iPhone panel.
2. AirDrop or message the link to yourself, or type it manually in Safari on iPhone.

### Step 3 — Log in on iPhone

If prompted:

- Email: `store@vaultos.demo`
- Password: `demo`

You should land on **Acquire** (the `?tab=acquire` query opens that tab automatically).

### Step 4 — Add media from iPhone

Three buttons appear on mobile:

| Button | What it does |
|--------|----------------|
| **Photo Library** | Pick existing photos **or** saved video clips (MOV/MP4) from Camera Roll |
| **Take Photo** | Opens camera for a still shot |
| **Record Clip** | Opens camera in video mode for a quick clip |

**Tips for good intake results**

- Lay cards flat on a contrasting surface.
- Use even lighting; avoid glare on slabs and holos.
- For clips: keep the phone steady, 3–10 seconds, pan slowly across the spread.
- You can mix photos and clips in one intake batch.
- HEIC photos from iPhone are supported.

### Step 5 — Review thumbnails

After selecting files, thumbnails appear in a grid:

- Still photos show as images.
- Video clips show a preview frame with a **CLIP** badge.

Remove any bad takes with the **×** on a thumbnail.

### Step 6 — Run the pipeline

Tap **Scan & price N files →**

Progress shows two stages:

1. **Identifying** — matching items (demo uses catalog mock ID per file).
2. **Pricing** — sold comps + offer per card.

When complete, review:

- **Recommended offer** and **deal grade**
- **Price confidence** %
- **Recommended to buy** vs **Recommended to avoid**
- Tap **▶ Show N sold comps** on any card to expand comps

> **Demo note:** The intake engine does not decode your actual pixels yet. Each uploaded photo or clip counts as one intake source and surfaces demo catalog cards. Production would extract frames from clips and run real vision ID.

---

## Login

### VaultOS

| Field | Value |
|-------|-------|
| URL | http://127.0.0.1:5174 (PC) or `http://<LAN-IP>:5174` (iPhone) |
| Email | `store@vaultos.demo` |
| Password | `demo` |

### IQVault (live collector — not this demo)

| Field | Value |
|-------|-------|
| URL | http://127.0.0.1:3000 (`Launch IQVault.bat` / `npm run web`) |
| Login | none on the Next collector face |

---

## Test plan — Acquire (primary iPhone flow)

Use this checklist after iPhone setup:

- [ ] QR panel visible on PC Acquire tab when using `start_demo_mobile.bat`
- [ ] iPhone Safari opens Acquire without `127.0.0.1` in the URL
- [ ] Photo Library accepts a HEIC/JPEG from Camera Roll
- [ ] Photo Library accepts a short MOV/MP4 clip
- [ ] Record Clip captures a new video and shows CLIP badge
- [ ] Take Photo captures a still
- [ ] Scan & price completes both Identify and Pricing stages
- [ ] Results show deal grade, price confidence, buy/avoid lists
- [ ] Expanding sold comps shows price range + individual comps
- [ ] **View in catalog →** navigates to the asset in Catalog tab
- [ ] **New intake** resets for a second batch

**Suggested test batch:** 2 photos + 1 short clip → expect a richer multi-card offer sheet.

---

## Test plan — all VaultOS tabs (PC)

Run through each tab after login on PC:

### 1. Overview

- [ ] Stats cards render (catalog assets, ID queue, liquidity)
- [ ] Architecture section visible
- [ ] **Try Acquire** shortcut works

### 2. Scan

- [ ] Pick a scan scenario (e.g. Sports parallel)
- [ ] Watch 4-stage pipeline animation
- [ ] Disambiguation candidates appear
- [ ] Confirm a match → success state

### 3. Catalog

- [ ] Filter by category (Pokémon, Sports, MTG, Comics)
- [ ] Open an asset detail drawer
- [ ] Tiered buy offer displays on asset

### 4. Acquire

- [ ] Desktop dropzone accepts photos and video files
- [ ] Full pipeline → offer sheet (same as iPhone flow)

### 5. Review

- [ ] Pending ID observations listed
- [ ] Confirm or correct a scan
- [ ] Queue count updates

---

## Optional — Link VaultOS and IQVault

Requires the bridge running (`start_ecosystem.bat` or `node bridge/server.js`).

1. Log into **VaultOS** → find **Link account** panel → **Generate code**.
2. Open **IQVault** on http://127.0.0.1:3000 (Launch IQVault). The archived Vite login on `:5175` is not the live face.
3. VaultOS Overview may show hunt progress synced from IQVault.

---

## Troubleshooting

### Port 5174 already in use

Another VaultOS instance is running. Close extra terminal windows, or:

```powershell
netstat -ano | findstr :5174
```

Kill the stale process, then restart.

### IQVault on :3000 looks like an old UI (empty TCG, no card names)

Leftover `next dev` is still bound to 3000. **Stop IQVault.bat**, then **Launch IQVault.bat** (it restarts web). Confirm `/collections/tcg` says **POKÉMON TCG TERMINAL** with a CARD column.

### QR code panel missing on PC

- You launched with `start_vaultos.bat` (PC-only) instead of **`start_demo_mobile.bat`**.
- Or `demo/.env.local` is missing — re-run `start_demo_mobile.bat`.

### iPhone can't reach the PC URL

- Confirm same Wi‑Fi (not VPN on either device).
- Allow Windows Firewall for Node on **Private** networks.
- Try the copied LAN URL in Safari manually.
- Some guest/hotel Wi‑Fi blocks phone→PC traffic — use a home network or phone hotspot with PC joined.

### `127.0.0.1` on iPhone

That URL only works on the PC itself. Use the `192.168.x.x` address from the mobile terminal output.

### Video clip won't upload

- Use **Photo Library** for existing clips, or **Record Clip** for new ones.
- Very large files may be slow — keep clips under ~30 seconds for demo.
- Safari is required; in-app browsers (Instagram, etc.) may block file pickers.

### "No cards identified"

The demo mock ID returned empty for that batch. Add at least one file and retry, or use 2–3 files.

### npm / node not found

Install Node.js 18+ and reopen the terminal.

---

## Quick reference — launch scripts

| Script | Purpose |
|--------|---------|
| `start_vaultos.bat` | VaultOS on PC only (port 5174) |
| `start_demo_mobile.bat` | VaultOS on LAN + QR for iPhone |
| `Launch IQVault.bat` | Live stack: Postgres, VIP API, Comics API, web `:3000`, Binder `:3010` |
| `start_iqvault.bat` | Same as Launch IQVault (not Vite `:5175`) |
| `start_ecosystem.bat` | Bridge + VaultOS + IQVault together |

---

## What production would add

The demo intentionally mocks vision ID and sold comps so it runs offline without API keys. Production VaultOS would:

- Extract key frames from video clips before ID
- Proxy vision + pricing through a backend (not browser API keys)
- Swap `getPricing()` in `demo/src/lib/pricingService.js` for live eBay / marketplace data

The UI flow you tested — upload → identify → price → offer — is the same shape as production.
