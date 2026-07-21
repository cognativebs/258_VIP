export type {
  SourceAdapter,
  ParseResult,
  DerivedCatalogRow,
} from "./adapters/types.js";
export {
  ClzXmlAdapter,
  deriveFromClzComic,
  holdingProvenanceForRow,
  snapshotProvenance,
  ADAPTER_VERSION,
} from "./adapters/clz-xml.js";
export { TcgCsvAdapter, TCG_ADAPTER_VERSION } from "./adapters/tcg-csv.js";
export {
  ImmutableSnapshotStore,
  DerivedStore,
  fingerprintDerived,
} from "./snapshot-store.js";
