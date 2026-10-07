import type { StageStripModel } from "../components/StageStrip";

export type IngestMethodChoice = {
  key: string;
  label: string;
  enabled: boolean;
  disabledReason?: string;
};

export type IngestBatchCard = {
  id: string;
  name: string;
  destination: string | null;
  method: string | null;
  lifecycle: string;
  captured: number;
  identified: number;
  review: number;
  scanUnits: number;
  lastActivity: string;
  stale: boolean;
};

export type IngestScanRow = {
  id: string;
  label: string;
  productLabel: string | null;
  quantity: number;
  review: boolean;
  reason: string | null;
  voided: boolean;
  createdAt: string;
};

export type IngestFlowModel = {
  error: string | null;
  destinationId: string | null;
  destinations: { id: string; label: string }[];
  subtargetKind: "" | "binder" | "hunt";
  subtargetId: string;
  binders: { id: string; name: string }[];
  hunts: { id: string; name: string }[];
  methodKey: string | null;
  methods: IngestMethodChoice[];
  query: string;
  batches: IngestBatchCard[];
  pausedNotice: string | null;
  detail: null | {
    id: string;
    name: string;
    destinationLabel: string;
    lifecycle: string;
    methodKey: string | null;
    methodLabel: string;
    stages: StageStripModel;
    rows: IngestScanRow[];
    methodNote: string | null;
    sessionCount: number;
    batchTotal: number;
    selectedId: string | null;
  };
  captureError: string | null;
  duplicateNotice: string | null;
  confirmDraft: string;
  commitNote: string | null;
  csvText: string;
  csvPresetId: string | null;
  presets: { id: string; label: string }[];
  csv: null | {
    presetLabel: string;
    headers: string[];
    mapped: { field: string; column: string | null }[];
    duplicates: number;
  };
};

export type IngestActions = {
  onDestination: (id: string) => void;
  onSubtargetKind: (kind: "" | "binder" | "hunt") => void;
  onSubtargetId: (id: string) => void;
  onMethod: (key: string) => void;
  onQuery: (value: string) => void;
  onCreate: () => void;
  onOpen: (id: string) => void;
  onResume: (id: string) => void;
  onAbandon: (id: string) => void;
  onBack: () => void;
  onCapture: (code: string) => void;
  onPaste: (text: string) => void;
  onSelectScan: (id: string) => void;
  onUndo: () => void;
  onConfirmDraft: (value: string) => void;
  onConfirmUnknown: () => void;
  onManual: (fields: { productLabel: string; quantity: string; costBasis: string; acquiredOn: string }) => void;
  onQueue: (names: string) => void;
  onCommit: (partial: boolean) => void;
  onCsvText: (text: string) => void;
  onCsvPreset: (id: string) => void;
  onCsvPreview: () => void;
  onCsvStore: () => void;
};
