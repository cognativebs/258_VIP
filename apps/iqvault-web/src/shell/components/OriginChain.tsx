export type OriginSource = {
  id: string;
  title: string;
  kind: "primary" | "derivative";
};

export function OriginChain({
  sources,
  corroboration,
}: {
  sources: OriginSource[];
  corroboration: string;
}) {
  const primary = sources.filter((source) => source.kind === "primary");
  const derivatives = sources.filter((source) => source.kind === "derivative");
  return (
    <div className="vip-origin">
      <p className="vip-kicker">Origin</p>
      <ul>
        {primary.map((source) => (
          <li key={source.id} className="vip-origin-primary">
            {source.title}
          </li>
        ))}
      </ul>
      {derivatives.length ? (
        <ul className="vip-origin-derivatives">
          {derivatives.map((source) => (
            <li key={source.id}>{source.title}</li>
          ))}
        </ul>
      ) : null}
      <p className="vip-origin-count">{corroboration}</p>
    </div>
  );
}
