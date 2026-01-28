import { MarketTime } from "./time";

export interface MarketCalendar {
  holidays: Set<string>;
  halfDays: Set<string>;
}

const HOLIDAYS_2024: string[] = [
  "2024-01-01",
  "2024-01-15",
  "2024-02-19",
  "2024-03-29",
  "2024-05-27",
  "2024-06-19",
  "2024-07-04",
  "2024-09-02",
  "2024-11-28",
  "2024-12-25",
];

const HALF_DAYS_2024: string[] = [
  "2024-07-03",
  "2024-11-29",
  "2024-12-24",
];

const HOLIDAYS_2025: string[] = [
  "2025-01-01",
  "2025-01-20",
  "2025-02-17",
  "2025-04-18",
  "2025-05-26",
  "2025-06-19",
  "2025-07-04",
  "2025-09-01",
  "2025-11-27",
  "2025-12-25",
];

const HALF_DAYS_2025: string[] = [
  "2025-07-03",
  "2025-11-28",
  "2025-12-24",
];

const HOLIDAYS_2026: string[] = [
  "2026-01-01",
  "2026-01-19",
  "2026-02-16",
  "2026-04-03",
  "2026-05-25",
  "2026-06-19",
  "2026-07-03",
  "2026-09-07",
  "2026-11-26",
  "2026-12-25",
];

const HALF_DAYS_2026: string[] = [
  "2026-07-02",
  "2026-11-27",
  "2026-12-24",
];

const ALL_HOLIDAYS = new Set([...HOLIDAYS_2024, ...HOLIDAYS_2025, ...HOLIDAYS_2026]);
const ALL_HALF_DAYS = new Set([...HALF_DAYS_2024, ...HALF_DAYS_2025, ...HALF_DAYS_2026]);

export const MarketCalendar = {
  getCalendar: (): MarketCalendar => ({
    holidays: ALL_HOLIDAYS,
    halfDays: ALL_HALF_DAYS,
  }),

  isHoliday: (dateStr: string): boolean => {
    return ALL_HOLIDAYS.has(dateStr);
  },

  isHalfDay: (dateStr: string): boolean => {
    return ALL_HALF_DAYS.has(dateStr);
  },

  isWeekend: (dateStr: string): boolean => {
    const dt = MarketTime.fromISO(dateStr);
    return dt.weekday > 5;
  },

  isTradingDay: (dateStr: string): boolean => {
    if (MarketCalendar.isWeekend(dateStr)) return false;
    if (MarketCalendar.isHoliday(dateStr)) return false;
    return true;
  },

  getCloseTime: (dateStr: string): string => {
    if (MarketCalendar.isHalfDay(dateStr)) {
      return "13:00:00";
    }
    return "16:00:00";
  },

  getNextTradingDay: (fromDate: string): string => {
    let dt = MarketTime.fromISO(fromDate).plus({ days: 1 });
    let attempts = 0;
    
    while (!MarketCalendar.isTradingDay(dt.toFormat("yyyy-MM-dd")) && attempts < 10) {
      dt = dt.plus({ days: 1 });
      attempts++;
    }
    
    return dt.toFormat("yyyy-MM-dd");
  },

  getPreviousTradingDay: (fromDate: string): string => {
    let dt = MarketTime.fromISO(fromDate).minus({ days: 1 });
    let attempts = 0;
    
    while (!MarketCalendar.isTradingDay(dt.toFormat("yyyy-MM-dd")) && attempts < 10) {
      dt = dt.minus({ days: 1 });
      attempts++;
    }
    
    return dt.toFormat("yyyy-MM-dd");
  },

  getTradingDaysInRange: (startDate: string, endDate: string): string[] => {
    const days: string[] = [];
    let dt = MarketTime.fromISO(startDate);
    const end = MarketTime.fromISO(endDate);
    
    while (dt <= end) {
      const dateStr = dt.toFormat("yyyy-MM-dd");
      if (MarketCalendar.isTradingDay(dateStr)) {
        days.push(dateStr);
      }
      dt = dt.plus({ days: 1 });
    }
    
    return days;
  },

  isFriday0DTEDay: (dateStr: string): boolean => {
    if (!MarketCalendar.isTradingDay(dateStr)) return false;
    const dt = MarketTime.fromISO(dateStr);
    return dt.weekday === 5;
  },

  isDaily0DTEDay: (dateStr: string): boolean => {
    return MarketCalendar.isTradingDay(dateStr);
  },

  getDayType: (dateStr: string): "HOLIDAY" | "WEEKEND" | "HALF_DAY" | "NORMAL" => {
    if (MarketCalendar.isHoliday(dateStr)) return "HOLIDAY";
    if (MarketCalendar.isWeekend(dateStr)) return "WEEKEND";
    if (MarketCalendar.isHalfDay(dateStr)) return "HALF_DAY";
    return "NORMAL";
  },

  getHolidaysSet: (): Set<string> => {
    return ALL_HOLIDAYS;
  },

  getHalfDaysSet: (): Set<string> => {
    return ALL_HALF_DAYS;
  },
};
