/**
 * Aurora Parallax - Prediction Generator
 * 
 * Combines multiple engines to generate 0DTE option recommendations:
 * - TPO+MIT Engine: Live market (9:30 AM - 4:00 PM ET)
 * - Black-Scholes Engine: Pre-market (4:00 AM - 9:30 AM ET)
 * - ORB Momentum Engine: Opening range breakout
 * 
 * Outputs single strongest OTM recommendation per ticker with 60%+ confidence
 */

import { db } from "../db";
import { auroraParallaxPredictions, auroraParallaxOutcomes, auroraPraxisParameters } from "@shared/schema";
import { MarketTime } from "./time";
import { MarketCalendar } from "./calendar";
import { buildTPOProfile, getTPOSignal, type TPOProfile } from "../math/tpo";
import { computeTechnicalSnapshot, getRSISignal, type TechnicalSnapshot } from "../math/technicals";
import { calculateInitialBalance, computeOrderFlowSnapshot, type InitialBalance } from "../math/institutional";
import { generatePreMarketPrediction, calculateBlackScholes } from "../math/blackscholes";
import { calculateORB, type ORBLevels } from "../math/orb";
import { RiskCalculator, type TradePlan } from "../math/risk";
import type { Candle } from "../math/types";
import { eq, desc, and } from "drizzle-orm";
import { Evolution, type StrategyGenes } from "../praxis/evolution";

export type PredictionCategory = "SPY_DAILY" | "SPX_DAILY" | "NVDA_FRIDAY" | "TSLA_FRIDAY" | "XOM_FRIDAY" | "AAPL_FRIDAY" | "ASML_FRIDAY";
export type PredictionDirection = "CALL" | "PUT";
export type PredictionEngine = "TPO_MIT" | "BLACK_SCHOLES" | "ORB_MOMENTUM" | "ENSEMBLE";
export type PredictionStatus = "ACTIVE" | "EXPIRED" | "HIT_TARGET" | "STOPPED_OUT";

export interface PredictionReasoning {
  engine: PredictionEngine;
  tpoSignal?: { bias: string; reason: string };
  technicals?: Partial<TechnicalSnapshot>;
  institutional?: { ibBreakout: string; cvdDivergence: boolean };
  confidence_components: Record<string, number>;
  timestamp: string;
}

export interface Prediction {
  ticker: string;
  category: PredictionCategory;
  direction: PredictionDirection;
  strike: number;
  entryPrice: number | null;
  confidence: number;
  session: string;
  engine: PredictionEngine;
  reasoning: PredictionReasoning;
  // Trade Plan
  entryTrigger: number | null;
  stopLoss: number | null;
  takeProfit: number | null;
  riskRewardRatio: number | null;
}

interface ConfidenceWeights {
  tpo: number;
  rsi: number;
  ib: number;
  cvd: number;
  vwap: number;
}

const DEFAULT_WEIGHTS: ConfidenceWeights = {
  tpo: 0.25,
  rsi: 0.20,
  ib: 0.20,
  cvd: 0.15,
  vwap: 0.20,
};

// Cache for active Praxis genes per ticker (hot-swappable)
const genesCache = new Map<string, { genes: StrategyGenes; lastRefresh: number }>();
const GENES_REFRESH_INTERVAL = 60_000; // Refresh every minute

async function getWeightsFromPraxis(ticker: string): Promise<ConfidenceWeights> {
  const now = Date.now();
  const cached = genesCache.get(ticker);
  
  if (!cached || now - cached.lastRefresh > GENES_REFRESH_INTERVAL) {
    const genes = await Evolution.getActiveGenes(ticker);
    genesCache.set(ticker, { genes, lastRefresh: now });
    
    return {
      tpo: genes.tpoWeight,
      rsi: genes.rsiWeight,
      ib: genes.ibWeight,
      cvd: genes.cvdWeight,
      vwap: genes.vwapWeight,
    };
  }
  
  return {
    tpo: cached.genes.tpoWeight,
    rsi: cached.genes.rsiWeight,
    ib: cached.genes.ibWeight,
    cvd: cached.genes.cvdWeight,
    vwap: cached.genes.vwapWeight,
  };
}

