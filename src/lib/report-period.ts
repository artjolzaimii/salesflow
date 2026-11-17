/**
 * Reporting periods. All boundaries are business calendar dates
 * (Europe/Tirane, YYYY-MM-DD), inclusive at both ends:
 * - today:  today
 * - week:   Monday of this ISO week → today
 * - month:  1st of this month → today
 * - year:   1 January → today
 * - custom: from → to (at most MAX_CUSTOM_DAYS days)
 * Each period has a comparison period of the same shape just before it
 * (yesterday, last week to the same weekday, last month to the same day, last
 * year to the same date, or the equally long range ending the day before).
 */
export const PERIODS = ["today", "week", "month", "year", "custom"] as const;
export type PeriodPreset = (typeof PERIODS)[number];
export const PERIOD_LABEL: Record<PeriodPreset, string> = { today: "Today", week: "This week", month: "This month", year: "This year", custom: "Custom" };
export const MAX_CUSTOM_DAYS = 3660;

export interface ResolvedPeriod {
  preset: PeriodPreset;
  from: string;
  to: string;
  label: string;
  prevFrom: string;
  prevTo: string;
  prevLabel: string;
  /** Inclusive length in days. */
  days: number;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const toDate = (s: string) => new Date(s + "T00:00:00Z");
const fmt = (d: Date) => d.toISOString().slice(0, 10);
export const shiftDays = (s: string, n: number) => {
  const d = toDate(s);
  d.setUTCDate(d.getUTCDate() + n);
  return fmt(d);
};
export const daysInclusive = (from: string, to: string) => Math.round((toDate(to).getTime() - toDate(from).getTime()) / 86_400_000) + 1;
const lastDayOfMonth = (y: number, m: number) => new Date(Date.UTC(y, m + 1, 0)).getUTCDate();

/** "17 Nov 2026", "1–17 Nov 2026", "3 Oct – 17 Nov 2026", "3 Oct 2025 – 17 Nov 2026". */
export function rangeLabel(from: string, to: string): string {
  const [fy, fm, fd] = from.split("-").map(Number);
  const [ty, tm, td] = to.split("-").map(Number);
  if (from === to) return `${td} ${MONTHS[tm - 1]} ${ty}`;
  if (fy === ty && fm === tm) return `${fd}–${td} ${MONTHS[tm - 1]} ${ty}`;
  if (fy === ty) return `${fd} ${MONTHS[fm - 1]} – ${td} ${MONTHS[tm - 1]} ${ty}`;
  return `${fd} ${MONTHS[fm - 1]} ${fy} – ${td} ${MONTHS[tm - 1]} ${ty}`;
}

export function resolvePeriod(preset: PeriodPreset, today: string, custom?: { from: string; to: string }): ResolvedPeriod {
  const [y, m, d] = today.split("-").map(Number);
  let from = today;
  let to = today;
  let prevFrom: string;
  let prevTo: string;
  switch (preset) {
    case "today":
      prevFrom = prevTo = shiftDays(today, -1);
      break;
    case "week": {
      const weekday = (toDate(today).getUTCDay() + 6) % 7; // Monday = 0
      from = shiftDays(today, -weekday);
      prevFrom = shiftDays(from, -7);
      prevTo = shiftDays(today, -7);
      break;
    }
    case "month": {
      from = `${today.slice(0, 7)}-01`;
      const py = m === 1 ? y - 1 : y;
      const pm = m === 1 ? 11 : m - 2; // 0-based previous month
      prevFrom = `${py}-${String(pm + 1).padStart(2, "0")}-01`;
      prevTo = `${py}-${String(pm + 1).padStart(2, "0")}-${String(Math.min(d, lastDayOfMonth(py, pm))).padStart(2, "0")}`;
      break;
    }
    case "year": {
      from = `${y}-01-01`;
      prevFrom = `${y - 1}-01-01`;
      prevTo = `${y - 1}-${String(m).padStart(2, "0")}-${String(Math.min(d, lastDayOfMonth(y - 1, m - 1))).padStart(2, "0")}`;
      break;
    }
    case "custom": {
      if (!custom) throw new Error("A custom period needs from and to.");
      from = custom.from;
      to = custom.to;
      const n = daysInclusive(from, to);
      prevTo = shiftDays(from, -1);
      prevFrom = shiftDays(from, -n);
      break;
    }
  }
  return { preset, from, to, label: rangeLabel(from, to), prevFrom, prevTo, prevLabel: rangeLabel(prevFrom, prevTo), days: daysInclusive(from, to) };
}
