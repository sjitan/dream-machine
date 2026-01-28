/**
 * Options Risk Calculator
 * 
 * Projects Stock Price Levels (from ORB/TPO) into Option Contract Prices using Delta/Gamma.
 * This is the ONLY correct way to calculate Entry/Stop/Target for options trading.
 */

export interface OptionTradePlan {
  contractEntry: number;    // Limit Order price (e.g., $1.25)
  contractStop: number;     // Stop Loss price (e.g., $0.85)
  contractTarget: number;   // Take Profit price (e.g., $2.10)
  underlyingTrigger: number; // Stock price that triggers entry (e.g., $450.50)
  riskReward: number;
}

export interface Greeks {
  delta: number;
  gamma: number;
}

export interface StockLevels {
  entry: number;
  stop: number;
  target: number;
}

export const OptionsRiskCalculator = {
  /**
   * Projects Stock Levels into Option Prices using Delta
   * Formula: ProjectedOption = CurrentOption ± (StockMove * |Delta|)
   * 
   * @param currentOptionAsk - The option premium we pay NOW (e.g., $1.25)
   * @param currentStockPrice - The underlying stock price NOW (e.g., $450.00)
   * @param stockLevels - Entry/Stop/Target from ORB/TPO analysis (stock prices)
   * @param greeks - Delta and Gamma from the option chain
   */
  calculate(
    currentOptionAsk: number,
    currentStockPrice: number,
    stockLevels: StockLevels,
    greeks: Greeks
  ): OptionTradePlan {
    
    // 1. Calculate the Move Required (in Stock Dollars)
    const distToStop = stockLevels.stop - stockLevels.entry;   // e.g., -1.50 (Down)
    const distToTarget = stockLevels.target - stockLevels.entry; // e.g., +3.00 (Up)

    // 2. Use ABS(Delta) - Puts have negative delta, but the logic handles direction via the levels
    const absDelta = Math.abs(greeks.delta);
    
    // 3. Project Option Price Change
    // Stop = premium DROPS by the move magnitude
    // Target = premium GAINS by the move magnitude
    const stopLossDrop = Math.abs(distToStop) * absDelta;
    const targetGain = Math.abs(distToTarget) * absDelta;

    let estimatedStop = currentOptionAsk - stopLossDrop;
    let estimatedTarget = currentOptionAsk + targetGain;

    // 4. Safety Clamps (Option can't be $0.00)
    estimatedStop = Math.max(0.05, estimatedStop);
    estimatedTarget = Math.max(0.05, estimatedTarget);

    // 5. Calculate Risk/Reward
    const risk = currentOptionAsk - estimatedStop;
    const reward = estimatedTarget - currentOptionAsk;
    const riskReward = risk > 0 ? Number((reward / risk).toFixed(2)) : 0;

    return {
      contractEntry: Number(currentOptionAsk.toFixed(2)),
      contractStop: Number(estimatedStop.toFixed(2)),
      contractTarget: Number(estimatedTarget.toFixed(2)),
      underlyingTrigger: stockLevels.entry,
      riskReward,
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
};
