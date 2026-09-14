export default function CompCheckFieldPrint() {
  return (
    <main className="field-kit">
      <h1>90s Comp Check</h1>
      <p>Standing at the table. Screenshot this.</p>
      {[
        "Photo the ask and the item.",
        "eBay Sold — exact print / grade / cert.",
        "130point if the eBay app is lying.",
        "Cert page / restoration / name the print.",
        "PriceCharting last — sanity only.",
        "3 solds in 90 days beat the ask, or walk.",
      ].map((s, i) => (
        <div key={s} className="field-step">
          <span>{i + 1}.</span> {s}
        </div>
      ))}
      <div className="field-step trap">Regraded slab — no cert page, walk.</div>
      <div className="field-step trap">Doctored comic — price as restored.</div>
      <div className="field-step trap">Reprint TCG — cannot name the print, pass.</div>
    </main>
  );
}
