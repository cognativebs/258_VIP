# Sprint NOW — money first

Owner board 2026-09-13. This is the only active queue. Everything else waits.

## P0 — Money blockers

| Item | Status | Honest gap |
|---|---|---|
| Comic pricing trustworthy | Partial | LIVE is PriceCharting only — eBay asks are off. VALUE is still CLZ. Quotes are unverified, not solds. Re-walk after pull so chips are guide quotes, not leftover Browse rows. |
| Sports-card identification usable | Not usable | Ricoh sports holdings exist. Identity is still review-heavy. Sell path treats holdings as comics (`categoryKind` hardcoded). |
| Pricing usable | Comics partial / sports no | Sports have no live comps path. Comics LIVE is a range, not a fact. |
| eBay injection usable | Comics-only, listing parked | Production preflight can pass. Mapper is comic-only. Owner has not listed. |
| Inventory disposition usable | Rules exist, not the loop | `@vip/ebay-sell` recommends SINGLE/LOT/BULK/HOLD/GRADE. Sports/comics do not all enter that queue. |
| Sale/transaction captured | Schema, no first sale | `INTERNAL_SALE` write path exists. Nothing has completed a Production sale into it. |

## P1 — Revenue operations

All gated on P0. Do not start listing counts until injection + disposition + pricing are usable for that vertical.

- Process first 100 sports cards
- Process first 50 comics
- Generate Dealer Inventory
- List first 50 items
- List first 100 items
- First LCS package
- First sale
- First $500 net
- First $1,000 net
- First $2,500 recycled capital

## P2 — Intelligence

Do not expand until P0 holds and P1 has a real sale path.

- Sell Signal
- Buy Signal
- Grade Signal
- Basic opportunity ranking
- Capital allocation recommendation

`/signals` already emits a basic feed. That is not P2 done.

## Next P0

**Comic pricing trustworthy** — operator: pull the pricing branches, set `PRICECHARTING_API_TOKEN`, migrate, Launch IQVault, re-walk comics comps, then we check LIVE vs the book. Code next only if those numbers are still wrong.
