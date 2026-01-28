/**
 * Praxis Paper Trade - Forward Validation Loop
 * 
 * Per Requirements Section 6 (Phase 2: Forward Learning):
 * 1. Generate prediction every 30 seconds
 * 2. Store in aurora_parallax_predictions
 * 3. Paper-trade the recommendation (shadow position)
 * 4. At expiry, record actual outcome in aurora_parallax_outcomes
 * 5. Calculate rolling win-rate by ticker cohort
 * 6. If accuracy drops below 60%: trigger Praxis parameter adjustment
 * 7. Alert on significant confidence degradation
 */

import { db } from "../db";
import {
  auroraParallaxPredictions,
  auroraParallaxOutcomes,
} from "@shared/schema";
import { eq, desc, and, gte } from "drizzle-orm";
import { log } from "../index";
import { Evolution } from "./evolution";

interface PaperTradeStats {
  ticker: string;
  totalPredictions: number;
  gradedPredictions: number;
  wins: number;
  losses: number;
  rollingWinRate: number;
  lastUpdated: Date;
}

interface ConfidenceDegradation {
  ticker: string;
  previousWinRate: number;
  currentWinRate: number;
  degradation: number;
  alert: boolean;
}

const ROLLING_WINDOW_DAYS = 7;
const ALERT_THRESHOLD = 0.10;
const MIN_PREDICTIONS_FOR_STATS = 10;

export async function calculateRollingWinRate(ticker: string): Promise<PaperTradeStats> {
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - ROLLING_WINDOW_DAYS);
  
  const predictions = await db
    .select()
    .from(auroraParallaxPredictions)
    .where(
      and(
        eq(auroraParallaxPredictions.ticker, ticker),
        gte(auroraParallaxPredictions.generatedAt, cutoffDate)
      )
    )
    .orderBy(desc(auroraParallaxPredictions.generatedAt));
  
  const outcomes = await db
    .select()
    .from(auroraParallaxOutcomes)
    .innerJoin(
      auroraParallaxPredictions,
      eq(auroraParallaxOutcomes.predictionId, auroraParallaxPredictions.id)
    )
    .where(
      and(
        eq(auroraParallaxPredictions.ticker, ticker),
        gte(auroraParallaxPredictions.generatedAt, cutoffDate)
      )
    );
  
  const wins = outcomes.filter(o => o.aurora_parallax_outcomes.result === "WIN").length;
  const losses = outcomes.filter(o => o.aurora_parallax_outcomes.result === "LOSS").length;
  const gradedPredictions = wins + losses;
  const rollingWinRate = gradedPredictions > 0 ? wins / gradedPredictions : 0;
  
  return {
    ticker,
    totalPredictions: predictions.length,
    gradedPredictions,
    wins,
    losses,
    rollingWinRate,
    lastUpdated: new Date(),
  };
}

export async function checkConfidenceDegradation(ticker: string): Promise<ConfidenceDegradation> {
  const stats = await calculateRollingWinRate(ticker);
  
  const previousCutoff = new Date();
  previousCutoff.setDate(previousCutoff.getDate() - (ROLLING_WINDOW_DAYS * 2));
  const currentCutoff = new Date();
  currentCutoff.setDate(currentCutoff.getDate() - ROLLING_WINDOW_DAYS);
  
  const previousOutcomes = await db
    .select()
    .from(auroraParallaxOutcomes)
    .innerJoin(
      auroraParallaxPredictions,
      eq(auroraParallaxOutcomes.predictionId, auroraParallaxPredictions.id)
    )
    .where(
      and(
        eq(auroraParallaxPredictions.ticker, ticker),
        gte(auroraParallaxPredictions.generatedAt, previousCutoff)
      )
    );
  
  const previousWins = previousOutcomes.filter(o => 
    o.aurora_parallax_outcomes.result === "WIN" &&
    o.aurora_parallax_predictions.generatedAt &&
    o.aurora_parallax_predictions.generatedAt < currentCutoff
  ).length;
  const previousTotal = previousOutcomes.filter(o =>
    o.aurora_parallax_predictions.generatedAt &&
    o.aurora_parallax_predictions.generatedAt < currentCutoff
  ).length;
  
  const previousWinRate = previousTotal > 0 ? previousWins / previousTotal : 0.60;
  const currentWinRate = stats.rollingWinRate;
  const degradation = previousWinRate - currentWinRate;
  const alert = degradation > ALERT_THRESHOLD && stats.gradedPredictions >= MIN_PREDICTIONS_FOR_STATS;
  
  if (alert) {
    log(`Paper Trade: ALERT - ${ticker} win rate degraded from ${(previousWinRate * 100).toFixed(1)}% to ${(currentWinRate * 100).toFixed(1)}%`, "aurora");
    await Evolution.checkAndTriggerEvolution(currentWinRate);
  }
  
  return {
    ticker,
    previousWinRate,
    currentWinRate,
    degradation,
    alert,
  };
}

export async function getAllTickerStats(): Promise<PaperTradeStats[]> {
  const tickers = ["SPY"];
  const stats: PaperTradeStats[] = [];
  
  for (const ticker of tickers) {
    const tickerStats = await calculateRollingWinRate(ticker);
    stats.push(tickerStats);
  }
  
  return stats;
}

export const PaperTrade = {
  calculateRollingWinRate,
  checkConfidenceDegradation,
  getAllTickerStats,
};
