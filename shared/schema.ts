import { pgTable, text, varchar, integer, boolean, real, timestamp, serial, index, jsonb, numeric } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

export const sessions = pgTable(
  "sessions",
  {
    sid: varchar("sid").primaryKey(),
    sess: jsonb("sess").notNull(),
    expire: timestamp("expire").notNull(),
  },
  (table) => [index("IDX_session_expire").on(table.expire)],
);

export const dreamItems = pgTable("dream_items", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  cost: real("cost").notNull(),
  purchased: boolean("purchased").notNull().default(false),
  iconType: text("icon_type").notNull().default("target"),
  url: text("url"),
  category: text("category").notNull().default("Uncategorized"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertDreamItemSchema = createInsertSchema(dreamItems, {
  cost: z.number().positive().max(1000000000),
}).omit({
  id: true,
  createdAt: true,
});

export type InsertDreamItem = z.infer<typeof insertDreamItemSchema>;
export type DreamItem = typeof dreamItems.$inferSelect;

export const userSettings = pgTable("user_settings", {
  id: serial("id").primaryKey(),
  currentBalance: real("current_balance").default(0),
  ultimateGoal: real("ultimate_goal").default(348000000),
  originBalance: real("origin_balance").default(500),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const insertUserSettingsSchema = createInsertSchema(userSettings).omit({
  id: true,
  updatedAt: true,
});

export type InsertUserSettings = z.infer<typeof insertUserSettingsSchema>;
export type UserSettings = typeof userSettings.$inferSelect;

// ==============================================================================
// AURORA AUCTION INTELLIGENCE (AAI) SCHEMA
// ==============================================================================

// ==============================================================================
// 1. RESERVOIR: RAW MARKET DATA
// ==============================================================================

export const auroraMarketCandles = pgTable("aurora_market_candles", {
  id: serial("id").primaryKey(),
  ticker: text("ticker").notNull(),
  timestamp: timestamp("timestamp", { withTimezone: true }).notNull(),
  open: real("open").notNull(),
  high: real("high").notNull(),
  low: real("low").notNull(),
  close: real("close").notNull(),
  volume: real("volume").notNull(),
  isComplete: boolean("is_complete").default(true),
});

export const auroraMarketQuotes = pgTable("aurora_market_quotes", {
  id: serial("id").primaryKey(),
  ticker: text("ticker").notNull(),
  timestamp: timestamp("timestamp", { withTimezone: true }).defaultNow(),
  bid: real("bid").notNull(),
  ask: real("ask").notNull(),
  last: real("last").notNull(),
  size: integer("size"),
});

export const auroraMarketBreadth = pgTable("aurora_market_breadth", {
  id: serial("id").primaryKey(),
  timestamp: timestamp("timestamp", { withTimezone: true }).notNull(),
  vixValue: real("vix_value"),
  tickValue: real("tick_value"),
  trinValue: real("trin_value"),
  pcRatio: real("pc_ratio"),
});

export const auroraOptionChains = pgTable("aurora_option_chains", {
  id: serial("id").primaryKey(),
  ticker: text("ticker").notNull(),
  snapshotTime: timestamp("snapshot_time", { withTimezone: true }).defaultNow(),
  expiration: text("expiration").notNull(),
  strike: real("strike").notNull(),
  optionType: text("option_type").notNull(),
  bid: real("bid"),
  ask: real("ask"),
  iv: real("iv"),
  delta: real("delta"),
  gamma: real("gamma"),
  openInterest: integer("open_interest"),
  volume: integer("volume"),
});

// ==============================================================================
// 2. PARALLAX: CALCULATED INDICATORS
// ==============================================================================

export const auroraTechnicalSnapshots = pgTable("aurora_technical_snapshots", {
  id: serial("id").primaryKey(),
  ticker: text("ticker").notNull(),
  timestamp: timestamp("timestamp", { withTimezone: true }).notNull(),
  rsi14: real("rsi_14"),
  rsi5: real("rsi_5"),
  sma9: real("sma_9"),
  sma20: real("sma_20"),
  vwap: real("vwap"),
  bollingerUpper: real("bollinger_upper"),
  bollingerLower: real("bollinger_lower"),
  atr: real("atr"),
});

export const auroraTpoProfiles = pgTable("aurora_tpo_profiles", {
  id: serial("id").primaryKey(),
  ticker: text("ticker").notNull(),
  sessionDate: text("session_date").notNull(),
  poc: real("poc").notNull(),
  vah: real("vah").notNull(),
  val: real("val").notNull(),
  impulse: text("impulse"),
  profileData: jsonb("profile_data"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
});

export const auroraGexProfiles = pgTable("aurora_gex_profiles", {
  id: serial("id").primaryKey(),
  ticker: text("ticker").notNull(),
  sessionDate: text("session_date").notNull(),
  zeroGammaLevel: real("zero_gamma_level"),
  callWall: real("call_wall"),
  putWall: real("put_wall"),
  totalGamma: real("total_gamma"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
});

export const auroraAuctionStructure = pgTable("aurora_auction_structure", {
  id: serial("id").primaryKey(),
  ticker: text("ticker").notNull(),
  sessionDate: text("session_date").notNull(),
  ibHigh: real("ib_high"),
  ibLow: real("ib_low"),
  ibWidth: real("ib_width"),
  openingType: text("opening_type"),
  isClean: boolean("is_clean").default(true),
});

export const auroraOrderFlow = pgTable("aurora_order_flow", {
  id: serial("id").primaryKey(),
  ticker: text("ticker").notNull(),
  timestamp: timestamp("timestamp", { withTimezone: true }).notNull(),
  delta: real("delta"),
  cumulativeDelta: real("cumulative_delta"),
  anchoredVwap: real("anchored_vwap"),
  cvdDivergence: boolean("cvd_divergence").default(false),
});

// ==============================================================================
// 3. LATTICE: PREDICTIONS & OUTCOMES
// ==============================================================================

export const auroraParallaxPredictions = pgTable("aurora_parallax_predictions", {
  id: serial("id").primaryKey(),
  ticker: text("ticker").notNull(),
  category: text("category").notNull(),
  direction: text("direction").notNull(),
  strike: real("strike").notNull(),
  entryPrice: real("entry_price"),
  confidence: real("confidence").notNull(),
  
  // Trade Plan (Entry/Stop/Target)
  entryTrigger: real("entry_trigger"),
  stopLoss: real("stop_loss"),
  takeProfit: real("take_profit"),
  riskRewardRatio: real("risk_reward_ratio"),
  
  session: text("session"),
  engine: text("engine"),
  reasoning: jsonb("reasoning").notNull(),
  status: text("status").default("ACTIVE"),
  generatedAt: timestamp("generated_at", { withTimezone: true }).defaultNow(),
  expiresAt: timestamp("expires_at", { withTimezone: true }),
});

export const auroraParallaxOutcomes = pgTable("aurora_parallax_outcomes", {
  id: serial("id").primaryKey(),
  predictionId: integer("prediction_id").references(() => auroraParallaxPredictions.id),
  actualPnl: real("actual_pnl"),
  result: text("result"),
  closedAt: timestamp("closed_at", { withTimezone: true }),
});

// ==============================================================================
// 4. PRAXIS: LEARNING & OPTIMIZATION
// ==============================================================================

export const auroraPraxisParameters = pgTable("aurora_praxis_parameters", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  config: jsonb("config").notNull(),
  winRate: real("win_rate").default(0),
  isActive: boolean("is_active").default(true),
  lastUpdated: timestamp("last_updated", { withTimezone: true }).defaultNow(),
});

export const auroraPraxisDeltas = pgTable("aurora_praxis_deltas", {
  id: serial("id").primaryKey(),
  parameterId: integer("parameter_id").references(() => auroraPraxisParameters.id),
  oldConfig: jsonb("old_config"),
  newConfig: jsonb("new_config").notNull(),
  changeReason: text("change_reason"),
  changedAt: timestamp("changed_at", { withTimezone: true }).defaultNow(),
});

export const auroraBacktestResults = pgTable("aurora_backtest_results", {
  id: serial("id").primaryKey(),
  ticker: text("ticker").notNull(),
  strategyName: text("strategy_name").notNull(),
  timeRange: text("time_range").notNull(),
  totalTrades: integer("total_trades"),
  winRate: real("win_rate"),
  profitFactor: real("profit_factor"),
  maxDrawdown: real("max_drawdown"),
  runAt: timestamp("run_at", { withTimezone: true }).defaultNow(),
});

// ==============================================================================
// 5. HARMONICS: INFRASTRUCTURE
// ==============================================================================

export const auroraCalendarSessions = pgTable("aurora_calendar_sessions", {
  id: serial("id").primaryKey(),
  date: text("date").notNull().unique(),
  dayType: text("day_type").notNull(),
});

// ==============================================================================
// AURORA TYPE EXPORTS
// ==============================================================================

export type AuroraMarketCandle = typeof auroraMarketCandles.$inferSelect;
export type AuroraMarketQuote = typeof auroraMarketQuotes.$inferSelect;
export type AuroraMarketBreadth = typeof auroraMarketBreadth.$inferSelect;
export type AuroraOptionChain = typeof auroraOptionChains.$inferSelect;
export type AuroraTechnicalSnapshot = typeof auroraTechnicalSnapshots.$inferSelect;
export type AuroraTpoProfile = typeof auroraTpoProfiles.$inferSelect;
export type AuroraGexProfile = typeof auroraGexProfiles.$inferSelect;
export type AuroraAuctionStructure = typeof auroraAuctionStructure.$inferSelect;
export type AuroraOrderFlow = typeof auroraOrderFlow.$inferSelect;
export type AuroraParallaxPrediction = typeof auroraParallaxPredictions.$inferSelect;
export type AuroraParallaxOutcome = typeof auroraParallaxOutcomes.$inferSelect;
export type AuroraPraxisParameter = typeof auroraPraxisParameters.$inferSelect;
export type AuroraPraxisDelta = typeof auroraPraxisDeltas.$inferSelect;
export type AuroraBacktestResult = typeof auroraBacktestResults.$inferSelect;
export type AuroraCalendarSession = typeof auroraCalendarSessions.$inferSelect;
