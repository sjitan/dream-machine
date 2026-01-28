/**
 * Aurora Daemon - Orchestrates the prediction pipeline
 * 
 * Runs every 30 seconds during market hours:
 * 1. Fetches live quotes and intraday candles from Tradier
 * 2. Stores data in the database
 * 3. Runs prediction engines (TPO+MIT, Black-Scholes, ORB)
 * 4. Saves high-confidence predictions (60%+) to database
 * 5. Expires stale predictions at end of day
 */

import { MarketTime } from "./time";
import { MarketCalendar } from "./calendar";
import {
  fetchMultipleQuotes,
  fetchIntradayCandles,
  fetchOptionChain,
  fetch0DTEExpiration,
  storeQuote,
  storeCandles,
} from "./reservoir";
import { OptionsRiskCalculator } from "../math/options_risk";
import {
  generateTPOMITPrediction,
  generateBlackScholesPrediction,
  generateORBPrediction,
  storePrediction,
  getActivePredictions,
  updatePredictionStatus,
  type Prediction,
  type PredictionCategory,
} from "./parallax";
import { Reconcile } from "./reconcile";
import { log } from "../index";

// Phase 1: SPY only per requirements Section 1
// SPX and Friday tickers are Phase 2 (after SPY proven)
const TRACKED_TICKERS = ["SPY"];
const DAILY_0DTE = ["SPY"];
const FRIDAY_0DTE: string[] = []; // Disabled until Phase 2
const REFRESH_INTERVAL_MS = 30_000;

let isRunning = false;
let intervalId: NodeJS.Timeout | null = null;

function getCategory(ticker: string): PredictionCategory {
  if (ticker === "SPY") return "SPY_DAILY";
  if (ticker === "SPX") return "SPX_DAILY";
  if (ticker === "NVDA") return "NVDA_FRIDAY";
  if (ticker === "TSLA") return "TSLA_FRIDAY";
  if (ticker === "XOM") return "XOM_FRIDAY";
  if (ticker === "AAPL") return "AAPL_FRIDAY";
  if (ticker === "ASML") return "ASML_FRIDAY";
  return "SPY_DAILY";
}

function getActiveTickers(): string[] {
  const holidays = MarketCalendar.getHolidaysSet();
  const halfDays = MarketCalendar.getHalfDaysSet();
  const isFriday = MarketTime.isFriday();
  
  if (isFriday) {
    return [...DAILY_0DTE, ...FRIDAY_0DTE];
  }
  return DAILY_0DTE;
}

