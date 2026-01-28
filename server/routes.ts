import type { Express } from "express";
import type { Server } from "http";
import { storage } from "./storage";
import { insertDreamItemSchema } from "@shared/schema";
import { z } from "zod";
import { setupAuth, isAuthenticated, createAuthToken, invalidateToken, checkRateLimit, recordLoginAttempt, loginSchema } from "./auth";
import { sanitizeName, sanitizeUrl } from "./sanitize";
import { MarketTime } from "./aurora/time";
import { MarketCalendar } from "./aurora/calendar";
import { getActivePredictions, getRecentPredictions } from "./aurora/parallax";
import { fetchQuote, fetchMultipleQuotes } from "./aurora/reservoir";

const VALID_USERNAME = process.env.APP_USERNAME;
const VALID_PASSWORD = process.env.APP_PASSWORD;

console.log(`[auth] Credentials loaded: username=${VALID_USERNAME ? 'SET' : 'NOT_SET'}, password=${VALID_PASSWORD ? 'SET' : 'NOT_SET'}`);

if (!VALID_USERNAME || !VALID_PASSWORD) {
  console.warn("WARNING: APP_USERNAME and/or APP_PASSWORD not set. Authentication will not work.");
}

const updateSettingsSchema = z.object({
  currentBalance: z.number().min(0).optional(),
  ultimateGoal: z.number().min(1000).optional(),
  originBalance: z.number().min(1).optional(),
});

