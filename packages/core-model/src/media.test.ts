import { describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { markObserved } from "@vip/evidence";
import {
  CaptureImageSchema,
  CaptureSessionSchema,
} from "./media.js";

describe("CaptureSession / CaptureImage intake tier", () => {
  it("defaults to inventory_intake + intake quality for Ricoh path", () => {
    const now = new Date();
    const session = CaptureSessionSchema.parse({
      id: randomUUID(),
      createdAt: now,
      updatedAt: now,
      provenance: markObserved({
        source: "ricoh_fi8170",
        ruleOrModelVersion: "scan-ingest@0.1.0",
        confidence: 1,
      }),
      modelVersion: "scan-ingest@0.1.0",
      device: "ricoh_fi8170",
      categoryHint: "sports",
    });
    expect(session.purpose).toBe("inventory_intake");
    expect(session.qualityTier).toBe("intake");

    const image = CaptureImageSchema.parse({
      id: randomUUID(),
      createdAt: now,
      updatedAt: now,
      provenance: session.provenance,
      sessionId: session.id,
      contentHash: "abc123",
      storageRef: "scans/fi8170/card_front.jpg",
      face: "front",
      unitIndex: 0,
    });
    expect(image.qualityTier).toBe("intake");
    expect(image.face).toBe("front");
  });
});
