export type StageStripModel = {
  capture: "current" | "done" | "waiting";
  identified: number;
  captured: number;
  review: number;
  commitEnabled: boolean;
  partialAvailable: boolean;
};

const EMPTY: StageStripModel = {
  capture: "waiting",
  identified: 0,
  captured: 0,
  review: 0,
  commitEnabled: false,
  partialAvailable: false,
};

/** Counts come from the batch. The strip does not advance on its own. */
export function StageStrip({ model = EMPTY }: { model?: StageStripModel }) {
  const identify =
    model.captured === 0 ? "0 / 0" : `${model.identified} / ${model.captured}`;
  return (
    <ol className="vip-stages" aria-label="Ingest stages">
      <li className={`vip-stage vip-stage-${model.capture === "current" ? "current" : model.capture === "done" ? "done" : "ahead"}`}>
        <span className="vip-num">1</span>
        Capture
      </li>
      <li className="vip-stage">
        <span className="vip-num">2</span>
        Identify
        <span className="vip-muted"> {identify}</span>
      </li>
      <li className={`vip-stage ${model.review > 0 ? "vip-stage-current" : ""}`}>
        <span className="vip-num">3</span>
        Review
        <span className="vip-muted"> {model.review}</span>
      </li>
      <li className={`vip-stage ${model.commitEnabled ? "vip-stage-done" : "vip-stage-ahead"}`}>
        <span className="vip-num">4</span>
        Commit
        <span className="vip-muted">{model.commitEnabled ? " ready" : model.partialAvailable ? " partial" : " blocked"}</span>
      </li>
    </ol>
  );
}
