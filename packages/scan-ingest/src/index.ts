export {
  SCAN_HOLDING_SOURCE,
  SCAN_SNAPSHOT_SOURCE,
  RICOH_FI8170_DEVICE,
  SCAN_INGEST_RULE,
  SCAN_ID_RULE,
  CATALOG_RESOLVER_RULE,
  CATALOG_SNAPSHOT_RULE,
  SCAN_EDIT_RULE,
  SCAN_DUP_RULE,
  EBAY_LISTING_RULE,
  SCAN_INGEST_VERSION,
} from "./constants.js";

export {
  ScanCategorySchema,
  ScanUnitStatusSchema,
  ScanPageInputSchema,
  ScanUnitInputSchema,
  ScanBatchInputSchema,
  IdentityCandidateSchema,
  DuplicateMatchSchema,
  DuplicateAlertSchema,
  ScanUnitSchema,
  ScanBatchSchema,
  ConfirmUnitRequestSchema,
  EditStagedUnitRequestSchema,
  InventoryCommitSchema,
  EbayListingDraftStatusSchema,
  EbayListingDraftSchema,
  InventoryLookupRowSchema,
  CatalogCardSchema,
  type ScanCategory,
  type ScanUnitStatus,
  type ScanPageInput,
  type ScanUnitInput,
  type ScanBatchInput,
  type IdentityCandidate,
  type DuplicateMatch,
  type DuplicateAlert,
  type ScanUnit,
  type ScanBatch,
  type ConfirmUnitRequest,
  type EditStagedUnitRequest,
  type InventoryCommit,
  type EbayListingDraftStatus,
  type EbayListingDraft,
  type InventoryLookupRow,
  type CatalogCard,
} from "./schemas.js";

export { ScanSessionStore } from "./store.js";
export {
  openScanBatch,
  openScanBatchWithResolver,
  refreshDuplicateAlerts,
  confirmScanUnit,
  type OpenBatchResult,
  type ConfirmUnitResult,
  type PipelineDeps,
} from "./pipeline.js";
export {
  identifyUnit,
  identifyUnitWithAdapter,
  buildCatalogQuery,
  queryTextFor,
  scoreCatalogCards,
  type IdentifyOptions,
} from "./identify.js";
export {
  CONFIDENCE_POLICY_VERSION,
  DEFAULT_CONFIDENCE_POLICY,
  assessCandidates,
  policyFromEnv,
  type ConfidenceAssessment,
  type ConfidenceBand,
  type ConfidencePolicy,
} from "./confidence-policy.js";
export {
  createFixtureCatalogAdapter,
  FIXTURE_CATALOG_ADAPTER,
} from "./catalog/fixture-adapter.js";
export type {
  CatalogAdapter,
  CatalogQuery,
  CatalogRawResponse,
  SyncCatalogAdapter,
} from "./catalog/types.js";
export { createCatalogResolver, type CatalogResolver } from "./catalog/resolver.js";
export {
  createMemoryIdentificationCache,
  canonicalizeCandidatesJson,
  type IdentificationCache,
} from "./catalog/cache.js";
export {
  createMemorySnapshotSink,
  hashProviderPayload,
  catalogSnapshotSource,
  type SnapshotSink,
} from "./catalog/snapshots.js";
export { mergeCandidatesByExternalId } from "./catalog/merge.js";
export { buildIdObservation } from "./catalog/id-observation.js";
export { scoreIdentificationBenchmark } from "./catalog/benchmark.js";
export {
  CatalogResolverResultSchema,
  IdObservationRecordSchema,
  IdentificationBenchmarkCaseSchema,
  IdentificationBenchmarkReportSchema,
  type CatalogResolverResult,
  type CatalogAdapterOutcome,
  type IdObservationRecord,
  type IdentificationBenchmarkCase,
  type IdentificationBenchmarkReport,
} from "./catalog/resolver-schemas.js";
export { parseTcgdexCards, fetchTcgdexRaw } from "./catalog/tcgdexAdapter.js";
export { findDuplicates } from "./duplicates.js";
export {
  buildEbayListingDraft,
  buildListingTitle,
  ebayCredsFromEnv,
  categoryToEbayLeafHint,
  type EbayListingCredentials,
} from "./ebay-listing.js";
export { FIXTURE_CATALOG } from "./catalog/fixture-catalog.js";
export {
  parseSportsIdentity,
  sportsParsedCandidate,
  SPORTS_PARSE_RULE,
} from "./sportsIdentity.js";
export {
  FolderWatchAdapter,
  pairPagesIntoUnits,
  batchInputFromPages,
  inferFaceFromFileName,
  mimeFromName,
  stemKey,
} from "./adapters/folder-watch.js";
export { pairPagesForReview, pageStem, swapUnitFaces } from "./pairing.js";
export { fuseCardEvidence, baseVsParallelFromEvidence } from "./evidenceFusion.js";
export { identifyFromPairedImages } from "./identifyFromImages.js";
export { ocrImageFile, ocrAvailable, SCAN_OCR_RULE } from "./ocr/tesseractOcr.js";
export { extractVisionEvidence, shouldEscalateToVision, SCAN_VISION_RULE } from "./vision/structuredVision.js";
export { createTcgdexCatalogAdapter } from "./catalog/tcgdexAdapter.js";
export { isGenericScanFileName } from "./identify.js";
export { routeReview, thresholdsFromEnv } from "./reviewRoute.js";
export { isPhysicalReimport } from "./physicalDuplicate.js";
export { readImageMeta, orientationOf } from "./jpegMeta.js";
export type {
  DeviceAdapter,
  DevicePage,
  FolderWatchConfig,
  PairingStrategy,
} from "./adapters/types.js";
