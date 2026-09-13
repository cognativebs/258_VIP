export default function CompCheckPrint() {
  return (
    <main className="print-page">
      <p className="print-kicker">IQVault · 90-Second Comp Check · $12</p>
      <h1>90-Second Comp Check</h1>
      <p>Laminate this. If it takes longer than 90s you are researching, not buying.</p>
      <ol>
        <li>Photo the asking price and the item. Do not rely on memory.</li>
        <li>Search eBay Sold for the exact print / grade / cert — 30s.</li>
        <li>Confirm on 130point if the phone eBay app is lying to you — 20s.</li>
        <li>If slabbed: open the cert. If comic: restoration tells. If TCG: name the print — 20s.</li>
        <li>Glance PriceCharting / GoCollect only to see if your sold band is insane — 10s.</li>
        <li>Three solds inside 90 days that beat the ask → consider. Otherwise walk.</li>
      </ol>
      <h2>Three traps</h2>
      <div className="print-bands">
        <div className="print-box pass">
          <strong>Regraded slab</strong>
          <span>Open the cert on PSA/CGC/BGS before money moves. No cert page → walk.</span>
        </div>
        <div className="print-box pass">
          <strong>Doctored comic</strong>
          <span>Price as restored until a grader says otherwise. Restored comps are a different market.</span>
        </div>
        <div className="print-box pass">
          <strong>Reprint TCG</strong>
          <span>If you cannot name the print (1st / shadowless / unlimited) you cannot price it. Pass.</span>
        </div>
      </div>
      <p className="print-foot">Sold → 130point → PWCC → GoCollect → PriceCharting last (guide, not a sold ledger).</p>
    </main>
  );
}
