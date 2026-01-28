/**
 * Aurora ORB - Opening Range Breakout Calculator
 * 
 * Calculates the "Kill Box" from the first 30 minutes of trading (09:30-10:00 ET).
 * Used to determine entry triggers, stop losses, and profit targets.
 */

import type { Candle } from "./types";

export interface ORBLevels {
  high: number;
  low: number;
  mid: number;
  rangeSize: number;
  
  // Profit Targets (Measured Moves)
  targetBull1: number;  // 100% Range Extension
  targetBull2: number;  // 200% Range Extension
  targetBear1: number;
  targetBear2: number;
  
  // Risk Management
  stopLossLong: number;
  stopLossShort: number;
}

export interface ORBEntry {
  signal: "ENTRY_LONG" | "ENTRY_SHORT";
  entry: number;
  stop: number;
  target: number;
  riskReward: number;
}

/**
 * Calculates Opening Range Breakout levels from the first 30 minutes of candles
 */
export function calculateORB(candles: Candle[]): ORBLevels | null {
  if (!candles || candles.length === 0) return null;

  let rangeHigh = -Infinity;
  let rangeLow = Infinity;

  for (const c of candles) {
    if (c.high > rangeHigh) rangeHigh = c.high;
    if (c.low < rangeLow) rangeLow = c.low;
  }

  if (!isFinite(rangeHigh) || !isFinite(rangeLow)) return null;

  const rangeSize = rangeHigh - rangeLow;
  const midPoint = rangeLow + (rangeSize / 2);

  return {
    high: rangeHigh,
    low: rangeLow,
    mid: midPoint,
    rangeSize,
    
    // BULLISH Targets (Calls)
    targetBull1: rangeHigh + rangeSize,
    targetBull2: rangeHigh + (rangeSize * 2),
    stopLossLong: midPoint,
    
    // BEARISH Targets (Puts)
    targetBear1: rangeLow - rangeSize,
    targetBear2: rangeLow - (rangeSize * 2),
    stopLossShort: midPoint,
  };
}

/**
 * Checks if current price has triggered an ORB entry signal
 */
export function checkORBEntry(
  currentPrice: number,
  levels: ORBLevels,
  momentum: "BULLISH" | "BEARISH" | "NEUTRAL"
): ORBEntry | null {
  const BUFFER = 0.05;

  if (momentum === "BULLISH" && currentPrice > (levels.high + BUFFER)) {
    const risk = (levels.high + BUFFER) - levels.stopLossLong;
    const reward = levels.targetBull1 - (levels.high + BUFFER);
    
    return {
      signal: "ENTRY_LONG",
      entry: levels.high + BUFFER,
      stop: levels.stopLossLong,
      target: levels.targetBull1,
      riskReward: risk > 0 ? reward / risk : 0,
    };
  }

  if (momentum === "BEARISH" && currentPrice < (levels.low - BUFFER)) {
    const risk = levels.stopLossShort - (levels.low - BUFFER);
    const reward = (levels.low - BUFFER) - levels.targetBear1;
    
    return {
      signal: "ENTRY_SHORT",
      entry: levels.low - BUFFER,
      stop: levels.stopLossShort,
      target: levels.targetBear1,
      riskReward: risk > 0 ? reward / risk : 0,
    };
  }

  return null;
}

/**
 * Get opening range candles (first 30 minutes)
 * Assumes candles are 1-minute intervals starting at market open
 */
export function getOpeningRangeCandles(candles: Candle[]): Candle[] {
  return candles.slice(0, 30);
}

/**
 * Determine if price is above, below, or inside the opening range
 */
export function getORBPosition(
  currentPrice: number,
  levels: ORBLevels
): "ABOVE" | "BELOW" | "INSIDE" {
  if (currentPrice > levels.high) return "ABOVE";
  if (currentPrice < levels.low) return "BELOW";
  return "INSIDE";
}
