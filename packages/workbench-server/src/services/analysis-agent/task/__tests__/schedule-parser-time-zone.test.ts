import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * The schedule follows the process time zone unless SCHEDULE_TIMEZONE overrides it, so every case
 * runs the real parser under a real TZ. The module reads the zone when it is imported, hence the
 * module registry reset before each import.
 */

const originalTz = process.env.TZ;
const originalScheduleTz = process.env.SCHEDULE_TIMEZONE;

afterEach(() => {
  if (originalTz === undefined) delete process.env.TZ;
  else process.env.TZ = originalTz;
  if (originalScheduleTz === undefined) delete process.env.SCHEDULE_TIMEZONE;
  else process.env.SCHEDULE_TIMEZONE = originalScheduleTz;
  vi.resetModules();
});

async function loadInZone(tz: string, scheduleTz?: string) {
  process.env.TZ = tz;
  if (scheduleTz === undefined) delete process.env.SCHEDULE_TIMEZONE;
  else process.env.SCHEDULE_TIMEZONE = scheduleTz;
  vi.resetModules();
  return import("../schedule-parser");
}

async function loadConfigInZone(tz: string, scheduleTz?: string) {
  process.env.TZ = tz;
  if (scheduleTz === undefined) delete process.env.SCHEDULE_TIMEZONE;
  else process.env.SCHEDULE_TIMEZONE = scheduleTz;
  vi.resetModules();
  return import("../../../../config/application");
}

const nextRunIn = async (tz: string, expression: string, baseIso: string) => {
  const { parseScheduleToNextRun } = await loadInZone(tz);
  const next = parseScheduleToNextRun(expression, Date.parse(baseIso));
  return next == null ? null : new Date(next).toISOString();
};

describe("schedule time zone resolution", () => {
  it("defaults to the process time zone and keeps an explicit SCHEDULE_TIMEZONE ahead of it", async () => {
    expect((await loadConfigInZone("UTC")).config.schedule.timezone).toBe("UTC");
    expect((await loadConfigInZone("America/New_York")).config.schedule.timezone).toBe(
      "America/New_York"
    );
    expect((await loadConfigInZone("UTC", "Europe/Berlin")).config.schedule.timezone).toBe(
      "Europe/Berlin"
    );
  });

  it("keeps the existing UTC and Asia/Shanghai daily plans unchanged", async () => {
    const base = "2026-03-08T05:00:00Z";
    expect(await nextRunIn("UTC", "1d@03:30", base)).toBe("2026-03-09T03:30:00.000Z");
    expect(await nextRunIn("Asia/Shanghai", "1d@03:30", base)).toBe("2026-03-08T19:30:00.000Z");
  });

  it("resolves local 03:30 across the New York spring-forward change", async () => {
    // 03:30 exists on the transition day and is EDT (UTC-4); the base instant is 00:00 EST.
    expect(await nextRunIn("America/New_York", "1d@03:30", "2026-03-08T05:00:00Z")).toBe(
      "2026-03-08T07:30:00.000Z"
    );
  });

  it("resolves local 03:30 across the New York fall-back change", async () => {
    // 03:30 exists on the transition day and is EST (UTC-5); the base instant is 00:00 EDT.
    expect(await nextRunIn("America/New_York", "1d@03:30", "2026-11-01T04:00:00Z")).toBe(
      "2026-11-01T08:30:00.000Z"
    );
  });

  it("advances local midnight by the zone offset in effect on the next day", async () => {
    // The base is exactly local midnight EST; the next local midnight is already EDT.
    expect(await nextRunIn("America/New_York", "1d@00:00", "2026-03-08T05:00:00Z")).toBe(
      "2026-03-09T04:00:00.000Z"
    );
  });

  it("keeps the weekly and monthly plans aligned with the local wall clock", async () => {
    expect(await nextRunIn("America/New_York", "7d@03:30/1", "2026-03-06T05:00:00Z")).toBe(
      "2026-03-09T07:30:00.000Z"
    );
    expect(await nextRunIn("America/New_York", "30d@03:30/15", "2026-11-10T05:00:00Z")).toBe(
      "2026-11-15T08:30:00.000Z"
    );
    expect(await nextRunIn("Asia/Shanghai", "7d@03:30/1", "2026-03-06T05:00:00Z")).toBe(
      "2026-03-08T19:30:00.000Z"
    );
  });
});