function calculateConfidence(components: Record<string, number>, weights: ConfidenceWeights): number {
  let total = 0;
  let weightSum = 0;

  if (components.tpo !== undefined) {
    total += components.tpo * weights.tpo;
    weightSum += weights.tpo;
  }
  if (components.rsi !== undefined) {
    total += components.rsi * weights.rsi;
    weightSum += weights.rsi;
  }
  if (components.ib !== undefined) {
    total += components.ib * weights.ib;
    weightSum += weights.ib;
  }
  if (components.cvd !== undefined) {
    total += components.cvd * weights.cvd;
    weightSum += weights.cvd;
  }
  if (components.vwap !== undefined) {
    total += components.vwap * weights.vwap;
    weightSum += weights.vwap;
  }

  return weightSum > 0 ? (total / weightSum) * 100 : 50;
}

function selectStrike(
  currentPrice: number,
  direction: PredictionDirection,
  tickSize: number = 1
): number {
  const offset = direction === "CALL" ? 1 : -1;
  const otmAmount = currentPrice * 0.005;
  const rawStrike = currentPrice + (offset * otmAmount);
  return Math.round(rawStrike / tickSize) * tickSize;
}

export async function generateTPOMITPrediction(
  ticker: string,
  category: PredictionCategory,
  candles: Candle[],
  currentPrice: number
): Promise<Prediction | null> {
  if (candles.length < 30) return null;
  
  // Get weights from Praxis (hot-swappable)
  const weights = await getWeightsFromPraxis(ticker);

  const tpoProfile = buildTPOProfile(candles, { tickSize: 0.25 });
  if (!tpoProfile) return null;

  const technicals = computeTechnicalSnapshot(candles);
  const ib = calculateInitialBalance(candles);
  const orderFlow = computeOrderFlowSnapshot(candles);

  const tpoSignal = getTPOSignal(currentPrice, tpoProfile);
  const rsiSignal = technicals.rsi14 !== null ? getRSISignal(technicals.rsi14) : "NEUTRAL";

  const confidenceComponents: Record<string, number> = {};

  if (tpoSignal.bias === "LONG") confidenceComponents.tpo = 0.7;
  else if (tpoSignal.bias === "SHORT") confidenceComponents.tpo = 0.7;
  else confidenceComponents.tpo = 0.3;

  if (rsiSignal === "OVERSOLD") confidenceComponents.rsi = 0.8;
  else if (rsiSignal === "OVERBOUGHT") confidenceComponents.rsi = 0.8;
  else confidenceComponents.rsi = 0.5;

  if (ib) {
    if (currentPrice > ib.ibHigh || currentPrice < ib.ibLow) {
      confidenceComponents.ib = 0.75;
    } else {
      confidenceComponents.ib = 0.4;
    }
  }

  if (orderFlow) {
    confidenceComponents.cvd = orderFlow.cvdDivergence ? 0.65 : 0.5;
    
    if (technicals.vwap !== null) {
      const vwapDistance = Math.abs(currentPrice - technicals.vwap) / technicals.vwap;
      confidenceComponents.vwap = vwapDistance < 0.01 ? 0.6 : vwapDistance < 0.02 ? 0.5 : 0.4;
    }
  }

  const confidence = calculateConfidence(confidenceComponents, weights);

  if (confidence < 60) return null;

  let direction: PredictionDirection;
  if (tpoSignal.bias === "LONG" || (rsiSignal === "OVERSOLD" && tpoSignal.bias === "NEUTRAL")) {
    direction = "CALL";
  } else if (tpoSignal.bias === "SHORT" || (rsiSignal === "OVERBOUGHT" && tpoSignal.bias === "NEUTRAL")) {
    direction = "PUT";
  } else {
    return null;
  }

  const strike = selectStrike(currentPrice, direction);
  const session = MarketTime.getSession(MarketCalendar.getHolidaysSet(), MarketCalendar.getHalfDaysSet());

  // Calculate Trade Plan from TPO levels
  const atr = technicals.atr ?? 2.0;
  const tradePlan = RiskCalculator.fromTPO(tpoProfile, currentPrice, direction, atr);

  return {
    ticker,
    category,
    direction,
    strike,
    entryPrice: currentPrice,
    confidence,
    session,
    engine: "TPO_MIT",
    reasoning: {
      engine: "TPO_MIT",
      tpoSignal,
      technicals: {
        rsi14: technicals.rsi14,
        vwap: technicals.vwap,
        atr: technicals.atr,
      },
      institutional: ib ? {
        ibBreakout: currentPrice > ib.ibHigh ? "ABOVE" : currentPrice < ib.ibLow ? "BELOW" : "WITHIN",
        cvdDivergence: orderFlow?.cvdDivergence ?? false,
      } : undefined,
      confidence_components: confidenceComponents,
      timestamp: MarketTime.toISO(),
    },
    entryTrigger: tradePlan.entry,
    stopLoss: tradePlan.stop,
    takeProfit: tradePlan.target,
    riskRewardRatio: tradePlan.riskReward,
  };
}

