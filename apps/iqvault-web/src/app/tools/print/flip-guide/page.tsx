export default function FlipGuidePrint() {
  return (
    <main className="print-page">
      <p className="print-kicker">IQVault · Flip Score · $37</p>
      <h1>How to read the Flip Score</h1>
      <p>One page. Tape it inside the show binder.</p>
      <div className="print-bands">
        <div className="print-box buy">
          <strong>70–100 Buy now</strong>
          <span>Ask at/under sold low. ≥3 comps. Liquidity not dead.</span>
        </div>
        <div className="print-box hold">
          <strong>45–69 Hold</strong>
          <span>In band. Fine collection copy. Not a trade.</span>
        </div>
        <div className="print-box pass">
          <strong>0–44 Pass</strong>
          <span>Over the high, no comps, or a named trap.</span>
        </div>
      </div>
      <h2>The number is not the decision</h2>
      <p>
        VIP still ends in Buy / Hold / Grade / Sell / Lot / Pass with reasons. A 90 with two comps is a vanity number.
      </p>
      <table>
        <tbody>
          <tr>
            <th>Margin</th>
            <td>0–40</td>
            <td>Modeled exit net ÷ buy basis</td>
          </tr>
          <tr>
            <th>Ask vs band</th>
            <td>0 / 12 / 25</td>
            <td>Over / in-band / under low</td>
          </tr>
          <tr>
            <th>Liquidity</th>
            <td>0–15</td>
            <td>How often this thing actually sells</td>
          </tr>
          <tr>
            <th>Pop</th>
            <td>0–10</td>
            <td>Blank = unknown = 5. Never treat blank as scarce.</td>
          </tr>
          <tr>
            <th>Age</th>
            <td>1–10</td>
            <td>Vintage established vs still-printing modern</td>
          </tr>
        </tbody>
      </table>
      <p className="print-foot">
        Target resale is a range. PriceCharting is a guide, last. Inferred stays unlabeled as fact.
      </p>
    </main>
  );
}
