#!/usr/bin/env python3
import psycopg2

DSN = "dbname=iqvault user=postgres password=vault host=localhost"
conn = psycopg2.connect(DSN)
cur = conn.cursor()

cur.execute("SELECT COUNT(*) FROM vault_comic.series")
print("series:", cur.fetchone()[0])
cur.execute("SELECT COUNT(*) FROM vault_comic.issue WHERE is_key_issue")
print("key issues:", cur.fetchone()[0])
cur.execute("SELECT COUNT(*) FROM vault_core.asset")
print("assets:", cur.fetchone()[0])
cur.execute("SELECT COUNT(*) FROM vault_collection.holding")
print("holdings:", cur.fetchone()[0])

cur.execute(
    """
  SELECT a.canonical_name, h.current_price_snapshot
  FROM vault_collection.holding h
  JOIN vault_core.asset a ON a.id = h.asset_id
  WHERE a.canonical_name ILIKE '%361%' AND a.canonical_name ILIKE '%spider%'
  ORDER BY h.current_price_snapshot DESC NULLS LAST LIMIT 3
"""
)
print("\nCrown jewels (ASM 361 sample):")
for row in cur.fetchall():
    print(" ", row)

cur.execute(
    """
  SELECT COUNT(*), ROUND(SUM(h.current_price_snapshot * h.quantity)::numeric, 2)
  FROM vault_collection.holding h
  WHERE h.recommendation ILIKE 'sell%'
"""
)
print("\nSell queue:", cur.fetchone())

cur.execute(
    """
  SELECT ROUND(SUM(h.current_price_snapshot * h.quantity)::numeric, 2),
         ROUND(SUM(COALESCE(h.purchase_price,0) * h.quantity)::numeric, 2)
  FROM vault_collection.holding h
"""
)
print("Portfolio (value, cost):", cur.fetchone())

cur.execute(
    """
  SELECT similarity('amazing spidermann 252', a.canonical_name) AS sim, a.canonical_name
  FROM vault_core.asset a
  ORDER BY sim DESC LIMIT 3
"""
)
print("\nFuzzy identify:")
for row in cur.fetchall():
    print(" ", row)

cur.close()
conn.close()
