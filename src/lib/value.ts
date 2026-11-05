import type { Item } from "../api";

// Typical useful life in years, for straight-line depreciation (0 = holds value).
const LIFESPAN: Record<string, number> = {
  electronics: 5, appliances: 10, furniture: 12, tools: 15, clothing: 4, shoes: 3, accessories: 6, toys: 5,
  books: 10, media: 10, sports: 8, outdoor: 8, kitchen: 8, decor: 15, bedding: 6, baby: 5, collectibles: 0,
  office: 8, other: 8,
};
const FLOOR = 0.1; // never depreciate below 10% of what was paid

/** "2021" → mid-2021, "2021-03" → mid-March, "2021-03-04" → that day. */
export function parseDate(s: string): Date | null {
  const m = s.match(/^(\d{4})(?:-(\d{2}))?(?:-(\d{2}))?$/);
  if (!m) return null;
  return new Date(Date.UTC(+m[1], m[2] ? +m[2] - 1 : 6, m[3] ? +m[3] : m[2] ? 15 : 1));
}

export interface CurrentValue {
  value: number; // per unit
  depreciated: boolean; // true: from purchase price and age; false: falls back to resale estimate
  lifeYears?: number;
  ageYears?: number;
}

export function currentValue(i: Item): CurrentValue {
  const bought = i.purchase_date ? parseDate(i.purchase_date) : null;
  if (i.purchase_price > 0 && bought) {
    const life = LIFESPAN[i.category] ?? 8;
    const age = Math.max(0, (Date.now() - bought.getTime()) / (365.25 * 86400_000));
    const value = life === 0 ? i.purchase_price : i.purchase_price * Math.max(FLOOR, 1 - age / life);
    return { value, depreciated: true, lifeYears: life, ageYears: age };
  }
  const resale = i.resale_low && i.resale_high ? (i.resale_low + i.resale_high) / 2 : i.resale_high || i.resale_low;
  return { value: resale || 0, depreciated: false };
}

/** Whole days from today until a YYYY-MM-DD date (negative once past). */
export function daysUntil(date: string): number | null {
  const d = parseDate(date);
  if (!d || date.length !== 10) return null;
  const today = new Date();
  const t = Date.UTC(today.getFullYear(), today.getMonth(), today.getDate());
  return Math.round((d.getTime() - t) / 86400_000);
}

export const WARRANTY_ALERT_DAYS = 30;

export const warrantyEndingSoon = (i: Item) => {
  if (i.status === "sold" || i.status === "donated" || !i.warranty_expires) return false;
  const d = daysUntil(i.warranty_expires);
  return d !== null && d >= 0 && d <= WARRANTY_ALERT_DAYS;
};

export const fmtDate = (s: string) => {
  const d = parseDate(s);
  if (!d) return s;
  const opts: Intl.DateTimeFormatOptions =
    s.length === 4 ? { year: "numeric", timeZone: "UTC" } : s.length === 7 ? { month: "short", year: "numeric", timeZone: "UTC" } : { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" };
  return d.toLocaleDateString("en-US", opts);
};
