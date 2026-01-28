/**
 * Technical Indicators - Pure TypeScript Implementation
 * 
 * Includes:
 * - RSI (Relative Strength Index)
 * - SMA (Simple Moving Average)
 * - EMA (Exponential Moving Average)
 * - VWAP (Volume Weighted Average Price)
 * - Bollinger Bands
 * - ATR (Average True Range)
 */

import type { Candle } from "./types";

export interface TechnicalSnapshot {
  rsi14: number | null;
  rsi5: number | null;
  sma9: number | null;
  sma20: number | null;
  vwap: number | null;
  bollingerUpper: number | null;
  bollingerLower: number | null;
  atr: number | null;
}

export function calculateSMA(values: number[], period: number): number | null {
  if (values.length < period) return null;
  const slice = values.slice(-period);
  const sum = slice.reduce((acc, v) => acc + v, 0);
  return sum / period;
}

export function calculateEMA(values: number[], period: number): number | null {
  if (values.length < period) return null;
  
  const k = 2 / (period + 1);
  let ema = calculateSMA(values.slice(0, period), period);
  if (ema === null) return null;
  
  for (let i = period; i < values.length; i++) {
    ema = values[i] * k + ema * (1 - k);
  }
  
  return ema;
}

export function calculateRSI(closes: number[], period: number): number | null {
  if (closes.length < period + 1) return null;

  const gains: number[] = [];
  const losses: number[] = [];

  for (let i = 1; i < closes.length; i++) {
    const change = closes[i] - closes[i - 1];
    gains.push(change > 0 ? change : 0);
    losses.push(change < 0 ? Math.abs(change) : 0);
  }

  if (gains.length < period) return null;

  let avgGain = 0;
  let avgLoss = 0;
  for (let i = 0; i < period; i++) {
    avgGain += gains[i];
    avgLoss += losses[i];
  }
  avgGain /= period;
  avgLoss /= period;

  for (let i = period; i < gains.length; i++) {
    avgGain = (avgGain * (period - 1) + gains[i]) / period;
    avgLoss = (avgLoss * (period - 1) + losses[i]) / period;
  }

  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - (100 / (1 + rs));
}

export function calculateVWAP(candles: Candle[]): number | null {
  if (candles.length === 0) return null;

  let cumulativeTPV = 0;
  let cumulativeVolume = 0;

  for (const candle of candles) {
    const typicalPrice = (candle.high + candle.low + candle.close) / 3;
    cumulativeTPV += typicalPrice * candle.volume;
    cumulativeVolume += candle.volume;
  }

  if (cumulativeVolume === 0) return null;
  return cumulativeTPV / cumulativeVolume;
}

export function calculateBollingerBands(
  closes: number[],
  period: number = 20,
  multiplier: number = 2
): { upper: number; middle: number; lower: number } | null {
  const sma = calculateSMA(closes, period);
  if (sma === null) return null;

  const slice = closes.slice(-period);
  const squaredDiffs = slice.map(v => Math.pow(v - sma, 2));
  const variance = squaredDiffs.reduce((acc, v) => acc + v, 0) / period;
  const stdDev = Math.sqrt(variance);

  return {
    upper: sma + multiplier * stdDev,
    middle: sma,
    lower: sma - multiplier * stdDev,
  };
}

export function calculateATR(candles: Candle[], period: number = 14): number | null {
  if (candles.length < period + 1) return null;

  const trueRanges: number[] = [];

  for (let i = 1; i < candles.length; i++) {
    const high = candles[i].high;
    const low = candles[i].low;
    const prevClose = candles[i - 1].close;

    const tr = Math.max(
      high - low,
      Math.abs(high - prevClose),
      Math.abs(low - prevClose)
    );
    trueRanges.push(tr);
  }

  if (trueRanges.length < period) return null;

  let atr = 0;
  for (let i = 0; i < period; i++) {
    atr += trueRanges[i];
  }
  atr /= period;

  for (let i = period; i < trueRanges.length; i++) {
    atr = (atr * (period - 1) + trueRanges[i]) / period;
  }

  return atr;
}

export function computeTechnicalSnapshot(candles: Candle[]): TechnicalSnapshot {
  const closes = candles.map(c => c.close);
  
  const bollingerResult = calculateBollingerBands(closes, 20, 2);

  return {
    rsi14: calculateRSI(closes, 14),
    rsi5: calculateRSI(closes, 5),
    sma9: calculateSMA(closes, 9),
    sma20: calculateSMA(closes, 20),
    vwap: calculateVWAP(candles),
    bollingerUpper: bollingerResult?.upper ?? null,
    bollingerLower: bollingerResult?.lower ?? null,
    atr: calculateATR(candles, 14),
  };
}

export function getRSISignal(rsi: number): "OVERSOLD" | "OVERBOUGHT" | "NEUTRAL" {
  if (rsi < 30) return "OVERSOLD";
  if (rsi > 70) return "OVERBOUGHT";
  return "NEUTRAL";
}

export function getBollingerSignal(
  price: number,
  bands: { upper: number; lower: number }
): "UPPER_BAND" | "LOWER_BAND" | "WITHIN" {
  if (price >= bands.upper) return "UPPER_BAND";
  if (price <= bands.lower) return "LOWER_BAND";
  return "WITHIN";
}
