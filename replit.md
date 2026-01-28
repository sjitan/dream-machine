# Wolfgang Phoenix

## Overview
Wolfgang Phoenix is a vision board and goal tracker application with an integrated 0DTE options prediction engine. Its core purpose is to provide a platform for personal financial goal setting and visualization. Users can manage dream items, track affordability using a compounding wealth strategy, and visualize aspirations through the IMAGINE slider.

## Aurora Auction Intelligence
Aurora is a predictive 0DTE options recommendation system using MIT Auction Market Theory + ORB Momentum. It generates high-confidence (60%+) OTM call/put signals for:
- **Daily 0DTE**: SPY, SPX
- **Friday 0DTE**: NVDA, TSLA, XOM, AAPL

### Aurora Architecture
- **server/aurora/time.ts** - Eastern Time utilities (MarketTime)
- **server/aurora/calendar.ts** - Holidays, half-days, weekends (MarketCalendar)
- **server/aurora/reservoir.ts** - Tradier API data ingestion
- **server/aurora/parallax.ts** - Prediction generator (3 engines: TPO+MIT, Black-Scholes, ORB)
- **server/aurora/praxis.ts** - Genetic algorithm learning loop
- **server/math/** - Pure TypeScript math kernel (TPO, technicals, institutional, Black-Scholes)

### Aurora API Endpoints
- `GET /api/aurora/status` - Market time, session, trading status
- `GET /api/aurora/predictions` - Active predictions with optional ticker filter
- `GET /api/aurora/quotes` - Live quotes for tracked tickers
- `GET /api/aurora/quote/:ticker` - Single ticker quote

### Aurora Database Tables (15 tables, prefixed with aurora_)
- Market data: candles, quotes, breadth
- Options: chains, snapshots
- TPO: profiles, statistics
- Predictions: parallax_predictions, parallax_outcomes
- Learning: praxis_generations, praxis_individuals, praxis_params
- Risk: risk_log
- Sessions: session_notes, session_archive

## User Preferences
I prefer simple language and detailed explanations when necessary. I want iterative development, with clear communication before major changes are made.

## System Architecture
Wolfgang Phoenix uses a modern full-stack JavaScript architecture:
- **Frontend**: React, TypeScript, Vite, Tailwind CSS, Shadcn/ui, TanStack Query
- **Backend**: Express.js with TypeScript
- **Database**: PostgreSQL via Neon with Drizzle ORM
- **Authentication**: Token-based with rate limiting
- **External APIs**: Tradier (market data, options chains)

## Key Features
- **Authentication**: Token-based user authentication with rate limiting
- **Dream Items**: CRUD operations for luxury goals with pricing and categories
- **IMAGINE Slider**: Visualizes dream affordability based on a compounding wealth strategy
- **Settings**: Configurable balance tracking and goal amounts
- **Aurora Monitor**: Real-time 0DTE predictions at /aurora route

## API Endpoints
- `POST /api/login` - User authentication
- `POST /api/logout` - Session termination
- `GET /api/auth/user` - Current user info
- `GET/POST/PATCH/DELETE /api/dream-items` - Dream item CRUD
- `GET/PATCH /api/settings` - User settings
- Aurora endpoints (see Aurora section above)

## External Dependencies
- **PostgreSQL (Neon)**: Primary database
- **Drizzle ORM**: TypeScript ORM for database interactions
- **TanStack Query**: Frontend data management
- **Luxon**: Date/time handling with timezone support
- **Tradier API**: Market data and options chains

## Running the Application
```bash
npm run dev
```
Starts Express + Vite development server on port 5000.

## Environment Variables
- `APP_USERNAME` - Login username (required)
- `APP_PASSWORD` - Login password (required)
- `DATABASE_URL` - PostgreSQL connection string (required)
- `TRADIER_SANDBOX_TOKEN` - Tradier API token for market data (required for Aurora)
