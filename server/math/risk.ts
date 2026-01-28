/**
 * Aurora Risk Calculator
 * 
 * Calculates Trade Plans for 0DTE OPTIONS trading.
 * Entry/Stop/Target are OPTION PREMIUM prices, NOT stock prices.
 */

import type { ORBLevels } from "./orb";
import type { TPOProfile } from "./tpo";

export interface TradePlan {
  entry: number;   // Option premium to pay per contract
  stop: number;    // Premium level to cut losses
  target: number;  // Premium level to take profit
  riskReward: number;
}

export interface OptionContract {
  symbol: string;
  strike: number;
  optionType: "call" | "put";
  bid: number;
  ask: number;
  last: number;
  iv?: number;
}

/**
 * Default risk parameters for 0DTE options
 */
const DEFAULT_STOP_LOSS_PCT = 0.50;    // Cut losses at 50% of premium
const DEFAULT_TARGET_MULT = 2.0;       // Target 2x the entry premium (100% gain)

export const RiskCalculator = {
  /**
   * PRIMARY METHOD: Calculate Trade Plan from Option Premium
   * This is the correct way to calculate Entry/Stop/Target for options trading.
   * 
   * @param premium - The option premium (mid-price or mark)
   * @param stopLossPct - Percentage of premium loss before stopping (default 50%)
   * @param targetMultiple - Multiple of entry for target (default 2.0 = 100% gain)
   */
  fromOptionPremium(
    premium: number,
    stopLossPct: number = DEFAULT_STOP_LOSS_PCT,
    targetMultiple: number = DEFAULT_TARGET_MULT
  ): TradePlan {
    const entry = premium;
    const stop = entry * (1 - stopLossPct);  // e.g., $1.00 * 0.5 = $0.50
    const target = entry * targetMultiple;   // e.g., $1.00 * 2.0 = $2.00
    
    const risk = entry - stop;     // What you can lose per contract
    const reward = target - entry; // What you can gain per contract
    
    return {
      entry,
      stop,
      target,
      riskReward: risk > 0 ? reward / risk : 0,
    };
  },

  /**
   * Calculate mid-price from bid/ask
   */
  getMidPrice(bid: number, ask: number): number {
    if (bid <= 0 && ask <= 0) return 0;
    if (bid <= 0) return ask;
    if (ask <= 0) return bid;
    return (bid + ask) / 2;
  },

  /**
   * Create trade plan from an option contract
   */
  fromContract(
    contract: OptionContract,
    stopLossPct: number = DEFAULT_STOP_LOSS_PCT,
    targetMultiple: number = DEFAULT_TARGET_MULT
  ): TradePlan {
    const premium = this.getMidPrice(contract.bid, contract.ask);
    return this.fromOptionPremium(premium, stopLossPct, targetMultiple);
  },

  /**
   * LEGACY: Calculates Trade Plan from ORB Breakout levels (stock prices)
   * Keep for reference but prefer fromOptionPremium for actual trading
   */
  fromORB(levels: ORBLevels, direction: "CALL" | "PUT"): TradePlan {
    const BUFFER = 0.05;

    if (direction === "CALL") {
      const entry = levels.high + BUFFER;
      const stop = levels.stopLossLong;
      const target = levels.targetBull1;
      const risk = entry - stop;
      const reward = target - entry;
      
      return {
        entry,
        stop,
        target,
        riskReward: risk > 0 ? reward / risk : 0,
      };
    } else {
      const entry = levels.low - BUFFER;
      const stop = levels.stopLossShort;
      const target = levels.targetBear1;
      const risk = stop - entry;
      const reward = entry - target;
      
      return {
        entry,
        stop,
        target,
        riskReward: risk > 0 ? reward / risk : 0,
      };
    }
  },

  /**
   * LEGACY: Calculates Trade Plan from TPO Profile levels (stock prices)
   */
  fromTPO(
    profile: TPOProfile,
    currentPrice: number,
    direction: "CALL" | "PUT",
    atr: number = 2.0
  ): TradePlan {
    if (direction === "PUT") {
      const entry = currentPrice;
      const stop = profile.vah + atr;
      const target = profile.poc;
      const risk = stop - entry;
      const reward = entry - target;
      
      return {
        entry,
        stop,
        target,
        riskReward: risk > 0 ? reward / risk : 0,
      };
    } else {
      const entry = currentPrice;
      const stop = profile.val - atr;
      const target = profile.poc;
      const risk = entry - stop;
      const reward = target - entry;
      
      return {
        entry,
        stop,
        target,
        riskReward: risk > 0 ? reward / risk : 0,
      };
    }
  },

  /**
   * LEGACY: Calculates Trade Plan from Black-Scholes expected move (stock prices)
   */
  fromBlackScholes(
    currentPrice: number,
    expectedMove: number,
    direction: "CALL" | "PUT"
  ): TradePlan {
    const stopMultiplier = 0.5;
    const targetMultiplier = 1.0;

    if (direction === "CALL") {
      const entry = currentPrice;
      const stop = currentPrice - (expectedMove * stopMultiplier);
      const target = currentPrice + (expectedMove * targetMultiplier);
      const risk = entry - stop;
      const reward = target - entry;
      
      return {
        entry,
        stop,
        target,
        riskReward: risk > 0 ? reward / risk : 0,
      };
    } else {
      const entry = currentPrice;
      const stop = currentPrice + (expectedMove * stopMultiplier);
      const target = currentPrice - (expectedMove * targetMultiplier);
      const risk = stop - entry;
      const reward = entry - target;
      
      return {
        entry,
        stop,
        target,
        riskReward: risk > 0 ? reward / risk : 0,
      };
    }
  },

  /**
   * Validates a trade plan has acceptable risk/reward
   */
  isAcceptable(plan: TradePlan, minRR: number = 1.0): boolean {
    return plan.riskReward >= minRR;
  },

  /**
   * Calculate number of contracts based on account risk
   */
  calculateContracts(
    accountBalance: number,
    riskPercent: number,
    premium: number
  ): number {
    const riskAmount = accountBalance * (riskPercent / 100);
    // Each contract costs premium * 100 (options are for 100 shares)
    const costPerContract = premium * 100;
    return costPerContract > 0 ? Math.floor(riskAmount / costPerContract) : 0;
  },
};
