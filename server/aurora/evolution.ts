/**
 * Aurora Evolution - Praxis Genetic Solver (Phase 1 Stub)
 * 
 * Uses prediction outcomes to evolve better parameters via genetic algorithm.
 * The full implementation will:
 * 1. Create a population of parameter mutations
 * 2. Backtest each mutation against historical data
 * 3. Select the fittest (highest win rate) as the new Alpha
 * 
 * This is a stub for Phase 1 - full implementation in a future batch.
 */

import { db } from "../db";
import { auroraPraxisParameters, auroraParallaxOutcomes } from "@shared/schema";
import { eq, desc } from "drizzle-orm";
import { log } from "../index";

interface Gene {
  vahSensitivity: number;
  valSensitivity: number;
  pocWeight: number;
  minConfidence: number;
  stopLossAtr: number;
  takeProfitAtr: number;
}

const DEFAULT_GENE: Gene = {
  vahSensitivity: 0.5,
  valSensitivity: 0.5,
  pocWeight: 0.7,
  minConfidence: 0.6,
  stopLossAtr: 2.0,
  takeProfitAtr: 3.0,
};

export const PraxisEvolution = {
  /**
   * SURVIVAL OF THE FITTEST
   * Evolves parameters based on recent prediction outcomes.
   */
  async evolve(): Promise<void> {
    log("Praxis: Initiating evolution sequence...", "aurora");

    try {
      const alpha = await db
        .select()
        .from(auroraPraxisParameters)
        .where(eq(auroraPraxisParameters.isActive, true))
        .limit(1);

      if (alpha.length === 0) {
        log("Praxis: No Alpha found. Seeding Genesis block...", "aurora");
        await this.seedGenesis();
        return;
      }

      const outcomes = await db
        .select()
        .from(auroraParallaxOutcomes)
        .orderBy(desc(auroraParallaxOutcomes.closedAt))
        .limit(100);

      if (outcomes.length < 10) {
        log("Praxis: Insufficient outcomes for evolution (<10 trades). Waiting...", "aurora");
        return;
      }

      const wins = outcomes.filter((o) => o.result === "WIN").length;
      const winRate = wins / outcomes.length;

      log(`Praxis: Current win rate = ${(winRate * 100).toFixed(1)}% (${wins}/${outcomes.length})`, "aurora");

      if (winRate < 0.55) {
        log("Praxis: Win rate below 55%, mutation required (Phase 2)", "aurora");
      } else {
        log("Praxis: Alpha performing well. No mutation needed.", "aurora");
      }

      log("Praxis: Evolution complete (simulation mode for Phase 1)", "aurora");
    } catch (error) {
      log(`Praxis: Evolution error: ${error}`, "aurora");
    }
  },

  /**
   * Seeds the initial "Genesis" parameters if none exist
   */
  async seedGenesis(): Promise<void> {
    try {
      await db.insert(auroraPraxisParameters).values({
        name: "Genesis_Alpha",
        config: DEFAULT_GENE,
        winRate: 0,
        isActive: true,
      });
      log("Praxis: Genesis Alpha seeded successfully", "aurora");
    } catch (error) {
      log(`Praxis: Failed to seed Genesis: ${error}`, "aurora");
    }
  },

  /**
   * Mutate a gene with random jitter
   */
  mutate(gene: Gene): Gene {
    return {
      vahSensitivity: this.jitter(gene.vahSensitivity, 0.1, 0, 1),
      valSensitivity: this.jitter(gene.valSensitivity, 0.1, 0, 1),
      pocWeight: this.jitter(gene.pocWeight, 0.1, 0, 1),
      minConfidence: this.jitter(gene.minConfidence, 0.05, 0.5, 0.9),
      stopLossAtr: this.jitter(gene.stopLossAtr, 0.3, 1.0, 4.0),
      takeProfitAtr: this.jitter(gene.takeProfitAtr, 0.3, 1.5, 5.0),
    };
  },

  /**
   * Apply random jitter within bounds
   */
  jitter(val: number, range: number, min: number, max: number): number {
    const delta = (Math.random() * range * 2) - range;
    return Math.max(min, Math.min(max, val + delta));
  },

  /**
   * Get current active parameters
   */
  async getActiveParams(): Promise<Gene> {
    try {
      const alpha = await db
        .select()
        .from(auroraPraxisParameters)
        .where(eq(auroraPraxisParameters.isActive, true))
        .limit(1);

      if (alpha.length > 0 && alpha[0].config) {
        return alpha[0].config as Gene;
      }
    } catch (error) {
      log(`Praxis: Error fetching active params: ${error}`, "aurora");
    }

    return DEFAULT_GENE;
  },
};
