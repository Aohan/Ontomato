import { config } from "../../../config/application";

const TIMEZONE = config.schedule.timezone;

function getDatePartsInTz(ts: number): {
  year: number;
  month: number;
  day: number;
  hours: number;
  minutes: number;
  seconds: number;
} {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
  const parts = fmt.formatToParts(new Date(ts));
  const get = (type: string) => parseInt(parts.find((p) => p.type === type)?.value || "0", 10);
  return {
    year: get("year"),
    month: get("month"),
    day: get("day"),
    hours: get("hour"),
    minutes: get("minute"),
    seconds: get("second"),
  };
}

function getDayOfWeekInTz(ts: number): number {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: TIMEZONE,
    weekday: "short",
  });
  const short = fmt.format(new Date(ts));
  const map: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return map[short] ?? 0;
}

function getLastDayOfMonthInTz(year: number, month: number): number {
  const nextMonth = month === 12 ? 1 : month + 1;
  const nextYear = month === 12 ? year + 1 : year;
  const naive = `${nextYear}-${String(nextMonth).padStart(2, "0")}-01T12:00:00Z`;
  const firstOfNext = Date.parse(naive);
  const prevDayTs = firstOfNext - 24 * 60 * 60 * 1000;
  const parts = getDatePartsInTz(prevDayTs);
  return parts.day;
}

function utcFromTzParts(
  year: number,
  month: number,
  day: number,
  hours: number,
  minutes: number
): number {
  const naiveMs = Date.UTC(year, month - 1, day, hours, minutes, 0);
  if (isNaN(naiveMs)) return 0;

  const tzParts = getDatePartsInTz(naiveMs);

  const d = new Date(naiveMs);
  const naiveUtcHours = d.getUTCHours();
  const naiveUtcMinutes = d.getUTCMinutes();

  let offsetMinutes = naiveUtcHours * 60 + naiveUtcMinutes - (tzParts.hours * 60 + tzParts.minutes);
  if (offsetMinutes < -720) offsetMinutes += 1440;
  if (offsetMinutes > 720) offsetMinutes -= 1440;

  return naiveMs + offsetMinutes * 60 * 1000;
}

function nextTimeOfDayWithOffset(
  base: number,
  hours: number,
  minutes: number,
  daysOffset: number
): number {
  if (daysOffset > 1) {
    const parts = getDatePartsInTz(base);
    return utcFromTzParts(parts.year, parts.month, parts.day + daysOffset, hours, minutes);
  }

  const parts = getDatePartsInTz(base);
  const todayTs = utcFromTzParts(parts.year, parts.month, parts.day, hours, minutes);

  if (todayTs <= base) {
    return utcFromTzParts(parts.year, parts.month, parts.day + 1, hours, minutes);
  }

  return todayTs;
}

function nextDayOfWeek(base: number, targetDay: number, hours: number, minutes: number): number {
  const jsDay = targetDay === 7 ? 0 : targetDay;
  const parts = getDatePartsInTz(base);

  const dayTs = utcFromTzParts(parts.year, parts.month, parts.day, 0, 0);
  const currentDay = getDayOfWeekInTz(dayTs);
  let daysUntil = jsDay - currentDay;
  if (daysUntil < 0) daysUntil += 7;

  const todayTs = utcFromTzParts(parts.year, parts.month, parts.day, hours, minutes);
  if (daysUntil === 0 && todayTs <= base) daysUntil = 7;

  return utcFromTzParts(parts.year, parts.month, parts.day + daysUntil, hours, minutes);
}

function nextDayOfMonth(base: number, targetDay: number, hours: number, minutes: number): number {
  const parts = getDatePartsInTz(base);

  const lastDayThisMonth = getLastDayOfMonthInTz(parts.year, parts.month);
  const actualDay = Math.min(targetDay, lastDayThisMonth);

  let candidateTs = utcFromTzParts(parts.year, parts.month, actualDay, hours, minutes);

  if (candidateTs <= base) {
    const nextMonth = parts.month === 12 ? 1 : parts.month + 1;
    const nextYear = parts.month === 12 ? parts.year + 1 : parts.year;
    const lastDayNextMonth = getLastDayOfMonthInTz(nextYear, nextMonth);
    const nextActualDay = Math.min(targetDay, lastDayNextMonth);
    return utcFromTzParts(nextYear, nextMonth, nextActualDay, hours, minutes);
  }

  return candidateTs;
}

export function parseScheduleToNextRun(expression: string, lastRunAt?: number): number | null {
  const now = Date.now();
  const base = lastRunAt || now;

  const dayMatch = expression.match(/\/(\d+)$/);
  let dayTarget: number | null = null;
  let cleanExpression = expression;
  if (dayMatch) {
    dayTarget = parseInt(dayMatch[1], 10);
    cleanExpression = expression.slice(0, dayMatch.index);
  }

  const timeMatch = cleanExpression.match(/@(\d{1,2}):(\d{2})$/);
  let targetTime: { hours: number; minutes: number } | null = null;
  if (timeMatch) {
    targetTime = {
      hours: parseInt(timeMatch[1], 10),
      minutes: parseInt(timeMatch[2], 10),
    };
    cleanExpression = cleanExpression.slice(0, timeMatch.index);
  }

  const simpleMatch = cleanExpression.match(/^(\d+)\s*(m|h|d)$/i);
  if (simpleMatch) {
    const num = parseInt(simpleMatch[1], 10);
    const unit = simpleMatch[2].toLowerCase();

    if (unit === "d" && targetTime && dayTarget) {
      if (num === 7) {
        return nextDayOfWeek(lastRunAt || base, dayTarget, targetTime.hours, targetTime.minutes);
      }
      if (num === 30) {
        return nextDayOfMonth(lastRunAt || base, dayTarget, targetTime.hours, targetTime.minutes);
      }
    }

    if (unit === "d" && targetTime) {
      return nextTimeOfDayWithOffset(base, targetTime.hours, targetTime.minutes, num);
    }

    switch (unit) {
      case "m":
        return base + num * 60 * 1000;
      case "h":
        return base + num * 60 * 60 * 1000;
      case "d":
        return base + num * 24 * 60 * 60 * 1000;
      default:
        return null;
    }
  }

  const cronMatch = cleanExpression.match(/^\*\/(\d+)$/);
  if (cronMatch) {
    return base + parseInt(cronMatch[1], 10) * 60 * 1000;
  }

  return null;
}
