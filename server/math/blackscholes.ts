/**
 * Black-Scholes Options Pricing - Pure TypeScript Implementation
 * 
 * Used for pre-market prediction engine when volume data is unavailable.
 * Calculates theoretical option prices and Greeks.
 */

export interface BlackScholesInput {
  spotPrice: number;
  strikePrice: number;
  timeToExpiry: number;
  riskFreeRate: number;
  volatility: number;
  optionType: "CALL" | "PUT";
}

export interface BlackScholesOutput {
  theoreticalPrice: number;
  delta: number;
  gamma: number;
  theta: number;
  vega: number;
  rho: number;
}

export interface PreMarketPrediction {
  ticker: string;
  direction: "CALL" | "PUT";
  strike: number;
  confidence: number;
  theoreticalPrice: number;
  expectedMove: number;
  reasoning: string[];
}

function normalCDF(x: number): number {
  const a1 = 0.254829592;
  const a2 = -0.284496736;
  const a3 = 1.421413741;
  const a4 = -1.453152027;
  const a5 = 1.061405429;
  const p = 0.3275911;

  const sign = x < 0 ? -1 : 1;
  x = Math.abs(x) / Math.sqrt(2);

  const t = 1.0 / (1.0 + p * x);
  const y = 1.0 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-x * x);

  return 0.5 * (1.0 + sign * y);
}

function normalPDF(x: number): number {
  return Math.exp(-0.5 * x * x) / Math.sqrt(2 * Math.PI);
}

export function calculateBlackScholes(input: BlackScholesInput): BlackScholesOutput {
  const { spotPrice, strikePrice, timeToExpiry, riskFreeRate, volatility, optionType } = input;

  if (timeToExpiry <= 0) {
    const intrinsic = optionType === "CALL" 
      ? Math.max(0, spotPrice - strikePrice)
      : Math.max(0, strikePrice - spotPrice);
    
    return {
      theoreticalPrice: intrinsic,
      delta: optionType === "CALL" ? (spotPrice > strikePrice ? 1 : 0) : (spotPrice < strikePrice ? -1 : 0),
      gamma: 0,
      theta: 0,
      vega: 0,
      rho: 0,
    };
  }

  const sqrtT = Math.sqrt(timeToExpiry);
  const d1 = (Math.log(spotPrice / strikePrice) + (riskFreeRate + 0.5 * volatility * volatility) * timeToExpiry) / (volatility * sqrtT);
  const d2 = d1 - volatility * sqrtT;

  const Nd1 = normalCDF(d1);
  const Nd2 = normalCDF(d2);
  const NnegD1 = normalCDF(-d1);
  const NnegD2 = normalCDF(-d2);
  const nd1 = normalPDF(d1);

  const discountFactor = Math.exp(-riskFreeRate * timeToExpiry);

  let theoreticalPrice: number;
  let delta: number;

  if (optionType === "CALL") {
    theoreticalPrice = spotPrice * Nd1 - strikePrice * discountFactor * Nd2;
    delta = Nd1;
  } else {
    theoreticalPrice = strikePrice * discountFactor * NnegD2 - spotPrice * NnegD1;
    delta = -NnegD1;
  }

  const gamma = nd1 / (spotPrice * volatility * sqrtT);

  const thetaBase = -(spotPrice * nd1 * volatility) / (2 * sqrtT);
  let theta: number;
  if (optionType === "CALL") {
    theta = thetaBase - riskFreeRate * strikePrice * discountFactor * Nd2;
  } else {
    theta = thetaBase + riskFreeRate * strikePrice * discountFactor * NnegD2;
  }
  theta = theta / 365;

  const vega = spotPrice * sqrtT * nd1 / 100;

  let rho: number;
  if (optionType === "CALL") {
    rho = strikePrice * timeToExpiry * discountFactor * Nd2 / 100;
  } else {
    rho = -strikePrice * timeToExpiry * discountFactor * NnegD2 / 100;
  }

  return {
    theoreticalPrice: Math.max(0, theoreticalPrice),
    delta,
    gamma,
    theta,
    vega,
    rho,
  };
}

export function calculateImpliedVolatility(
  marketPrice: number,
  spotPrice: number,
  strikePrice: number,
  timeToExpiry: number,
  riskFreeRate: number,
  optionType: "CALL" | "PUT",
  tolerance: number = 0.0001,
  maxIterations: number = 100
): number | null {
  let volLow = 0.01;
  let volHigh = 5.0;
  let volMid = 0.5;

  for (let i = 0; i < maxIterations; i++) {
    volMid = (volLow + volHigh) / 2;

    const result = calculateBlackScholes({
      spotPrice,
      strikePrice,
      timeToExpiry,
      riskFreeRate,
      volatility: volMid,
      optionType,
    });

    const priceDiff = result.theoreticalPrice - marketPrice;

    if (Math.abs(priceDiff) < tolerance) {
      return volMid;
    }

    if (priceDiff > 0) {
      volHigh = volMid;
    } else {
      volLow = volMid;
    }
  }

  return volMid;
}

export function getExpectedMove(
  spotPrice: number,
  volatility: number,
  timeToExpiry: number
): number {
  return spotPrice * volatility * Math.sqrt(timeToExpiry);
}

export function generatePreMarketPrediction(
  ticker: string,
  spotPrice: number,
  volatility: number,
  riskFreeRate: number = 0.05,
  bias: "BULLISH" | "BEARISH" | "NEUTRAL" = "NEUTRAL"
): PreMarketPrediction | null {
  const timeToExpiry = 1 / 365;
  const expectedMove = getExpectedMove(spotPrice, volatility, timeToExpiry);
  
  let direction: "CALL" | "PUT";
  let strikeOffset: number;
  const reasoning: string[] = [];

  if (bias === "BULLISH") {
    direction = "CALL";
    strikeOffset = spotPrice * 0.005;
    reasoning.push("Pre-market bias: BULLISH");
    reasoning.push("Selecting OTM call option");
  } else if (bias === "BEARISH") {
    direction = "PUT";
    strikeOffset = spotPrice * 0.005;
    reasoning.push("Pre-market bias: BEARISH");
    reasoning.push("Selecting OTM put option");
  } else {
    return null;
  }

  const strike = direction === "CALL" 
    ? Math.ceil((spotPrice + strikeOffset) / 0.5) * 0.5
    : Math.floor((spotPrice - strikeOffset) / 0.5) * 0.5;

  const bsResult = calculateBlackScholes({
    spotPrice,
    strikePrice: strike,
    timeToExpiry,
    riskFreeRate,
    volatility,
    optionType: direction,
  });

  const moneyness = direction === "CALL" 
    ? (spotPrice - strike) / spotPrice 
    : (strike - spotPrice) / spotPrice;
  
  let confidence = 50;
  
  if (moneyness > -0.02 && moneyness < 0) {
    confidence += 10;
    reasoning.push("Strike is near ATM - higher probability");
  }
  
  if (volatility > 0.3 && volatility < 0.5) {
    confidence += 5;
    reasoning.push("IV in optimal range for 0DTE");
  }

  confidence += 5;
  reasoning.push(`Directional bias confirmed: ${bias}`);

  reasoning.push(`Expected daily move: $${expectedMove.toFixed(2)}`);
  reasoning.push(`Theoretical price: $${bsResult.theoreticalPrice.toFixed(2)}`);
  reasoning.push(`Delta: ${bsResult.delta.toFixed(3)}`);

  return {
    ticker,
    direction,
    strike,
    confidence: Math.min(100, Math.max(0, confidence)),
    theoreticalPrice: bsResult.theoreticalPrice,
    expectedMove,
    reasoning,
  };
}
