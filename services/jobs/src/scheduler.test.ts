import { describe, expect, it, vi } from "vitest";
import { startScheduler } from "./scheduler.js";

describe("startScheduler", () => {
  it("keeps the process alive by default (timers stay referenced) and logs a failing job instead of throwing", async () => {
    const setSpy = vi.spyOn(globalThis, "setInterval");
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const handle = startScheduler([{ name: "boom", everyMs: 60_000, run: async () => Promise.reject(new Error("nope")) }]);
    const timer = setSpy.mock.results[0]!.value as NodeJS.Timeout;
    expect(timer.hasRef()).toBe(true);
    await new Promise((r) => setTimeout(r, 10));
    expect(errors).toHaveBeenCalledWith("[scheduler] boom failed", expect.any(Error));
    handle.stop();
    setSpy.mockRestore();
    errors.mockRestore();
  });

  it("lets tests opt out of keeping the process alive", () => {
    const setSpy = vi.spyOn(globalThis, "setInterval");
    const handle = startScheduler([{ name: "quiet", everyMs: 60_000, run: () => {} }], { runImmediately: false, keepAlive: false });
    expect((setSpy.mock.results[0]!.value as NodeJS.Timeout).hasRef()).toBe(false);
    handle.stop();
    setSpy.mockRestore();
  });
});