export function generateBlackScholesPrediction(
  ticker: string,
  category: PredictionCategory,
  spotPrice: number,
  volatility: number,
  bias: "BULLISH" | "BEARISH" | "NEUTRAL"
): Prediction | null {
  const preMarketPred = generatePreMarketPrediction(ticker, spotPrice, volatility, 0.05, bias);
  
  if (!preMarketPred || preMarketPred.confidence < 60) return null;

  const session = MarketTime.getSession(MarketCalendar.getHolidaysSet(), MarketCalendar.getHalfDaysSet());

  // Calculate Trade Plan from Black-Scholes expected move
  const tradePlan = RiskCalculator.fromBlackScholes(
    spotPrice,
    preMarketPred.expectedMove,
    preMarketPred.direction
  );

  return {
    ticker,
    category,
    direction: preMarketPred.direction,
    strike: preMarketPred.strike,
    entryPrice: preMarketPred.theoreticalPrice,
    confidence: preMarketPred.confidence,
    session,
    engine: "BLACK_SCHOLES",
    reasoning: {
      engine: "BLACK_SCHOLES",
      confidence_components: {
        theoretical_price: preMarketPred.theoreticalPrice,
        expected_move: preMarketPred.expectedMove,
      },
      timestamp: MarketTime.toISO(),
    },
    entryTrigger: tradePlan.entry,
    stopLoss: tradePlan.stop,
    takeProfit: tradePlan.target,
    riskRewardRatio: tradePlan.riskReward,
  };
}

