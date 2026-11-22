export function DualMeter({
  fact,
  attention,
}: {
  fact: number;
  attention: number;
}) {
  return (
    <div className="vip-meters" data-meters="dual">
      <Meter label="Fact confidence" value={fact} tone="fact" />
      <Meter label="Attention" value={attention} tone="attention" />
    </div>
  );
}

function Meter({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: "fact" | "attention";
}) {
  const clamped = Math.min(1, Math.max(0, value));
  return (
    <div className={`vip-meter vip-meter-${tone}`}>
      <div className="vip-meter-label">
        <span>{label}</span>
        <span className="vip-num">{clamped.toFixed(2)}</span>
      </div>
      <div className="vip-meter-track" aria-hidden="true">
        <span className="vip-meter-fill" style={{ width: `${Math.round(clamped * 100)}%` }} />
      </div>
    </div>
  );
}