const updateDreamItemSchema = z.object({
  name: z.string().min(1).optional(),
  cost: z.number().min(0).optional(),
  purchased: z.boolean().optional(),
  iconType: z.string().optional(),
  url: z.string().nullable().optional(),
});

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {
  
  setupAuth(app);
  
  app.post('/api/login', (req, res) => {
    const clientIp = req.ip || req.socket.remoteAddress || 'unknown';
    
    const rateLimitResult = checkRateLimit(clientIp);
    if (!rateLimitResult.allowed) {
      const retryAfterSec = Math.ceil((rateLimitResult.retryAfterMs || 0) / 1000);
      res.setHeader('Retry-After', retryAfterSec.toString());
      return res.status(429).json({ 
        message: `Too many login attempts. Try again in ${Math.ceil(retryAfterSec / 60)} minutes.` 
      });
    }
    
    const parseResult = loginSchema.safeParse(req.body);
    if (!parseResult.success) {
      return res.status(400).json({ message: "Invalid request format" });
    }
    
    const { username, password } = parseResult.data;
    
    if (username === VALID_USERNAME && password === VALID_PASSWORD) {
      recordLoginAttempt(clientIp, true);
      const token = createAuthToken(username);
      res.json({ success: true, username, token });
    } else {
      recordLoginAttempt(clientIp, false);
      res.status(401).json({ message: "Invalid username or password" });
    }
  });
  
  app.post('/api/logout', (req, res) => {
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith("Bearer ")) {
      const token = authHeader.substring(7);
      invalidateToken(token);
    }
    res.json({ success: true });
  });
  
  app.get('/api/auth/user', isAuthenticated, (req: any, res) => {
    res.json({ username: req.username });
  });

  app.get("/api/dream-items", isAuthenticated, async (req, res) => {
    try {
      const items = await storage.getDreamItems();
      res.json(items);
    } catch (error) {
      console.error("Error fetching dream items:", error);
      res.status(500).json({ error: "Failed to fetch dream items" });
    }
  });

  app.post("/api/dream-items", isAuthenticated, async (req, res) => {
    try {
      const result = insertDreamItemSchema.safeParse(req.body);
      if (!result.success) {
        return res.status(400).json({ error: "Invalid dream item data", details: result.error.issues });
      }
      
      const sanitizedData = {
        ...result.data,
        name: sanitizeName(result.data.name),
        url: result.data.url ? sanitizeUrl(result.data.url) : undefined,
      };
      
      const item = await storage.createDreamItem(sanitizedData);
      res.status(201).json(item);
    } catch (error) {
      console.error("Error creating dream item:", error);
      res.status(500).json({ error: "Failed to create dream item" });
    }
  });

  app.patch("/api/dream-items/:id", isAuthenticated, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) {
        return res.status(400).json({ error: "Invalid ID" });
      }
      
      const result = updateDreamItemSchema.safeParse(req.body);
      if (!result.success) {
        return res.status(400).json({ error: "Invalid update data", details: result.error.issues });
      }
      
      const sanitizedData = {
        ...result.data,
        name: result.data.name ? sanitizeName(result.data.name) : undefined,
        url: result.data.url ? sanitizeUrl(result.data.url) : undefined,
      };
      
      const updated = await storage.updateDreamItem(id, sanitizedData);
      if (!updated) {
        return res.status(404).json({ error: "Dream item not found" });
      }
      
      res.json(updated);
    } catch (error) {
      console.error("Error updating dream item:", error);
      res.status(500).json({ error: "Failed to update dream item" });
    }
  });

  app.delete("/api/dream-items/:id", isAuthenticated, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) {
        return res.status(400).json({ error: "Invalid ID" });
      }
      
      const deleted = await storage.deleteDreamItem(id);
      if (!deleted) {
        return res.status(404).json({ error: "Dream item not found" });
      }
      
      res.status(204).send();
    } catch (error) {
      console.error("Error deleting dream item:", error);
      res.status(500).json({ error: "Failed to delete dream item" });
    }
  });

  app.get("/api/settings", isAuthenticated, async (req, res) => {
    try {
      const settings = await storage.getSettings();
      res.json(settings || { currentBalance: 0, ultimateGoal: 348000000, originBalance: 500 });
    } catch (error) {
      console.error("Error fetching settings:", error);
      res.status(500).json({ error: "Failed to fetch settings" });
    }
  });

  app.patch("/api/settings", isAuthenticated, async (req, res) => {
    try {
      const result = updateSettingsSchema.safeParse(req.body);
      if (!result.success) {
        return res.status(400).json({ error: "Invalid settings data", details: result.error.issues });
      }
      
      const updated = await storage.updateSettings(result.data);
      res.json(updated);
    } catch (error) {
      console.error("Error updating settings:", error);
      res.status(500).json({ error: "Failed to update settings" });
    }
  });

  // Aurora API Routes
  app.get("/api/aurora/status", isAuthenticated, async (req, res) => {
    try {
      const holidays = MarketCalendar.getHolidaysSet();
      const halfDays = MarketCalendar.getHalfDaysSet();
      
      const now = MarketTime.now();
      const session = MarketTime.getSession(holidays, halfDays);
      const isTrading = MarketTime.isTradingHours(holidays, halfDays);
      const isPreMarket = MarketTime.isPreMarket(holidays);
      const todayET = MarketTime.getTodayET();
      
      res.json({
        timestamp: now.toISO(),
        todayET,
        session,
        isTrading,
        isPreMarket,
        isFriday: now.weekday === 5,
        dayType: MarketCalendar.getDayType(todayET),
      });
    } catch (error) {
      console.error("Error getting Aurora status:", error);
      res.status(500).json({ error: "Failed to get Aurora status" });
    }
  });

  app.get("/api/aurora/predictions", isAuthenticated, async (req, res) => {
    try {
      const ticker = req.query.ticker as string | undefined;
      // Return recent predictions regardless of status - so UI always shows something
      const predictions = await getRecentPredictions(ticker, 10);
      res.json(predictions);
    } catch (error) {
      console.error("Error fetching predictions:", error);
      res.status(500).json({ error: "Failed to fetch predictions" });
    }
  });

  app.get("/api/aurora/quotes", isAuthenticated, async (req, res) => {
    try {
      const tickers = ["SPY", "SPX", "NVDA", "TSLA", "XOM", "AAPL", "VIX"];
      const quotes = await fetchMultipleQuotes(tickers);
      res.json(quotes);
    } catch (error) {
      console.error("Error fetching quotes:", error);
      res.status(500).json({ error: "Failed to fetch quotes" });
    }
  });

  app.get("/api/aurora/quote/:ticker", isAuthenticated, async (req, res) => {
    try {
      const ticker = req.params.ticker.toUpperCase();
      const quote = await fetchQuote(ticker);
      if (!quote) {
        return res.status(404).json({ error: "Quote not found" });
      }
      res.json(quote);
    } catch (error) {
      console.error("Error fetching quote:", error);
      res.status(500).json({ error: "Failed to fetch quote" });
    }
  });

  return httpServer;
}
