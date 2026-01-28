/**
 * TPO (Time Price Opportunity) Profile Calculator
 * 
 * MIT Auction Market Theory implementation:
 * - POC (Point of Control): Price level with most time/volume
 * - VAH (Value Area High): Upper bound of 70% volume concentration
 * - VAL (Value Area Low): Lower bound of 70% volume concentration
 * 
 * Pure TypeScript - no external dependencies
 */

import type { Candle } from "./types";

export interface TPOProfile {
  poc: number;
  vah: number;
  val: number;
  impulse: "BULLISH" | "BEARISH" | "NEUTRAL";
  profileData: Record<number, number>;
  totalVolume: number;
  priceRange: { high: number; low: number };
}

export interface TPOConfig {
  tickSize: number;
  valueAreaPercent: number;
}

const DEFAULT_CONFIG: TPOConfig = {
  tickSize: 0.25,
  valueAreaPercent: 0.70,
};

function roundToTick(price: number, tickSize: number): number {
  return Math.round(price / tickSize) * tickSize;
}

export function buildTPOProfile(
  candles: Candle[],
  config: Partial<TPOConfig> = {}
): TPOProfile | null {
  if (!candles || candles.length === 0) {
    return null;
  }

  const { tickSize, valueAreaPercent } = { ...DEFAULT_CONFIG, ...config };

  const volumeByPrice: Record<number, number> = {};
  let totalVolume = 0;
  let sessionHigh = -Infinity;
  let sessionLow = Infinity;

  for (const candle of candles) {
    const low = roundToTick(candle.low, tickSize);
    const high = roundToTick(candle.high, tickSize);
    
    sessionHigh = Math.max(sessionHigh, candle.high);
    sessionLow = Math.min(sessionLow, candle.low);

    const numTicks = Math.max(1, Math.round((high - low) / tickSize) + 1);
    const volumePerTick = candle.volume / numTicks;

    for (let price = low; price <= high; price = roundToTick(price + tickSize, tickSize)) {
      volumeByPrice[price] = (volumeByPrice[price] || 0) + volumePerTick;
      totalVolume += volumePerTick;
    }
  }

  if (Object.keys(volumeByPrice).length === 0) {
    return null;
  }

  const pricesSorted = Object.keys(volumeByPrice)
    .map(Number)
    .sort((a, b) => a - b);

  let poc = pricesSorted[0];
  let maxVolume = 0;
  for (const price of pricesSorted) {
    if (volumeByPrice[price] > maxVolume) {
      maxVolume = volumeByPrice[price];
      poc = price;
    }
  }

  const targetVolume = totalVolume * valueAreaPercent;
  let currentVolume = volumeByPrice[poc] || 0;
  
  const pocIndex = pricesSorted.indexOf(poc);
  let lowIndex = pocIndex;
  let highIndex = pocIndex;

  while (currentVolume < targetVolume && (lowIndex > 0 || highIndex < pricesSorted.length - 1)) {
    const lowCandidate = lowIndex > 0 ? volumeByPrice[pricesSorted[lowIndex - 1]] || 0 : 0;
    const highCandidate = highIndex < pricesSorted.length - 1 ? volumeByPrice[pricesSorted[highIndex + 1]] || 0 : 0;

    if (lowCandidate >= highCandidate && lowIndex > 0) {
      lowIndex--;
      currentVolume += lowCandidate;
    } else if (highIndex < pricesSorted.length - 1) {
      highIndex++;
      currentVolume += highCandidate;
    } else if (lowIndex > 0) {
      lowIndex--;
      currentVolume += lowCandidate;
    } else {
      break;
    }
  }

  const val = pricesSorted[lowIndex];
  const vah = pricesSorted[highIndex];

  const openPrice = candles[0].open;
  const closePrice = candles[candles.length - 1].close;
  
  let impulse: "BULLISH" | "BEARISH" | "NEUTRAL";
  const priceChange = closePrice - openPrice;
  const range = sessionHigh - sessionLow;
  const changePercent = range > 0 ? Math.abs(priceChange) / range : 0;
  
  if (changePercent < 0.1) {
    impulse = "NEUTRAL";
  } else if (priceChange > 0) {
    impulse = "BULLISH";
  } else {
    impulse = "BEARISH";
  }

  return {
    poc: roundToTick(poc, tickSize),
    vah: roundToTick(vah, tickSize),
    val: roundToTick(val, tickSize),
    impulse,
    profileData: volumeByPrice,
    totalVolume,
    priceRange: { high: sessionHigh, low: sessionLow },
  };
}

export function isPriceInValueArea(price: number, profile: TPOProfile): boolean {
  return price >= profile.val && price <= profile.vah;
}

export function getTPOSignal(
  currentPrice: number,
  profile: TPOProfile
): { bias: "LONG" | "SHORT" | "NEUTRAL"; reason: string } {
  const { poc, vah, val } = profile;

  if (currentPrice > vah) {
    return { bias: "SHORT", reason: "Price above VAH - potential mean reversion" };
  }
  
  if (currentPrice < val) {
    return { bias: "LONG", reason: "Price below VAL - potential mean reversion" };
  }
  
  if (Math.abs(currentPrice - poc) / poc < 0.001) {
    return { bias: "NEUTRAL", reason: "Price at POC - fair value" };
  }
  
  if (currentPrice > poc) {
    return { bias: "LONG", reason: "Price above POC within value area - bullish bias" };
  } else {
    return { bias: "SHORT", reason: "Price below POC within value area - bearish bias" };
  }
}
