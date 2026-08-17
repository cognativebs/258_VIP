# How-To: Binder Vault on the LAN + IQVault bridge

Binder Vault stays a **separate tab/window**. IQVault links to it; VIP API and Binder share the **same Postgres** (`vault_tcg` + `vault_collection.holding`).

## Ports

| Service | Port | Start |
|---------|------|--------|
| VIP API | 8787 | `npm run api` or **Launch IQVault** |
| IQVault web | 3000 | `npm run web` or **Launch IQVault** |
| Binder Vault | 3010 | `npm run binder` (Launch starts this; `-NoBinder` skips) |
| Comics API | 5200 | `npm run comics` or **Launch IQVault** |

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
| `IQVAULT_DATABASE_DSN` / `DATABASE_URL` | VIP API + Binder | `postgresql://postgres:vault@localhost:5432/iqvault` |
| `VIP_API_URL` | Binder server | `http://192.168.1.42:8787` |
| `NEXT_PUBLIC_VIP_API_URL` | IQVault web | `http://192.168.1.42:8787` |
| `NEXT_PUBLIC_BINDER_URL` | IQVault web | `http://192.168.1.42:3010` |
| `VIP_INCLUDE_POKEMON_SEEDS` | VIP API | `0` (default) = live Binder TCG only; `1` = also keep 5 seed rows |

`BINDER_DB_PATH` is **not** a runtime setting. It is only the input to `scripts/migrate_binder_sqlite_to_postgres.py` if you still have an old SQLite file.

## Shared TCG truth

- **Layout + owned flags** live in Postgres `vault_tcg`.
- **VIP `GET /api/inventory`** merges comics holdings + Binder owned/need (and durable `source=binder_vault` rows after **Push to VIP**).
- IQVault **Pokémon TCG Terminal** (`/collections/tcg`) shows card name, set, and number from that inventory.
- IQVault Portfolio shows a **TCG / Binder** section and deep-links into Binder (`?binderId=`).

## Firewall tip (Windows)

```powershell
New-NetFirewallRule -DisplayName "VIP Binder LAN" -Direction Inbound -Protocol TCP -LocalPort 3010,8787,3000 -Action Allow -Profile Private
```

Run elevated once if the phone cannot connect.
