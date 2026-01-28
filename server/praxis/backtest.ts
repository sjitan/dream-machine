/**
 * Praxis Backtest - Historical Replay Engine
 * 
 * Per Requirements Section 6 (Phase 1: Historical Training):
 * 1. Load historical 1-min candles for ticker
 * 2. Calculate TPO profiles (POC/VAH/VAL)
 * 3. Generate predictions that WOULD have been made
 * 4. Compare to actual 0DTE option outcomes
 * 5. Score: WIN (option profitable) / LOSS (option expired worthless)
 * 6. Store results in aurora_backtest_results
 */

import { db } from "../db";
import {
  auroraMarketCandles,
  auroraBacktestResults,
} from "@shared/schema";
import { eq, and, gte, lte, asc } from "drizzle-orm";
import { buildTPOProfile, getTPOSignal } from "../math/tpo";
import { computeTechnicalSnapshot, getRSISignal } from "../math/technicals";
import { log } from "../index";
import type { Candle } from "../math/types";
import type { StrategyGenes } from "./evolution";

interface BacktestResult {
  totalTrades: number;
  wins: number;
  losses: number;
  winRate: number;
  profitFactor: number;
  maxDrawdown: number;
}

interface SimulatedTrade {
  direction: "CALL" | "PUT";
  strike: number;
  entryPrice: number;
  exitPrice: number;
  pnl: number;
  isWin: boolean;
}

export async function runHistoricalBacktest(
  ticker: string,
  startDate: string,
  endDate: string,
  genes: StrategyGenes
): Promise<BacktestResult> {
  log(`Backtest: Running ${ticker} from ${startDate} to ${endDate}`, "aurora");
  
  const candles = await db
    .select()
    .from(auroraMarketCandles)
    .where(
      and(
        eq(auroraMarketCandles.ticker, ticker),
        gte(auroraMarketCandles.timestamp, new Date(startDate)),
        lte(auroraMarketCandles.timestamp, new Date(endDate))
      )
    )
    .orderBy(asc(auroraMarketCandles.timestamp));
  
  if (candles.length < 60) {
    log(`Backtest: Insufficient candles (${candles.length})`, "aurora");
    return {
      totalTrades: 0,
      wins: 0,
      losses: 0,
      winRate: 0,
      profitFactor: 0,
      maxDrawdown: 0,
    };
  }
  
  const trades: SimulatedTrade[] = [];
  const windowSize = 30;
  
  for (let i = windowSize; i < candles.length - 10; i += 10) {
    const window = candles.slice(i - windowSize, i);
    const candleData: Candle[] = window.map(c => ({
      timestamp: c.timestamp ?? new Date(),
      open: c.open ?? 0,
      high: c.high ?? 0,
      low: c.low ?? 0,
      close: c.close ?? 0,
      volume: c.volume ?? 0,
    }));
    
    const currentPrice = candleData[candleData.length - 1].close;
    
    const tpoProfile = buildTPOProfile(candleData, { tickSize: 0.25 });
    if (!tpoProfile) continue;
    
    const technicals = computeTechnicalSnapshot(candleData);
    const tpoSignal = getTPOSignal(currentPrice, tpoProfile);
    const rsiSignal = technicals.rsi14 !== null ? getRSISignal(technicals.rsi14) : "NEUTRAL";
    
    let confidence = 50;
    let direction: "CALL" | "PUT" | null = null;
    
    if (tpoSignal.bias === "LONG") {
      confidence += 20 * genes.tpoWeight;
      direction = "CALL";
    } else if (tpoSignal.bias === "SHORT") {
      confidence += 20 * genes.tpoWeight;
      direction = "PUT";
    }
    
    if (rsiSignal === "OVERSOLD") {
      confidence += 20 * genes.rsiWeight;
      if (!direction) direction = "CALL";
    } else if (rsiSignal === "OVERBOUGHT") {
      confidence += 20 * genes.rsiWeight;
      if (!direction) direction = "PUT";
    }
    
    if (confidence < genes.minConfidence || !direction) continue;
    
    const futureCandles = candles.slice(i, Math.min(i + 10, candles.length));
    if (futureCandles.length === 0) continue;
    
    const exitPrice = futureCandles[futureCandles.length - 1].close ?? currentPrice;
    const strike = Math.round(currentPrice);
    
    // Simulate OPTION PREMIUM using Delta projection (not intrinsic value)
    // Estimated Delta: 0.5 for ATM options
    const estimatedDelta = 0.5;
    
    // Simulated entry premium based on distance from strike
    const distanceFromStrike = Math.abs(currentPrice - strike);
    const estimatedEntryPremium = Math.max(0.50, distanceFromStrike * estimatedDelta + 1.0);
    
    // Underlying move
    const underlyingMove = exitPrice - currentPrice;
    
    // Option premium change = underlying move * delta
    const premiumChange = underlyingMove * (direction === "CALL" ? estimatedDelta : -estimatedDelta);
    const estimatedExitPremium = Math.max(0.01, estimatedEntryPremium + premiumChange);
    
    // PnL is the difference in option premiums
    const pnl = estimatedExitPremium - estimatedEntryPremium;
    
    const isWin = pnl > 0;
    
    trades.push({
      direction,
      strike,
      entryPrice: currentPrice,
      exitPrice,
      pnl,
      isWin,
    });
  }
  
  const wins = trades.filter(t => t.isWin).length;
  const losses = trades.length - wins;
  const winRate = trades.length > 0 ? wins / trades.length : 0;
  
  const totalProfit = trades.filter(t => t.pnl > 0).reduce((sum, t) => sum + t.pnl, 0);
  const totalLoss = Math.abs(trades.filter(t => t.pnl < 0).reduce((sum, t) => sum + t.pnl, 0));
  const profitFactor = totalLoss > 0 ? totalProfit / totalLoss : totalProfit > 0 ? Infinity : 0;
  
  let maxDrawdown = 0;
  let peak = 0;
  let cumulative = 0;
  for (const trade of trades) {
    cumulative += trade.pnl;
    if (cumulative > peak) peak = cumulative;
    const drawdown = peak - cumulative;
    if (drawdown > maxDrawdown) maxDrawdown = drawdown;
  }
  
  const result: BacktestResult = {
    totalTrades: trades.length,
    wins,
    losses,
    winRate,
    profitFactor: Number.isFinite(profitFactor) ? profitFactor : 0,
    maxDrawdown,
  };
  
  await db.insert(auroraBacktestResults).values({
    ticker,
    strategyName: "TPO_MIT",
    timeRange: `${startDate} to ${endDate}`,
    totalTrades: result.totalTrades,
    winRate: result.winRate,
    profitFactor: result.profitFactor,
    maxDrawdown: result.maxDrawdown,
  });
  
  log(`Backtest: ${ticker} completed - ${result.totalTrades} trades, ${(result.winRate * 100).toFixed(1)}% win rate`, "aurora");
  
  return result;
}

export const Backtest = {
  runHistoricalBacktest,
};
