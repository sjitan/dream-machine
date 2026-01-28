/**
 * Institutional Flow Indicators - Pure TypeScript Implementation
 * 
 * Includes:
 * - IB (Initial Balance) - First 60 minutes range
 * - CVD (Cumulative Volume Delta)
 * - AVWAP (Anchored VWAP)
 * - Opening Type Classification
 */

import type { Candle } from "./types";

export interface InitialBalance {
  ibHigh: number;
  ibLow: number;
  ibWidth: number;
  openingType: OpeningType;
  isClean: boolean;
}

export type OpeningType = 
  | "OPEN_DRIVE"
  | "OPEN_TEST_DRIVE"
  | "OPEN_REJECTION_REVERSE"
  | "OPEN_AUCTION";

export interface OrderFlowSnapshot {
  delta: number;
  cumulativeDelta: number;
  anchoredVwap: number;
  cvdDivergence: boolean;
}

export function calculateInitialBalance(
  candles: Candle[],
  ibDurationMinutes: number = 60
): InitialBalance | null {
  if (!candles || candles.length === 0) return null;

  const marketOpenTime = new Date(candles[0].timestamp);
  marketOpenTime.setSeconds(0, 0);

  const ibCutoff = new Date(marketOpenTime.getTime() + ibDurationMinutes * 60 * 1000);

  const ibCandles = candles.filter(c => new Date(c.timestamp) < ibCutoff);
  if (ibCandles.length === 0) return null;

  const ibHigh = Math.max(...ibCandles.map(c => c.high));
  const ibLow = Math.min(...ibCandles.map(c => c.low));
  const ibWidth = ibHigh - ibLow;

  const firstCandle = candles[0];
  const openPrice = firstCandle.open;
  
  const openingType = classifyOpeningType(openPrice, ibHigh, ibLow, ibWidth, ibCandles);

  const isClean = !ibCandles.some((c, i) => {
    if (i === 0) return false;
    const prevC = ibCandles[i - 1];
    return Math.abs(c.open - prevC.close) > ibWidth * 0.1;
  });

  return {
    ibHigh,
    ibLow,
    ibWidth,
    openingType,
    isClean,
  };
}

function classifyOpeningType(
  openPrice: number,
  ibHigh: number,
  ibLow: number,
  ibWidth: number,
  ibCandles: Candle[]
): OpeningType {
  if (ibCandles.length < 2) return "OPEN_AUCTION";

  const lastIBCandle = ibCandles[ibCandles.length - 1];
  const closePrice = lastIBCandle.close;

  const openToHighDist = ibHigh - openPrice;
  const openToLowDist = openPrice - ibLow;
  const closeToHighDist = ibHigh - closePrice;
  const closeToLowDist = closePrice - ibLow;

  const threshold = ibWidth * 0.2;

  if (openToLowDist < threshold && closeToHighDist < threshold) {
    return "OPEN_DRIVE";
  }
  if (openToHighDist < threshold && closeToLowDist < threshold) {
    return "OPEN_DRIVE";
  }

  if (openToLowDist < threshold && closeToLowDist < threshold) {
    return "OPEN_REJECTION_REVERSE";
  }
  if (openToHighDist < threshold && closeToHighDist < threshold) {
    return "OPEN_REJECTION_REVERSE";
  }

  const touchedLow = ibCandles.some(c => c.low === ibLow);
  const touchedHigh = ibCandles.some(c => c.high === ibHigh);
  if (touchedLow && touchedHigh && Math.abs(closePrice - openPrice) < ibWidth * 0.3) {
    return "OPEN_TEST_DRIVE";
  }

  return "OPEN_AUCTION";
}

export function calculateDelta(candle: Candle): number {
  const body = candle.close - candle.open;
  const bodyPercent = Math.abs(body) / (candle.high - candle.low || 1);
  
  const sign = body >= 0 ? 1 : -1;
  return sign * candle.volume * bodyPercent;
}

export function calculateCumulativeDelta(candles: Candle[]): number[] {
  const deltas: number[] = [];
  let cumulative = 0;

  for (const candle of candles) {
    const delta = calculateDelta(candle);
    cumulative += delta;
    deltas.push(cumulative);
  }

  return deltas;
}

export function calculateAnchoredVWAP(
  candles: Candle[],
  anchorIndex: number = 0
): number | null {
  if (candles.length === 0 || anchorIndex >= candles.length) return null;

  let cumulativeTPV = 0;
  let cumulativeVolume = 0;

  for (let i = anchorIndex; i < candles.length; i++) {
    const c = candles[i];
    const typicalPrice = (c.high + c.low + c.close) / 3;
    cumulativeTPV += typicalPrice * c.volume;
    cumulativeVolume += c.volume;
  }

  if (cumulativeVolume === 0) return null;
  return cumulativeTPV / cumulativeVolume;
}

export function detectCVDDivergence(
  priceDirection: "UP" | "DOWN",
  cvdDirection: "UP" | "DOWN"
): boolean {
  return priceDirection !== cvdDirection;
}

export function computeOrderFlowSnapshot(
  candles: Candle[],
  anchorIndex: number = 0
): OrderFlowSnapshot | null {
  if (candles.length === 0) return null;

  const lastCandle = candles[candles.length - 1];
  const delta = calculateDelta(lastCandle);
  
  const cumulativeDeltas = calculateCumulativeDelta(candles);
  const cumulativeDelta = cumulativeDeltas[cumulativeDeltas.length - 1] || 0;
  
  const anchoredVwap = calculateAnchoredVWAP(candles, anchorIndex);
  if (anchoredVwap === null) return null;

  const priceDirection = candles.length > 1 && 
    candles[candles.length - 1].close > candles[0].close ? "UP" : "DOWN";
  const cvdDirection = cumulativeDelta > 0 ? "UP" : "DOWN";
  const cvdDivergence = detectCVDDivergence(priceDirection, cvdDirection);

  return {
    delta,
    cumulativeDelta,
    anchoredVwap,
    cvdDivergence,
  };
}

export function getIBSignal(
  currentPrice: number,
  ib: InitialBalance
): { bias: "LONG" | "SHORT" | "NEUTRAL"; reason: string } {
  if (currentPrice > ib.ibHigh) {
    return { bias: "LONG", reason: "Price broke above IB High - bullish breakout" };
  }
  if (currentPrice < ib.ibLow) {
    return { bias: "SHORT", reason: "Price broke below IB Low - bearish breakout" };
  }
  return { bias: "NEUTRAL", reason: "Price within Initial Balance range" };
}