export function generateORBPrediction(
  ticker: string,
  category: PredictionCategory,
  candles: Candle[],
  currentPrice: number
): Prediction | null {
  const orbMinutes = 30;
  const marketOpen = MarketTime.getMarketOpen();
  const orbEnd = marketOpen.plus({ minutes: orbMinutes });
  const now = MarketTime.now();

  if (now < orbEnd) return null;

  const orbCandles = candles.filter(c => {
    const candleTime = MarketTime.fromJSDate(c.timestamp);
    return candleTime >= marketOpen && candleTime < orbEnd;
  });

  if (orbCandles.length < 5) return null;

  // Use shared ORB calculator for consistent level computation
  const orbLevels = calculateORB(orbCandles);
  if (!orbLevels) return null;

  let direction: PredictionDirection | null = null;
  let confidence = 55;

  if (currentPrice > orbLevels.high) {
    direction = "CALL";
    const breakoutStrength = (currentPrice - orbLevels.high) / orbLevels.rangeSize;
    confidence += Math.min(20, breakoutStrength * 40);
  } else if (currentPrice < orbLevels.low) {
    direction = "PUT";
    const breakoutStrength = (orbLevels.low - currentPrice) / orbLevels.rangeSize;
    confidence += Math.min(20, breakoutStrength * 40);
  }

  if (!direction || confidence < 60) return null;

  const strike = selectStrike(currentPrice, direction);
  const session = MarketTime.getSession(MarketCalendar.getHolidaysSet(), MarketCalendar.getHalfDaysSet());

  // Calculate Trade Plan from ORB levels using shared RiskCalculator
  const tradePlan = RiskCalculator.fromORB(orbLevels, direction);

  return {
    ticker,
    category,
    direction,
    strike,
    entryPrice: currentPrice,
    confidence,
    session,
    engine: "ORB_MOMENTUM",
    reasoning: {
      engine: "ORB_MOMENTUM",
      confidence_components: {
        orb_high: orbLevels.high,
        orb_low: orbLevels.low,
        breakout_price: currentPrice,
      },
      timestamp: MarketTime.toISO(),
    },
    entryTrigger: tradePlan.entry,
    stopLoss: tradePlan.stop,
    takeProfit: tradePlan.target,
    riskRewardRatio: tradePlan.riskReward,
  };
}

export async function storePrediction(prediction: Prediction): Promise<number> {
  const result = await db.insert(auroraParallaxPredictions).values({
    ticker: prediction.ticker,
    category: prediction.category,
    direction: prediction.direction,
    strike: prediction.strike,
    entryPrice: prediction.entryPrice,
    confidence: prediction.confidence,
    session: prediction.session,
    engine: prediction.engine,
    reasoning: prediction.reasoning,
    status: "ACTIVE",
    entryTrigger: prediction.entryTrigger,
    stopLoss: prediction.stopLoss,
    takeProfit: prediction.takeProfit,
    riskRewardRatio: prediction.riskRewardRatio,
  }).returning({ id: auroraParallaxPredictions.id });

  return result[0].id;
}

export async function getActivePredictions(ticker?: string): Promise<typeof auroraParallaxPredictions.$inferSelect[]> {
  if (ticker) {
    return await db
      .select()
      .from(auroraParallaxPredictions)
      .where(and(
        eq(auroraParallaxPredictions.status, "ACTIVE"),
        eq(auroraParallaxPredictions.ticker, ticker)
      ))
      .orderBy(desc(auroraParallaxPredictions.generatedAt));
  }

  return await db
    .select()
    .from(auroraParallaxPredictions)
    .where(eq(auroraParallaxPredictions.status, "ACTIVE"))
    .orderBy(desc(auroraParallaxPredictions.generatedAt));
}

// Returns ALL recent predictions regardless of status - for UI display
export async function getRecentPredictions(ticker?: string, limit: number = 10): Promise<typeof auroraParallaxPredictions.$inferSelect[]> {
  if (ticker) {
    return await db
      .select()
      .from(auroraParallaxPredictions)
      .where(eq(auroraParallaxPredictions.ticker, ticker))
      .orderBy(desc(auroraParallaxPredictions.generatedAt))
      .limit(limit);
  }

  return await db
    .select()
    .from(auroraParallaxPredictions)
    .orderBy(desc(auroraParallaxPredictions.generatedAt))
    .limit(limit);
}

export async function updatePredictionStatus(
  predictionId: number,
  status: PredictionStatus,
  actualPnl?: number
): Promise<void> {
  await db
    .update(auroraParallaxPredictions)
    .set({ status })
    .where(eq(auroraParallaxPredictions.id, predictionId));

  if (actualPnl !== undefined) {
    await db.insert(auroraParallaxOutcomes).values({
      predictionId,
      actualPnl,
      result: actualPnl > 0 ? "WIN" : "LOSS",
    });
  }
}

export const Parallax = {
  generateTPOMITPrediction,
  generateBlackScholesPrediction,
  generateORBPrediction,
  storePrediction,
  getActivePredictions,
  updatePredictionStatus,
  calculateConfidence,
};
