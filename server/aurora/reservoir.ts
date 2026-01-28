/**
 * Aurora Reservoir - Tradier Market Data Ingestion
 * 
 * Handles:
 * - Quote fetching (real-time price data)
 * - Historical candle data (OHLCV)
 * - Option chain snapshots
 * - Market breadth indicators (VIX, etc.)
 * 
 * Uses Tradier Sandbox API for development
 */

import { db } from "../db";
import {
  auroraMarketCandles,
  auroraMarketQuotes,
  auroraOptionChains,
  auroraMarketBreadth,
} from "@shared/schema";
import { MarketTime } from "./time";
import type { Candle } from "../math/types";

const TRADIER_BASE_URL = "https://sandbox.tradier.com/v1";

interface TradierQuote {
  symbol: string;
  bid: number;
  ask: number;
  last: number;
  volume: number;
  high: number;
  low: number;
  open: number;
  prevclose: number;
}

interface TradierCandle {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

interface TradierTimeSale {
  time: string;
  timestamp: number;
  price: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  vwap: number;
}

interface TradierOption {
  symbol: string;
  strike: number;
  option_type: "call" | "put";
  expiration_date: string;
  bid: number;
  ask: number;
  last: number;
  volume: number;
  open_interest: number;
  greeks?: {
    delta: number;
    gamma: number;
    theta: number;
    vega: number;
    mid_iv: number;
  };
}

function getApiToken(): string {
  const token = process.env.TRADIER_SANDBOX_TOKEN;
  if (!token) {
    throw new Error("TRADIER_SANDBOX_TOKEN not configured");
  }
  return token;
}

async function tradierFetch<T>(endpoint: string): Promise<T | null> {
  try {
    const response = await fetch(`${TRADIER_BASE_URL}${endpoint}`, {
      headers: {
        Authorization: `Bearer ${getApiToken()}`,
        Accept: "application/json",
      },
    });

    if (!response.ok) {
      console.error(`Tradier API error: ${response.status} ${response.statusText}`);
      return null;
    }

    return await response.json();
  } catch (error) {
    console.error("Tradier fetch error:", error);
    return null;
  }
}

export async function fetchQuote(ticker: string): Promise<TradierQuote | null> {
  const data = await tradierFetch<{ quotes: { quote: TradierQuote | TradierQuote[] } }>(
    `/markets/quotes?symbols=${ticker}`
  );

  if (!data?.quotes?.quote) return null;

  const quote = Array.isArray(data.quotes.quote) 
    ? data.quotes.quote[0] 
    : data.quotes.quote;

  return quote;
}

export async function fetchMultipleQuotes(tickers: string[]): Promise<TradierQuote[]> {
  const symbols = tickers.join(",");
  const data = await tradierFetch<{ quotes: { quote: TradierQuote | TradierQuote[] } }>(
    `/markets/quotes?symbols=${symbols}`
  );

  if (!data?.quotes?.quote) return [];

  return Array.isArray(data.quotes.quote) 
    ? data.quotes.quote 
    : [data.quotes.quote];
}

export async function fetchHistoricalCandles(
  ticker: string,
  interval: "1min" | "5min" | "15min" | "daily" = "1min",
  startDate?: string,
  endDate?: string
): Promise<Candle[]> {
  const today = MarketTime.getTodayET();
  const start = startDate || today;
  const end = endDate || today;

  const data = await tradierFetch<{ history: { day?: TradierCandle[]; } }>(
    `/markets/history?symbol=${ticker}&interval=${interval}&start=${start}&end=${end}`
  );

  if (!data?.history?.day) return [];

  return data.history.day.map(c => ({
    timestamp: new Date(c.date),
    open: c.open,
    high: c.high,
    low: c.low,
    close: c.close,
    volume: c.volume,
  }));
}

export async function fetchIntradayCandles(
  ticker: string,
  interval: "1min" | "5min" | "15min" = "1min"
): Promise<Candle[]> {
  const data = await tradierFetch<{ series: { data?: TradierTimeSale[] } }>(
    `/markets/timesales?symbol=${ticker}&interval=${interval}&session_filter=open`
  );

  if (!data?.series?.data) return [];

  return data.series.data.map(c => ({
    timestamp: new Date(c.timestamp * 1000),
    open: c.open,
    high: c.high,
    low: c.low,
    close: c.close,
    volume: c.volume,
  }));
}

export async function fetchOptionChain(
  ticker: string,
  expiration: string
): Promise<TradierOption[]> {
  const data = await tradierFetch<{ options: { option: TradierOption[] } }>(
    `/markets/options/chains?symbol=${ticker}&expiration=${expiration}&greeks=true`
  );

  if (!data?.options?.option) return [];

  return data.options.option;
}

export async function fetchExpirations(ticker: string): Promise<string[]> {
  const data = await tradierFetch<{ expirations: { date: string[] } }>(
    `/markets/options/expirations?symbol=${ticker}`
  );

  if (!data?.expirations?.date) return [];

  return data.expirations.date;
}

export async function fetch0DTEExpiration(ticker: string): Promise<string | null> {
  const expirations = await fetchExpirations(ticker);
  const today = MarketTime.getTodayET();
  
  if (expirations.includes(today)) {
    return today;
  }

  return expirations.length > 0 ? expirations[0] : null;
}

export async function storeQuote(ticker: string, quote: TradierQuote): Promise<void> {
  await db.insert(auroraMarketQuotes).values({
    ticker,
    bid: quote.bid,
    ask: quote.ask,
    last: quote.last,
    size: quote.volume,
  });
}

export async function storeCandles(ticker: string, candles: Candle[]): Promise<void> {
  if (candles.length === 0) return;

  const values = candles.map(c => ({
    ticker,
    timestamp: c.timestamp,
    open: c.open,
    high: c.high,
    low: c.low,
    close: c.close,
    volume: c.volume,
    isComplete: true,
  }));

  await db.insert(auroraMarketCandles).values(values);
}

export async function storeOptionChain(
  ticker: string,
  expiration: string,
  options: TradierOption[]
): Promise<void> {
  if (options.length === 0) return;

  const values = options.map(opt => ({
    ticker,
    expiration,
    strike: opt.strike,
    optionType: opt.option_type.toUpperCase(),
    bid: opt.bid,
    ask: opt.ask,
    iv: opt.greeks?.mid_iv ?? null,
    delta: opt.greeks?.delta ?? null,
    gamma: opt.greeks?.gamma ?? null,
    openInterest: opt.open_interest,
    volume: opt.volume,
  }));

  await db.insert(auroraOptionChains).values(values);
}

export async function fetchAndStoreVIX(): Promise<number | null> {
  // VIX is used internally for risk calculations, but not tracked as a signal ticker
  const vixData = await fetchQuote("VIX");
  if (!vixData) return null;

  await db.insert(auroraMarketBreadth).values({
    timestamp: new Date(),
    vixValue: vixData.last,
    tickValue: null,
    trinValue: null,
    pcRatio: null,
  });

  return vixData.last;
}

export async function ingestTickerData(ticker: string): Promise<{
  quote: TradierQuote | null;
  candles: Candle[];
  optionCount: number;
}> {
  const quote = await fetchQuote(ticker);
  const candles = await fetchIntradayCandles(ticker);
  
  let optionCount = 0;
  const expiration = await fetch0DTEExpiration(ticker);
  
  if (expiration) {
    const options = await fetchOptionChain(ticker, expiration);
    optionCount = options.length;
    
    if (options.length > 0) {
      await storeOptionChain(ticker, expiration, options);
    }
  }

  if (quote) {
    await storeQuote(ticker, quote);
  }

  if (candles.length > 0) {
    await storeCandles(ticker, candles);
  }

  return { quote, candles, optionCount };
}

export const Reservoir = {
  fetchQuote,
  fetchMultipleQuotes,
  fetchHistoricalCandles,
  fetchIntradayCandles,
  fetchOptionChain,
  fetchExpirations,
  fetch0DTEExpiration,
  storeQuote,
  storeCandles,
  storeOptionChain,
  fetchAndStoreVIX,
  ingestTickerData,
};
