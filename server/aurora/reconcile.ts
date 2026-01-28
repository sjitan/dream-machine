/**
 * Aurora Reconcile - The Scorekeeper
 * 
 * Grades ACTIVE predictions by checking settlement prices and calculating PnL.
 * Runs periodically during trading hours and at EOD (16:05 ET).
 * 
 * This creates the "Ground Truth" for the Praxis learning loop.
 */

import { db } from "../db";
import {
  auroraParallaxPredictions,
  auroraParallaxOutcomes,
  auroraMarketCandles,
} from "@shared/schema";
import { eq, desc } from "drizzle-orm";
import { log } from "../index";
import { Evolution } from "../praxis/evolution";

const WIN_THRESHOLD = 0.10;

export const Reconcile = {
  /**
   * THE GRIM REAPER
   * Grades all ACTIVE predictions by checking current/settlement prices.
   */
  async gradeOpenTrades(): Promise<{ graded: number; wins: number; losses: number }> {
    const results = { graded: 0, wins: 0, losses: 0 };

    try {
      const activePredictions = await db
        .select()
        .from(auroraParallaxPredictions)
        .where(eq(auroraParallaxPredictions.status, "ACTIVE"));

      if (activePredictions.length === 0) {
        return results;
      }

      log(`Reconcile: Grading ${activePredictions.length} open position(s)...`, "aurora");

      for (const pred of activePredictions) {
        // Grade using OPTION PREMIUM trade plan, not underlying intrinsic value
        // The prediction stores option contract entry/stop/target from Delta projection
        const entryPremium = pred.entryTrigger ?? 0;
        const stopPremium = pred.stopLoss ?? 0;
        const targetPremium = pred.takeProfit ?? 0;
        
        if (entryPremium <= 0) {
          log(`Reconcile: [${pred.ticker}] No entry premium stored, skipping`, "aurora");
          continue;
        }
        
        // Simulate exit: In real trading, we'd fetch current option quote
        // For now, estimate based on underlying move and delta
        const lastCandle = await db
          .select()
          .from(auroraMarketCandles)
          .where(eq(auroraMarketCandles.ticker, pred.ticker))
          .orderBy(desc(auroraMarketCandles.timestamp))
          .limit(1);

        if (lastCandle.length === 0) {
          log(`Reconcile: No candle data for ${pred.ticker}, skipping`, "aurora");
          continue;
        }

        const currentPrice = lastCandle[0].close;
        const strike = pred.strike;
        
        // Estimate delta (0.5 for ATM options)
        const estimatedDelta = pred.direction === "CALL" ? 0.5 : -0.5;
        const underlyingMove = currentPrice - (pred.entryPrice ?? strike);
        const estimatedPremiumChange = underlyingMove * Math.abs(estimatedDelta);
        const currentPremium = Math.max(0.01, entryPremium + estimatedPremiumChange);
        
        // Calculate PnL based on option premium, not intrinsic value
        const pnl = currentPremium - entryPremium;
        
        // Win if hit target or positive PnL, Loss if hit stop or negative
        let isWin = false;
        if (currentPremium >= targetPremium) {
          isWin = true;
        } else if (currentPremium <= stopPremium) {
          isWin = false;
        } else {
          // Not at target or stop yet, check if profitable
          isWin = pnl > 0;
        }

        await db.insert(auroraParallaxOutcomes).values({
          predictionId: pred.id,
          actualPnl: pnl,
          result: isWin ? "WIN" : "LOSS",
          closedAt: new Date(),
        });

        await db
          .update(auroraParallaxPredictions)
          .set({ status: "CLOSED" })
          .where(eq(auroraParallaxPredictions.id, pred.id));

        log(
          `Reconcile: ${pred.ticker} ${pred.direction} @ $${strike} -> ${isWin ? "WIN" : "LOSS"} ($${pnl.toFixed(2)})`,
          "aurora"
        );

        results.graded++;
        if (isWin) results.wins++;
        else results.losses++;
      }

      if (results.graded > 0) {
        log(
          `Reconcile: Graded ${results.graded} trades - ${results.wins} WIN / ${results.losses} LOSS`,
          "aurora"
        );
        
        // Trigger Praxis learning if accuracy drops below 60%
        const winRate = results.wins / results.graded;
        await Evolution.checkAndTriggerEvolution(winRate);
      }
    } catch (error) {
      log(`Reconcile: Error grading trades: ${error}`, "aurora");
    }

    return results;
  },

  /**
   * Mark expired predictions (from previous days) as EXPIRED
   */
  async expireStale(todayDate: string): Promise<number> {
    let expired = 0;

    try {
      const activePredictions = await db
        .select()
        .from(auroraParallaxPredictions)
        .where(eq(auroraParallaxPredictions.status, "ACTIVE"));

      for (const pred of activePredictions) {
        if (!pred.generatedAt) continue;

        const generatedDate = new Date(pred.generatedAt).toISOString().slice(0, 10);
        if (generatedDate < todayDate) {
          await db
            .update(auroraParallaxPredictions)
            .set({ status: "EXPIRED" })
            .where(eq(auroraParallaxPredictions.id, pred.id));

          log(`Reconcile: Expired stale prediction #${pred.id} for ${pred.ticker}`, "aurora");
          expired++;
        }
      }
    } catch (error) {
      log(`Reconcile: Error expiring stale predictions: ${error}`, "aurora");
    }

    return expired;
  },

  /**
   * Get win rate statistics for recent predictions
   */
  async getWinRate(days: number = 7): Promise<{ total: number; wins: number; winRate: number }> {
    try {
      const outcomes = await db
        .select()
        .from(auroraParallaxOutcomes);

      const wins = outcomes.filter((o) => o.result === "WIN").length;
      const total = outcomes.length;
      const winRate = total > 0 ? (wins / total) * 100 : 0;

      return { total, wins, winRate };
    } catch (error) {
      log(`Reconcile: Error calculating win rate: ${error}`, "aurora");
      return { total: 0, wins: 0, winRate: 0 };
    }
  },
};
