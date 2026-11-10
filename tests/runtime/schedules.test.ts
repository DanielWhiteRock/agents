import { describe, it, expect } from "vitest";
import { isDue, cadenceLabel } from "../../src/app/schedules.js";

const at = (iso: string) => new Date(iso);
const sched = (over: Partial<Parameters<typeof isDue>[0]> = {}) => ({
  cadence: "daily" as const, hour: 9, weekday: 1, enabled: 1, last_run_at: null, ...over,
});

describe("isDue", () => {
  it("never fires a disabled schedule", () => {
    expect(isDue(sched({ enabled: 0 }), at("2026-11-10T09:00:00Z"))).toBe(false);
  });

  describe("daily", () => {
    it("fires in its hour when it has never run", () => {
      expect(isDue(sched(), at("2026-11-10T09:30:00Z"))).toBe(true);
    });
    it("stays quiet outside its hour", () => {
      expect(isDue(sched(), at("2026-11-10T08:59:00Z"))).toBe(false);
      expect(isDue(sched(), at("2026-11-10T10:00:00Z"))).toBe(false);
    });
    it("does not fire twice in the same hour — the ticker runs every minute", () => {
      const s = sched({ last_run_at: "2026-11-10T09:00:30Z" });
      expect(isDue(s, at("2026-11-10T09:01:30Z"))).toBe(false);
      expect(isDue(s, at("2026-11-10T09:59:00Z"))).toBe(false);
    });
    it("fires again the next day", () => {
      expect(isDue(sched({ last_run_at: "2026-11-10T09:00:00Z" }), at("2026-11-11T09:00:00Z"))).toBe(true);
    });
    it("handles midnight as an hour like any other", () => {
      expect(isDue(sched({ hour: 0 }), at("2026-11-10T00:10:00Z"))).toBe(true);
      expect(isDue(sched({ hour: 0, last_run_at: "2026-11-10T00:00:00Z" }), at("2026-11-10T00:30:00Z"))).toBe(false);
    });
    it("crosses a month boundary without firing twice or skipping", () => {
      expect(isDue(sched({ last_run_at: "2026-11-30T09:00:00Z" }), at("2026-11-30T09:30:00Z"))).toBe(false);
      expect(isDue(sched({ last_run_at: "2026-11-30T09:00:00Z" }), at("2026-12-01T09:00:00Z"))).toBe(true);
    });
    it("is not confused by the same day number in a different month", () => {
      expect(isDue(sched({ last_run_at: "2026-10-10T09:00:00Z" }), at("2026-11-10T09:00:00Z"))).toBe(true);
    });
  });

  describe("weekly", () => {
    const weekly = (over = {}) => sched({ cadence: "weekly", weekday: 1, ...over });
    it("fires on its weekday in its hour", () => {
      // 2026-11-09 is a Monday.
      expect(isDue(weekly(), at("2026-11-09T09:00:00Z"))).toBe(true);
    });
    it("stays quiet on other days", () => {
      expect(isDue(weekly(), at("2026-11-10T09:00:00Z"))).toBe(false);
    });
    it("fires again the following week", () => {
      expect(isDue(weekly({ last_run_at: "2026-11-09T09:00:00Z" }), at("2026-11-16T09:00:00Z"))).toBe(true);
    });
  });

  describe("hourly", () => {
    const hourly = (over = {}) => sched({ cadence: "hourly", ...over });
    it("fires immediately when it has never run", () => {
      expect(isDue(hourly(), at("2026-11-10T04:17:00Z"))).toBe(true);
    });
    it("waits out the hour", () => {
      expect(isDue(hourly({ last_run_at: "2026-11-10T04:00:00Z" }), at("2026-11-10T04:30:00Z"))).toBe(false);
    });
    it("fires a minute early rather than slipping a whole hour on a restart", () => {
      expect(isDue(hourly({ last_run_at: "2026-11-10T04:00:00Z" }), at("2026-11-10T04:59:00Z"))).toBe(true);
    });
    it("ignores the configured hour", () => {
      expect(isDue(hourly({ hour: 9 }), at("2026-11-10T23:00:00Z"))).toBe(true);
    });
  });
});

describe("cadenceLabel", () => {
  it("reads like a sentence", () => {
    expect(cadenceLabel({ cadence: "hourly", hour: 9, weekday: 1 })).toBe("every hour");
    expect(cadenceLabel({ cadence: "daily", hour: 7, weekday: 1 })).toBe("every day at 07:00 UTC");
    expect(cadenceLabel({ cadence: "weekly", hour: 18, weekday: 5 })).toBe("every Friday at 18:00 UTC");
  });
});
