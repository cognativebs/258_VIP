# Scan inbox (Ricoh fi-8170)

PaperStream Capture should write duplex JPEGs here (or a subfolder).

`batch-001-sports/` is the first real-inventory lot: 25 messy Dealer
Inventory sports cards ($5–$50 rookies, parallels, numbered, autos/relics).

Until the scanner is live, `POST /api/batch/001/sports/run` writes
placeholder JPEGs named like PaperStream (`…_front.jpg`) so the pipeline
can run. Replace those files with real fi-8170 scans of the same stems
and re-run.

Set `VIP_SCAN_INBOX` to this directory (or its parent) so `/scan` import
stays inside the inbox.
