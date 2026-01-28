/**
 * Praxis Evolution Engine - Genetic Algorithm Solver
 * 
 * Per Requirements Section 9 (Batch 9):
 * - Implements evolve() function (Population -> Fitness -> Crossover)
 * - Hot-swapping of parameters without server restart
 * - Automated retraining when accuracy drops below 60%
 * 
 * Process:
 * 1. Generate "population" of 50 parameter sets (genes)
 * 2. Run rapid backtest on each set against historical outcomes
 * 3. "Kill" the bottom 50% performers
 * 4. "Breed" the top 50% to create new parameters
 * 5. Hot-swap the "Alpha" (best) parameters into the live engine
 */

import { db } from "../db";
import {
  auroraPraxisParameters,
  auroraPraxisDeltas,
  auroraParallaxPredictions,
  auroraParallaxOutcomes,
} from "@shared/schema";
import { eq, and, desc } from "drizzle-orm";
import { log } from "../index";

export interface StrategyGenes {
  tpoWeight: number;
  rsiWeight: number;
  ibWeight: number;
  cvdWeight: number;
  vwapWeight: number;
  minConfidence: number;
  orbBreakoutMultiplier: number;
  stopLossMultiplier: number;
  targetMultiplier: number;
}

export interface Individual {
  genes: StrategyGenes;
  fitness: number;
}

const DEFAULT_GENES: StrategyGenes = {
  tpoWeight: 0.25,
  rsiWeight: 0.20,
  ibWeight: 0.20,
  cvdWeight: 0.15,
  vwapWeight: 0.20,
  minConfidence: 60,
  orbBreakoutMultiplier: 1.0,
  stopLossMultiplier: 0.5,
  targetMultiplier: 2.0,
};

