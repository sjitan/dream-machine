/**
 * Aurora Praxis - Generative Learning Loop
 * 
 * Implements three learning mechanisms:
 * 1. Historical training via backtest replay
 * 2. Forward paper trading with outcome tracking
 * 3. Praxis Evolutionary Solver - TypeScript genetic algorithm
 * 
 * Updates prediction weights based on win/loss feedback
 */

import { db } from "../db";
import {
  auroraPraxisParameters,
  auroraPraxisDeltas,
  auroraParallaxPredictions,
  auroraParallaxOutcomes,
  auroraBacktestResults,
} from "@shared/schema";
import { eq, desc, and, gte, lte } from "drizzle-orm";
import { MarketTime } from "./time";

export interface StrategyParameters {
  tpoWeight: number;
  rsiWeight: number;
  ibWeight: number;
  cvdWeight: number;
  vwapWeight: number;
  minConfidence: number;
  orbBreakoutMultiplier: number;
}

export interface EvolutionConfig {
  populationSize: number;
  generations: number;
  mutationRate: number;
  crossoverRate: number;
  eliteCount: number;
}

interface Individual {
  params: StrategyParameters;
  fitness: number;
}

const DEFAULT_STRATEGY: StrategyParameters = {
  tpoWeight: 0.25,
  rsiWeight: 0.20,
  ibWeight: 0.20,
  cvdWeight: 0.15,
  vwapWeight: 0.20,
  minConfidence: 60,
  orbBreakoutMultiplier: 1.0,
};

