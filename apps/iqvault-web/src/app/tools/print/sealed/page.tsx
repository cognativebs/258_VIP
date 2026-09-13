export default function SealedPrint() {
  return (
    <main className="print-page">
      <p className="print-kicker">IQVault · Store kit · $147</p>
      <h1>How to price sealed against secondary</h1>
      <ol>
        <li>Invoice + freight + shrink is the floor. Secondary mid is not a cost.</li>
        <li>If secondary high &lt; floor, you do not have a product — you have a lot. Liquidate or do not buy the case.</li>
        <li>Allocation week: price at secondary low + 5–10%, not MSRP, not eBay sold outliers.</li>
        <li>After week 6 of a TCG set, sealed still on the wall is inventory risk. Cut before the reprint rumor.</li>
        <li>Never use PriceCharting “new” as a sealed sticker without checking eBay sold that morning.</li>
      </ol>
      <p>
        <strong>Worked check:</strong> invoice $48 + freight $2 = $50 floor. Sold last week $52–$68. Sticker $64
        (in band, ~28% on list). If solds print $44, it is a lot, not a product.
      </p>
    </main>
  );
}