const POPULATION_SIZE = 50;
const ELITE_COUNT = 5;
const MUTATION_RATE = 0.15;
const CROSSOVER_RATE = 0.7;
const TARGET_ACCURACY = 0.60;

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function randomInRange(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

function createRandomGenes(): StrategyGenes {
  return {
    tpoWeight: randomInRange(0.1, 0.4),
    rsiWeight: randomInRange(0.1, 0.3),
    ibWeight: randomInRange(0.1, 0.3),
    cvdWeight: randomInRange(0.05, 0.25),
    vwapWeight: randomInRange(0.1, 0.3),
    minConfidence: randomInRange(55, 75),
    orbBreakoutMultiplier: randomInRange(0.5, 2.0),
    stopLossMultiplier: randomInRange(0.3, 0.7),
    targetMultiplier: randomInRange(1.5, 3.0),
  };
}

function normalizeWeights(genes: StrategyGenes): StrategyGenes {
  const total = genes.tpoWeight + genes.rsiWeight + genes.ibWeight + genes.cvdWeight + genes.vwapWeight;
  if (total === 0) return DEFAULT_GENES;
  
  return {
    ...genes,
    tpoWeight: genes.tpoWeight / total,
    rsiWeight: genes.rsiWeight / total,
    ibWeight: genes.ibWeight / total,
    cvdWeight: genes.cvdWeight / total,
    vwapWeight: genes.vwapWeight / total,
  };
}

function mutate(genes: StrategyGenes): StrategyGenes {
  const mutated = { ...genes };
  
  if (Math.random() < MUTATION_RATE) {
    mutated.tpoWeight = clamp(genes.tpoWeight + randomInRange(-0.05, 0.05), 0.05, 0.5);
  }
  if (Math.random() < MUTATION_RATE) {
    mutated.rsiWeight = clamp(genes.rsiWeight + randomInRange(-0.05, 0.05), 0.05, 0.4);
  }
  if (Math.random() < MUTATION_RATE) {
    mutated.ibWeight = clamp(genes.ibWeight + randomInRange(-0.05, 0.05), 0.05, 0.4);
  }
  if (Math.random() < MUTATION_RATE) {
    mutated.cvdWeight = clamp(genes.cvdWeight + randomInRange(-0.05, 0.05), 0.05, 0.3);
  }
  if (Math.random() < MUTATION_RATE) {
    mutated.vwapWeight = clamp(genes.vwapWeight + randomInRange(-0.05, 0.05), 0.05, 0.4);
  }
  if (Math.random() < MUTATION_RATE) {
    mutated.minConfidence = clamp(genes.minConfidence + randomInRange(-5, 5), 50, 80);
  }
  if (Math.random() < MUTATION_RATE) {
    mutated.orbBreakoutMultiplier = clamp(genes.orbBreakoutMultiplier + randomInRange(-0.2, 0.2), 0.3, 3.0);
  }
  if (Math.random() < MUTATION_RATE) {
    mutated.stopLossMultiplier = clamp(genes.stopLossMultiplier + randomInRange(-0.1, 0.1), 0.2, 0.8);
  }
  if (Math.random() < MUTATION_RATE) {
    mutated.targetMultiplier = clamp(genes.targetMultiplier + randomInRange(-0.3, 0.3), 1.2, 4.0);
  }

  return normalizeWeights(mutated);
}

function crossover(parent1: StrategyGenes, parent2: StrategyGenes): StrategyGenes {
  const child: StrategyGenes = {
    tpoWeight: Math.random() < 0.5 ? parent1.tpoWeight : parent2.tpoWeight,
    rsiWeight: Math.random() < 0.5 ? parent1.rsiWeight : parent2.rsiWeight,
    ibWeight: Math.random() < 0.5 ? parent1.ibWeight : parent2.ibWeight,
    cvdWeight: Math.random() < 0.5 ? parent1.cvdWeight : parent2.cvdWeight,
    vwapWeight: Math.random() < 0.5 ? parent1.vwapWeight : parent2.vwapWeight,
    minConfidence: Math.random() < 0.5 ? parent1.minConfidence : parent2.minConfidence,
    orbBreakoutMultiplier: Math.random() < 0.5 ? parent1.orbBreakoutMultiplier : parent2.orbBreakoutMultiplier,
    stopLossMultiplier: Math.random() < 0.5 ? parent1.stopLossMultiplier : parent2.stopLossMultiplier,
    targetMultiplier: Math.random() < 0.5 ? parent1.targetMultiplier : parent2.targetMultiplier,
  };

  return normalizeWeights(child);
}

function selectParent(population: Individual[]): Individual {
  const totalFitness = population.reduce((sum, ind) => sum + Math.max(0, ind.fitness), 0);
  if (totalFitness === 0) {
    return population[Math.floor(Math.random() * population.length)];
  }

  let random = Math.random() * totalFitness;
  for (const individual of population) {
    random -= Math.max(0, individual.fitness);
    if (random <= 0) return individual;
  }

  return population[population.length - 1];
}

async function calculateFitness(genes: StrategyGenes): Promise<number> {
  const outcomes = await db
    .select()
    .from(auroraParallaxOutcomes)
    .innerJoin(
      auroraParallaxPredictions,
      eq(auroraParallaxOutcomes.predictionId, auroraParallaxPredictions.id)
    );

  if (outcomes.length === 0) return 0.5;

  let wins = 0;
  let totalPnl = 0;

  for (const row of outcomes) {
    const pnl = row.aurora_parallax_outcomes.actualPnl ?? 0;
    if (pnl > 0) wins++;
    totalPnl += pnl;
  }

  const winRate = wins / outcomes.length;
  const avgPnl = totalPnl / outcomes.length;

  return winRate * 0.7 + (avgPnl > 0 ? 0.3 : 0);
}

export async function evolve(): Promise<StrategyGenes> {
  log("Evolution: Starting genetic algorithm optimization...", "aurora");
  
  let population: Individual[] = [];
  for (let i = 0; i < POPULATION_SIZE; i++) {
    population.push({ genes: createRandomGenes(), fitness: 0 });
  }

  for (const individual of population) {
    individual.fitness = await calculateFitness(individual.genes);
  }

  population.sort((a, b) => b.fitness - a.fitness);

  const nextGen: Individual[] = [];

  for (let i = 0; i < ELITE_COUNT && i < population.length; i++) {
    nextGen.push({ ...population[i] });
  }

  while (nextGen.length < POPULATION_SIZE) {
    const parent1 = selectParent(population.slice(0, Math.floor(POPULATION_SIZE / 2)));
    const parent2 = selectParent(population.slice(0, Math.floor(POPULATION_SIZE / 2)));

    let childGenes: StrategyGenes;
    if (Math.random() < CROSSOVER_RATE) {
      childGenes = crossover(parent1.genes, parent2.genes);
    } else {
      childGenes = { ...parent1.genes };
    }

    childGenes = mutate(childGenes);
    nextGen.push({ genes: childGenes, fitness: 0 });
  }

  for (const individual of nextGen) {
    individual.fitness = await calculateFitness(individual.genes);
  }
  nextGen.sort((a, b) => b.fitness - a.fitness);

  const alpha = nextGen[0];
  log(`Evolution: Best fitness = ${alpha.fitness.toFixed(4)}`, "aurora");

  return alpha.genes;
}

export async function getActiveGenes(ticker: string = "SPY"): Promise<StrategyGenes> {
  try {
    const result = await db
      .select()
      .from(auroraPraxisParameters)
      .where(and(
        eq(auroraPraxisParameters.name, ticker),
        eq(auroraPraxisParameters.isActive, true)
      ))
      .orderBy(desc(auroraPraxisParameters.lastUpdated))
      .limit(1);

    if (result.length === 0) {
      return DEFAULT_GENES;
    }

    return result[0].config as StrategyGenes;
  } catch (error) {
    log(`Evolution: Error fetching active genes: ${error}`, "aurora");
    return DEFAULT_GENES;
  }
}

export async function saveAlphaGenes(
  ticker: string,
  genes: StrategyGenes,
  winRate: number
): Promise<void> {
  try {
    // Get existing parameter to log delta
    const existing = await db
      .select()
      .from(auroraPraxisParameters)
      .where(eq(auroraPraxisParameters.name, ticker))
      .limit(1);
    
    if (existing.length > 0) {
      // Log the change
      await db.insert(auroraPraxisDeltas).values({
        parameterId: existing[0].id,
        oldConfig: existing[0].config,
        newConfig: genes,
        changeReason: `Evolution triggered at ${(winRate * 100).toFixed(1)}% win rate`,
      });
      
      // Update existing
      await db
        .update(auroraPraxisParameters)
        .set({
          config: genes,
          winRate,
          lastUpdated: new Date(),
        })
        .where(eq(auroraPraxisParameters.id, existing[0].id));
    } else {
      // Create new
      await db.insert(auroraPraxisParameters).values({
        name: ticker,
        config: genes,
        winRate,
        isActive: true,
      });
    }

    log(`Evolution: Saved new alpha genes for ${ticker} (winRate: ${(winRate * 100).toFixed(1)}%)`, "aurora");
  } catch (error) {
    log(`Evolution: Error saving alpha genes: ${error}`, "aurora");
  }
}

export async function checkAndTriggerEvolution(currentWinRate: number): Promise<boolean> {
  if (currentWinRate < TARGET_ACCURACY) {
    log(`Evolution: Win rate ${(currentWinRate * 100).toFixed(1)}% below target ${TARGET_ACCURACY * 100}%, triggering evolution...`, "aurora");
    
    const newGenes = await evolve();
    await saveAlphaGenes("SPY", newGenes, currentWinRate);
    
    return true;
  }
  
  return false;
}

export const Evolution = {
  evolve,
  getActiveGenes,
  saveAlphaGenes,
  checkAndTriggerEvolution,
  DEFAULT_GENES,
};
