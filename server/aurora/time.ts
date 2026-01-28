import { DateTime } from "luxon";

const MARKET_TZ = "America/New_York";

export type MarketSession = 
  | "CLOSED_WEEKEND"
  | "CLOSED_HOLIDAY"
  | "CLOSED"
  | "PRE_MARKET"
  | "OPENING_RANGE"
  | "MORNING"
  | "AFTERNOON"
  | "POWER_HOUR"
  | "OPEN";

export const MarketTime = {
  now: (): DateTime => DateTime.now().setZone(MARKET_TZ),

  getSession: (holidays: Set<string> = new Set(), halfDays: Set<string> = new Set()): MarketSession => {
    const now = MarketTime.now();
    const dateStr = now.toFormat("yyyy-MM-dd");

    if (now.weekday > 5) return "CLOSED_WEEKEND";
    if (holidays.has(dateStr)) return "CLOSED_HOLIDAY";

    const totalMinutes = now.hour * 60 + now.minute;
    const closeTime = halfDays.has(dateStr) ? 780 : 960; // 1:00 PM or 4:00 PM

    // After close or before pre-market
    if (totalMinutes >= closeTime || totalMinutes < 240) return "CLOSED";

    // Pre-market: 4:00 AM - 9:30 AM
    if (totalMinutes >= 240 && totalMinutes < 570) return "PRE_MARKET";

    // Market is open - determine session (bounded by closeTime)
    if (totalMinutes >= 570 && totalMinutes < Math.min(600, closeTime)) return "OPENING_RANGE";
    if (totalMinutes >= 600 && totalMinutes < Math.min(720, closeTime)) return "MORNING";
    if (totalMinutes >= 720 && totalMinutes < Math.min(780, closeTime)) return "AFTERNOON";
    if (totalMinutes >= 780 && totalMinutes < closeTime) return "POWER_HOUR";

    // Fallback for any edge case during trading hours
    if (totalMinutes >= 570 && totalMinutes < closeTime) return "OPEN";

    return "CLOSED";
  },

  getDetailedSession: (holidays: Set<string> = new Set(), halfDays: Set<string> = new Set()): MarketSession => {
    const now = MarketTime.now();
    const dateStr = now.toFormat("yyyy-MM-dd");

    if (now.weekday > 5) return "CLOSED_WEEKEND";
    if (holidays.has(dateStr)) return "CLOSED_HOLIDAY";

    const totalMinutes = now.hour * 60 + now.minute;
    const closeTime = halfDays.has(dateStr) ? 780 : 960;

    // After close or before pre-market
    if (totalMinutes >= closeTime || totalMinutes < 240) return "CLOSED";

    if (totalMinutes >= 240 && totalMinutes < 570) return "PRE_MARKET";
    if (totalMinutes >= 570 && totalMinutes < Math.min(600, closeTime)) return "OPENING_RANGE";
    if (totalMinutes >= 600 && totalMinutes < Math.min(720, closeTime)) return "MORNING";
    if (totalMinutes >= 720 && totalMinutes < Math.min(780, closeTime)) return "AFTERNOON";
    if (totalMinutes >= 780 && totalMinutes < closeTime) return "POWER_HOUR";

    return "CLOSED";
  },

  isMarketOpen: (holidays: Set<string> = new Set(), halfDays: Set<string> = new Set()): boolean => {
    return MarketTime.isTradingHours(holidays, halfDays);
  },

  isPreMarket: (holidays: Set<string> = new Set()): boolean => {
    const now = MarketTime.now();
    const dateStr = now.toFormat("yyyy-MM-dd");

    if (now.weekday > 5) return false;
    if (holidays.has(dateStr)) return false;

    const totalMinutes = now.hour * 60 + now.minute;
    return totalMinutes >= 240 && totalMinutes < 570;
  },

  isTradingHours: (holidays: Set<string> = new Set(), halfDays: Set<string> = new Set()): boolean => {
    const now = MarketTime.now();
    const dateStr = now.toFormat("yyyy-MM-dd");

    if (now.weekday > 5) return false;
    if (holidays.has(dateStr)) return false;

    const totalMinutes = now.hour * 60 + now.minute;
    const closeTime = halfDays.has(dateStr) ? 780 : 960;

    return totalMinutes >= 570 && totalMinutes < closeTime;
  },

  sqlFormat: (dt: DateTime = MarketTime.now()): string => {
    return dt.toFormat("yyyy-MM-dd HH:mm:ss");
  },

  dateFormat: (dt: DateTime = MarketTime.now()): string => {
    return dt.toFormat("yyyy-MM-dd");
  },

  fromISO: (isoString: string): DateTime => {
    return DateTime.fromISO(isoString, { zone: MARKET_TZ });
  },

  fromSQL: (sqlString: string): DateTime => {
    return DateTime.fromSQL(sqlString, { zone: MARKET_TZ });
  },

  fromJSDate: (date: Date): DateTime => {
    return DateTime.fromJSDate(date, { zone: MARKET_TZ });
  },

  getMarketOpen: (dt: DateTime = MarketTime.now()): DateTime => {
    return dt.set({ hour: 9, minute: 30, second: 0, millisecond: 0 });
  },

  getMarketClose: (dt: DateTime = MarketTime.now(), isHalfDay: boolean = false): DateTime => {
    const closeHour = isHalfDay ? 13 : 16;
    return dt.set({ hour: closeHour, minute: 0, second: 0, millisecond: 0 });
  },

  getIBEnd: (dt: DateTime = MarketTime.now()): DateTime => {
    return dt.set({ hour: 10, minute: 30, second: 0, millisecond: 0 });
  },

  getORBEnd: (dt: DateTime = MarketTime.now()): DateTime => {
    return dt.set({ hour: 10, minute: 0, second: 0, millisecond: 0 });
  },

  minutesSinceOpen: (dt: DateTime = MarketTime.now()): number => {
    const open = MarketTime.getMarketOpen(dt);
    return dt.diff(open, "minutes").minutes;
  },

  minutesToClose: (dt: DateTime = MarketTime.now(), isHalfDay: boolean = false): number => {
    const close = MarketTime.getMarketClose(dt, isHalfDay);
    return close.diff(dt, "minutes").minutes;
  },

  isFriday: (dt: DateTime = MarketTime.now()): boolean => {
    return dt.weekday === 5;
  },

  getTodayET: (): string => {
    return MarketTime.now().toFormat("yyyy-MM-dd");
  },

  toISO: (dt: DateTime = MarketTime.now()): string => {
    return dt.toISO() || "";
  }
};