async function runPredictionCycle(): Promise<void> {
  const holidays = MarketCalendar.getHolidaysSet();
  const halfDays = MarketCalendar.getHalfDaysSet();
  
  const dayType = MarketCalendar.getDayType(MarketTime.getTodayET());
  if (dayType === "HOLIDAY" || dayType === "WEEKEND") {
    log(`Aurora: Market closed (${dayType}), skipping cycle`, "aurora");
    return;
  }

  const session = MarketTime.getSession(holidays, halfDays);
  const isTrading = MarketTime.isTradingHours(holidays, halfDays);
  const isPreMarket = MarketTime.isPreMarket(holidays);

  if (!isTrading && !isPreMarket) {
    log(`Aurora: Outside trading hours (${session}), skipping cycle`, "aurora");
    return;
  }

  const activeTickers = getActiveTickers();
  log(`Aurora: Running prediction cycle for ${activeTickers.join(", ")} [${session}]`, "aurora");

  try {
    const quotes = await fetchMultipleQuotes(activeTickers);
    if (quotes.length === 0) {
      log("Aurora: No quotes received from Tradier", "aurora");
      return;
    }

    for (const quote of quotes) {
      if (quote.last > 0) {
        await storeQuote(quote.symbol, quote);
      }
    }

    let predictionsGenerated = 0;

    for (const ticker of activeTickers) {
      const quote = quotes.find(q => q.symbol === ticker);
      if (!quote) {
        log(`Aurora: [${ticker}] No quote data received`, "aurora");
        continue;
      }
      if (quote.last <= 0) {
        log(`Aurora: [${ticker}] Invalid price: ${quote.last}`, "aurora");
        continue;
      }

      const currentPrice = quote.last;
      const category = getCategory(ticker);

      let prediction: Prediction | null = null;

      if (isPreMarket) {
        prediction = generateBlackScholesPrediction(ticker, category, currentPrice, 0.25, "NEUTRAL");
        log(`Aurora: [${ticker}] Pre-market BS prediction: ${prediction ? `${prediction.direction} ${prediction.confidence.toFixed(1)}%` : 'null'}`, "aurora");
      } else if (isTrading) {
        const candles = await fetchIntradayCandles(ticker, "1min");
        log(`Aurora: [${ticker}] Fetched ${candles.length} candles, price: $${currentPrice.toFixed(2)}`, "aurora");
        
        if (candles.length > 0) {
          await storeCandles(ticker, candles.slice(-10));
        }

        if (candles.length >= 30) {
          prediction = await generateTPOMITPrediction(ticker, category, candles, currentPrice);
          log(`Aurora: [${ticker}] TPO prediction: ${prediction ? `${prediction.direction} ${prediction.confidence.toFixed(1)}%` : 'null (no signal or <60%)'}`, "aurora");
          
          if (!prediction && session === "OPENING_RANGE" && candles.length >= 30) {
            prediction = generateORBPrediction(ticker, category, candles.slice(0, 30), currentPrice);
            log(`Aurora: [${ticker}] ORB prediction: ${prediction ? `${prediction.direction} ${prediction.confidence.toFixed(1)}%` : 'null'}`, "aurora");
          }
        } else {
          log(`Aurora: [${ticker}] Insufficient candles (${candles.length}/30)`, "aurora");
        }
      }

      if (prediction && prediction.confidence >= 60) {
        const existingPredictions = await getActivePredictions(ticker);
        const hasSameDirection = existingPredictions.some(
          p => p.direction === prediction!.direction && p.engine === prediction!.engine
        );

        if (!hasSameDirection) {
          // Fetch option chain to get contract premium and Greeks (Delta)
          const expiration = await fetch0DTEExpiration(ticker);
          if (expiration) {
            const chain = await fetchOptionChain(ticker, expiration);
            const optionType = prediction.direction.toLowerCase() as "call" | "put";
            
            // Find the contract at our strike
            const contract = chain.find(
              c => c.strike === prediction!.strike && c.option_type === optionType
            );
            
            if (contract && contract.bid > 0 && contract.greeks) {
              // Use Delta-based projection to convert stock levels to option prices
              const currentOptionAsk = OptionsRiskCalculator.getMidPrice(contract.bid, contract.ask);
              
              // Stock levels from the prediction (entry/stop/target as STOCK prices)
              const stockLevels = {
                entry: prediction.entryTrigger ?? currentPrice,
                stop: prediction.stopLoss ?? currentPrice,
                target: prediction.takeProfit ?? currentPrice,
              };
              
              // Greeks from option chain
              const greeks = {
                delta: Math.abs(contract.greeks.delta),  // Use absolute delta
                gamma: contract.greeks.gamma,
              };
              
              // Project stock levels onto option prices using Delta
              const optionTradePlan = OptionsRiskCalculator.calculate(
                currentOptionAsk,
                currentPrice,
                stockLevels,
                greeks
              );
              
              // Update prediction with OPTION CONTRACT prices
              prediction.entryPrice = optionTradePlan.contractEntry;
              prediction.entryTrigger = optionTradePlan.contractEntry;
              prediction.stopLoss = optionTradePlan.contractStop;
              prediction.takeProfit = optionTradePlan.contractTarget;
              prediction.riskRewardRatio = optionTradePlan.riskReward;
              
              log(`Aurora: [${ticker}] Delta projection: premium=$${currentOptionAsk.toFixed(2)}, delta=${greeks.delta.toFixed(2)}, entry=$${optionTradePlan.contractEntry}, stop=$${optionTradePlan.contractStop}, target=$${optionTradePlan.contractTarget}`, "aurora");
            } else if (contract && contract.bid > 0) {
              // No Greeks available, use mid-price with simple percentage stops
              const premium = OptionsRiskCalculator.getMidPrice(contract.bid, contract.ask);
              prediction.entryPrice = premium;
              prediction.entryTrigger = premium;
              prediction.stopLoss = Number((premium * 0.5).toFixed(2));  // 50% stop
              prediction.takeProfit = Number((premium * 2.0).toFixed(2)); // 2x target
              prediction.riskRewardRatio = 2.0;
              
              log(`Aurora: [${ticker}] No Greeks, using fixed %: premium=$${premium.toFixed(2)}, stop=$${prediction.stopLoss}, target=$${prediction.takeProfit}`, "aurora");
            } else {
              log(`Aurora: [${ticker}] No valid contract found at strike $${prediction.strike}`, "aurora");
            }
          }
          
          const predictionId = await storePrediction(prediction);
          log(`Aurora: NEW ${prediction.direction} on ${ticker} @ strike $${prediction.strike} (${prediction.confidence.toFixed(1)}% conf, contract entry: $${prediction.entryTrigger?.toFixed(2) || 'N/A'})`, "aurora");
          predictionsGenerated++;
        } else {
          log(`Aurora: [${ticker}] Skipped - same ${prediction.direction}/${prediction.engine} already active`, "aurora");
        }
      }
    }

    if (predictionsGenerated > 0) {
      log(`Aurora: Generated ${predictionsGenerated} new prediction(s)`, "aurora");
    }

  } catch (error) {
    log(`Aurora: Prediction cycle error: ${error}`, "aurora");
  }
}

async function expireOldPredictions(): Promise<void> {
  try {
    const activePredictions = await getActivePredictions();
    const today = MarketTime.getTodayET();

    for (const prediction of activePredictions) {
      if (!prediction.generatedAt) continue;
      const generatedDate = new Date(prediction.generatedAt).toISOString().slice(0, 10);
      if (generatedDate < today) {
        await updatePredictionStatus(prediction.id, "EXPIRED");
        log(`Aurora: Expired prediction #${prediction.id} for ${prediction.ticker}`, "aurora");
      }
    }
  } catch (error) {
    log(`Aurora: Failed to expire predictions: ${error}`, "aurora");
  }
}

export function startAuroraDaemon(): void {
  if (isRunning) {
    log("Aurora: Daemon already running", "aurora");
    return;
  }

  log("Aurora: Starting daemon (30-second interval)", "aurora");
  isRunning = true;

  runPredictionCycle();
  expireOldPredictions();

  intervalId = setInterval(async () => {
    runPredictionCycle();
    
    // Run reconciliation every minute (when seconds < 10)
    const seconds = new Date().getSeconds();
    if (seconds < 10) {
      await Reconcile.gradeOpenTrades();
    }
  }, REFRESH_INTERVAL_MS);
}

export function stopAuroraDaemon(): void {
  if (!isRunning || !intervalId) {
    log("Aurora: Daemon not running", "aurora");
    return;
  }

  clearInterval(intervalId);
  intervalId = null;
  isRunning = false;
  log("Aurora: Daemon stopped", "aurora");
}

export function isDaemonRunning(): boolean {
  return isRunning;
}

export const AuroraDaemon = {
  start: startAuroraDaemon,
  stop: stopAuroraDaemon,
  isRunning: isDaemonRunning,
  runCycle: runPredictionCycle,
};
