/** Renders only when mounted. Callers omit it for verified condition. */
export function VerificationChip({ label }: { label: string }) {
  return <span className="vip-chip vip-chip-caution">{label}</span>;
}
