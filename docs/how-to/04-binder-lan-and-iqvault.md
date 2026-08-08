# How-To: Binder Vault on the LAN + IQVault bridge

Binder Vault stays a **separate tab/window**. IQVault links to it; VIP API reads Binder’s SQLite for live TCG holdings.

## Ports

| Service | Port | Start |
|---------|------|--------|
| VIP API | 8787 | `npm run api` |
| IQVault web | 3000 | `npm run web` |
| Binder Vault | 3010 | `npm run binder` |

Binder already listens on `0.0.0.0:3010` (LAN-reachable). VIP API also binds `0.0.0.0` so a phone on the same Wi‑Fi can hit both.

## Phone on the same Wi‑Fi

1. Find your PC’s LAN IP (e.g. `ipconfig` → Wireless LAN → IPv4, like `192.168.1.42`).
2. Allow Windows Firewall inbound TCP **3010** and **8787** for private networks (first browser hit often prompts).
3. On the phone open: `http://<LAN-IP>:3010`
4. Optional IQVault on phone: `http://<LAN-IP>:3000` — Binder nav link should use the LAN Binder URL (see env below).

Off-network / tunnel access is **out of scope** for now.

## Environment

Set these when not using localhost-only desktop:

| Variable | Where | Example |
|----------|--------|---------|
| `BINDER_DB_PATH` | VIP API + Binder | Absolute path to `apps/binder-vault/.data/binder-vault.sqlite` |
| `VIP_API_URL` | Binder server | `http://192.168.1.42:8787` |
| `NEXT_PUBLIC_VIP_API_URL` | IQVault web | `http://192.168.1.42:8787` |
| `NEXT_PUBLIC_BINDER_URL` | IQVault web | `http://192.168.1.42:3010` |
| `VIP_INCLUDE_POKEMON_SEEDS` | VIP API | `0` (default) = live Binder TCG only; `1` = also keep 5 seed rows |

If `BINDER_DB_PATH` is unset, VIP API looks for:

`apps/binder-vault/.data/binder-vault.sqlite` relative to the monorepo root.

## Shared TCG truth

- **Layout + owned flags** live in Binder SQLite.
- **VIP `GET /api/inventory`** merges comics seed holdings + filled Binder slots (as TCG holdings with `externalIds`).
- **Sync Owned (VIP)** in Binder pulls VIP inventory `externalIds` and marks matching pockets owned — with live Binder-backed inventory this stays consistent with what you marked in Binder.
- IQVault Portfolio shows a **TCG / Binder** section and deep-links into Binder (`?binderId=`).

## Firewall tip (Windows)

```powershell
New-NetFirewallRule -DisplayName "VIP Binder LAN" -Direction Inbound -Protocol TCP -LocalPort 3010,8787,3000 -Action Allow -Profile Private
```

Run elevated once if the phone cannot connect.
