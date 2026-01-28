import type { Express, RequestHandler } from "express";
import crypto from "crypto";
import { z } from "zod";

// Simple token-based authentication
// Tokens are stored in memory (cleared on server restart)
const activeTokens = new Map<string, { username: string; createdAt: number }>();

const TOKEN_EXPIRY_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

// Rate limiting for login attempts
const loginAttempts = new Map<string, { count: number; firstAttempt: number }>();
const RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000; // 15 minutes
const MAX_LOGIN_ATTEMPTS = 5;

// Login request validation schema
export const loginSchema = z.object({
  username: z.string().min(1).max(50),
  password: z.string().min(1).max(255),
});

export function checkRateLimit(ip: string): { allowed: boolean; retryAfterMs?: number } {
  const now = Date.now();
  const attempt = loginAttempts.get(ip);
  
  if (!attempt) {
    return { allowed: true };
  }
  
  // Reset if window has passed
  if (now - attempt.firstAttempt > RATE_LIMIT_WINDOW_MS) {
    loginAttempts.delete(ip);
    return { allowed: true };
  }
  
  if (attempt.count >= MAX_LOGIN_ATTEMPTS) {
    const retryAfterMs = RATE_LIMIT_WINDOW_MS - (now - attempt.firstAttempt);
    return { allowed: false, retryAfterMs };
  }
  
  return { allowed: true };
}

export function recordLoginAttempt(ip: string, success: boolean): void {
  if (success) {
    // Clear attempts on successful login
    loginAttempts.delete(ip);
    return;
  }
  
  const now = Date.now();
  const attempt = loginAttempts.get(ip);
  
  if (!attempt || now - attempt.firstAttempt > RATE_LIMIT_WINDOW_MS) {
    loginAttempts.set(ip, { count: 1, firstAttempt: now });
  } else {
    attempt.count++;
  }
}

// Clean up old rate limit entries periodically
setInterval(() => {
  const now = Date.now();
  const keysToDelete: string[] = [];
  loginAttempts.forEach((attempt, ip) => {
    if (now - attempt.firstAttempt > RATE_LIMIT_WINDOW_MS) {
      keysToDelete.push(ip);
    }
  });
  keysToDelete.forEach(key => loginAttempts.delete(key));
}, 60 * 60 * 1000); // Clean up every hour

function generateToken(): string {
  return crypto.randomBytes(32).toString("hex");
}

function cleanExpiredTokens() {
  const now = Date.now();
  const tokensToDelete: string[] = [];
  
  activeTokens.forEach((data, token) => {
    if (now - data.createdAt > TOKEN_EXPIRY_MS) {
      tokensToDelete.push(token);
    }
  });
  
  tokensToDelete.forEach(token => activeTokens.delete(token));
}

// Clean expired tokens every hour
setInterval(cleanExpiredTokens, 60 * 60 * 1000);

export function createAuthToken(username: string): string {
  cleanExpiredTokens();
  const token = generateToken();
  activeTokens.set(token, { username, createdAt: Date.now() });
  return token;
}

export function validateToken(token: string): string | null {
  const data = activeTokens.get(token);
  if (!data) return null;
  
  if (Date.now() - data.createdAt > TOKEN_EXPIRY_MS) {
    activeTokens.delete(token);
    return null;
  }
  
  return data.username;
}

export function invalidateToken(token: string): void {
  activeTokens.delete(token);
}

export const isAuthenticated: RequestHandler = (req, res, next) => {
  const authHeader = req.headers.authorization;
  
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).json({ message: "Unauthorized" });
  }
  
  const token = authHeader.substring(7);
  const username = validateToken(token);
  
  if (!username) {
    return res.status(401).json({ message: "Unauthorized" });
  }
  
  (req as any).username = username;
  next();
};

export function setupAuth(app: Express) {
  // No session middleware needed for token-based auth
}