const DEFAULT_EVOLUTION_CONFIG: EvolutionConfig = {
  populationSize: 50,
  generations: 100,
  mutationRate: 0.1,
  crossoverRate: 0.7,
  eliteCount: 5,
};

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function randomInRange(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

function createRandomIndividual(): Individual {
  return {
    params: {
      tpoWeight: randomInRange(0.1, 0.4),
      rsiWeight: randomInRange(0.1, 0.3),
      ibWeight: randomInRange(0.1, 0.3),
      cvdWeight: randomInRange(0.05, 0.25),
      vwapWeight: randomInRange(0.1, 0.3),
      minConfidence: randomInRange(55, 75),
      orbBreakoutMultiplier: randomInRange(0.5, 2.0),
    },
    fitness: 0,
  };
}

function normalizeWeights(params: StrategyParameters): StrategyParameters {
  const total = params.tpoWeight + params.rsiWeight + params.ibWeight + params.cvdWeight + params.vwapWeight;
  if (total === 0) return DEFAULT_STRATEGY;
  
  return {
    ...params,
    tpoWeight: params.tpoWeight / total,
    rsiWeight: params.rsiWeight / total,
    ibWeight: params.ibWeight / total,
    cvdWeight: params.cvdWeight / total,
    vwapWeight: params.vwapWeight / total,
  };
}

function mutate(params: StrategyParameters, mutationRate: number): StrategyParameters {
  const mutated = { ...params };
  
  if (Math.random() < mutationRate) {
    mutated.tpoWeight = clamp(params.tpoWeight + randomInRange(-0.05, 0.05), 0.05, 0.5);
  }
  if (Math.random() < mutationRate) {
    mutated.rsiWeight = clamp(params.rsiWeight + randomInRange(-0.05, 0.05), 0.05, 0.4);
  }
  if (Math.random() < mutationRate) {
    mutated.ibWeight = clamp(params.ibWeight + randomInRange(-0.05, 0.05), 0.05, 0.4);
  }
  if (Math.random() < mutationRate) {
    mutated.cvdWeight = clamp(params.cvdWeight + randomInRange(-0.05, 0.05), 0.05, 0.3);
  }
  if (Math.random() < mutationRate) {
    mutated.vwapWeight = clamp(params.vwapWeight + randomInRange(-0.05, 0.05), 0.05, 0.4);
  }
  if (Math.random() < mutationRate) {
    mutated.minConfidence = clamp(params.minConfidence + randomInRange(-5, 5), 50, 80);
  }
  if (Math.random() < mutationRate) {
    mutated.orbBreakoutMultiplier = clamp(params.orbBreakoutMultiplier + randomInRange(-0.2, 0.2), 0.3, 3.0);
  }

  return normalizeWeights(mutated);
}

function crossover(parent1: StrategyParameters, parent2: StrategyParameters): StrategyParameters {
  const child: StrategyParameters = {
    tpoWeight: Math.random() < 0.5 ? parent1.tpoWeight : parent2.tpoWeight,
    rsiWeight: Math.random() < 0.5 ? parent1.rsiWeight : parent2.rsiWeight,
    ibWeight: Math.random() < 0.5 ? parent1.ibWeight : parent2.ibWeight,
    cvdWeight: Math.random() < 0.5 ? parent1.cvdWeight : parent2.cvdWeight,
    vwapWeight: Math.random() < 0.5 ? parent1.vwapWeight : parent2.vwapWeight,
    minConfidence: Math.random() < 0.5 ? parent1.minConfidence : parent2.minConfidence,
    orbBreakoutMultiplier: Math.random() < 0.5 ? parent1.orbBreakoutMultiplier : parent2.orbBreakoutMultiplier,
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

export type FitnessFunction = (params: StrategyParameters) => Promise<number>;

export async function runEvolution(
  fitnessFunction: FitnessFunction,
  config: Partial<EvolutionConfig> = {}
): Promise<StrategyParameters> {
  const { populationSize, generations, mutationRate, crossoverRate, eliteCount } = {
    ...DEFAULT_EVOLUTION_CONFIG,
    ...config,
  };

  let population: Individual[] = [];
  for (let i = 0; i < populationSize; i++) {
    population.push(createRandomIndividual());
  }

  for (let gen = 0; gen < generations; gen++) {
    for (const individual of population) {
      individual.fitness = await fitnessFunction(individual.params);
    }

    population.sort((a, b) => b.fitness - a.fitness);

    const nextGen: Individual[] = [];

    for (let i = 0; i < eliteCount && i < population.length; i++) {
      nextGen.push({ ...population[i] });
    }

    while (nextGen.length < populationSize) {
      const parent1 = selectParent(population);
      const parent2 = selectParent(population);

      let childParams: StrategyParameters;
      if (Math.random() < crossoverRate) {
        childParams = crossover(parent1.params, parent2.params);
      } else {
        childParams = { ...parent1.params };
      }

      childParams = mutate(childParams, mutationRate);

      nextGen.push({ params: childParams, fitness: 0 });
    }

    population = nextGen;

    if (gen % 10 === 0) {
      console.log(`Generation ${gen}: Best fitness = ${population[0].fitness.toFixed(4)}`);
    }
  }

  for (const individual of population) {
    individual.fitness = await fitnessFunction(individual.params);
  }
  population.sort((a, b) => b.fitness - a.fitness);

  return population[0].params;
}

export async function calculateHistoricalFitness(
  params: StrategyParameters,
  startDate: string,
  endDate: string
): Promise<number> {
  const outcomes = await db
    .select()
    .from(auroraParallaxOutcomes)
    .innerJoin(
      auroraParallaxPredictions,
      eq(auroraParallaxOutcomes.predictionId, auroraParallaxPredictions.id)
    )
    .where(
      and(
        gte(auroraParallaxPredictions.generatedAt, new Date(startDate)),
        lte(auroraParallaxPredictions.generatedAt, new Date(endDate))
      )
    );

  if (outcomes.length === 0) return 0;

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

export async function saveParameters(
  name: string,
  params: StrategyParameters,
  winRate: number
): Promise<number> {
  const existing = await db
    .select()
    .from(auroraPraxisParameters)
    .where(eq(auroraPraxisParameters.name, name))
    .limit(1);

  if (existing.length > 0) {
    const oldConfig = existing[0].config;

    await db.insert(auroraPraxisDeltas).values({
      parameterId: existing[0].id,
      oldConfig,
      newConfig: params,
      changeReason: `Win rate: ${winRate.toFixed(2)}%`,
    });

    await db
      .update(auroraPraxisParameters)
      .set({
        config: params,
        winRate,
        lastUpdated: new Date(),
      })
      .where(eq(auroraPraxisParameters.id, existing[0].id));

    return existing[0].id;
  }

  const result = await db.insert(auroraPraxisParameters).values({
    name,
    config: params,
    winRate,
    isActive: true,
  }).returning({ id: auroraPraxisParameters.id });

  return result[0].id;
}

export async function getActiveParameters(name: string): Promise<StrategyParameters> {
  const result = await db
    .select()
    .from(auroraPraxisParameters)
    .where(and(eq(auroraPraxisParameters.name, name), eq(auroraPraxisParameters.isActive, true)))
    .orderBy(desc(auroraPraxisParameters.lastUpdated))
    .limit(1);

  if (result.length === 0) {
    return DEFAULT_STRATEGY;
  }

  return result[0].config as StrategyParameters;
}

export async function recordBacktestResult(
  ticker: string,
  strategyName: string,
  timeRange: string,
  stats: { totalTrades: number; winRate: number; profitFactor: number; maxDrawdown: number }
): Promise<void> {
  await db.insert(auroraBacktestResults).values({
    ticker,
    strategyName,
    timeRange,
    totalTrades: stats.totalTrades,
    winRate: stats.winRate,
    profitFactor: stats.profitFactor,
    maxDrawdown: stats.maxDrawdown,
  });
}

export const Praxis = {
  runEvolution,
  calculateHistoricalFitness,
  saveParameters,
  getActiveParameters,
  recordBacktestResult,
  DEFAULT_STRATEGY,
  normalizeWeights,
};
