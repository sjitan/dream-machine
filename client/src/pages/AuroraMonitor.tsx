import { useQuery } from '@tanstack/react-query';
import { useLocation } from 'wouter';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useTheme } from '@/hooks/use-theme';
import { useAuth } from '@/hooks/useAuth';
import { 
  Moon, Sun, LogOut, TrendingUp, TrendingDown,
  Target, RefreshCw, CheckCircle, AlertTriangle, FileText
} from 'lucide-react';
import wolfLogoUrl from "@assets/image_1765606206883.png";

interface Prediction {
  id: number;
  ticker: string;
  category: string;
  direction: 'CALL' | 'PUT';
  strike: number;
  entryPrice: number | null;
  confidence: number;
  session: string;
  engine: string;
  status: string;
  generatedAt: string;
  // Trade Plan
  entryTrigger: number | null;
  stopLoss: number | null;
  takeProfit: number | null;
  riskRewardRatio: number | null;
  reasoning: {
    engine: string;
    tpoSignal?: { bias: string; reason: string };
    technicals?: { rsi14?: number | null; vwap?: number | null; atr?: number | null };
    institutional?: { ibBreakout?: string; cvdDivergence?: boolean };
    confidence_components: Record<string, number>;
    timestamp: string;
  };
}

const formatNumber = (num: number | null | undefined): string => {
  if (num === null || num === undefined) return '--';
  return num.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};

const CONFIDENCE_THRESHOLD = 60;

export default function AuroraMonitor() {
  const [, setLocation] = useLocation();
  const { theme, setTheme } = useTheme();
  const { logout } = useAuth();

  const { data: predictions, isLoading: predictionsLoading, refetch: refetchPredictions } = useQuery<Prediction[]>({
    queryKey: ['/api/aurora/predictions'],
    refetchInterval: 30000,
  });

  const handleRefreshAll = () => {
    refetchPredictions();
  };

  const handleLogout = async () => {
    await logout();
    setLocation('/');
  };

  const latestPrediction = predictions && predictions.length > 0 ? predictions[0] : null;
  const meetsThreshold = latestPrediction && latestPrediction.confidence >= CONFIDENCE_THRESHOLD;

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-indigo-950">
      <header className="border-b border-white/10 bg-slate-900/50 backdrop-blur-lg sticky top-0 z-50">
        <div className="max-w-4xl mx-auto px-4 lg:px-8 py-3 flex items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <button 
              onClick={() => setLocation('/dreams')}
              className="flex items-center gap-3 cursor-pointer group"
              data-testid="button-nav-dreams"
            >
              <div className="w-10 h-10 rounded-lg overflow-hidden border-2 border-pink-500/50 shadow-[0_0_20px_rgba(236,72,153,0.4)] transition-transform group-hover:scale-105">
                <img src={wolfLogoUrl} alt="Go to Dreams" className="w-full h-full object-cover" />
              </div>
              <div className="text-left">
                <h1 className="text-xl font-bold text-white tracking-tight">Aurora</h1>
                <p className="text-xs text-slate-400">0DTE Predictions</p>
              </div>
            </button>
          </div>
          
          <div className="flex items-center gap-3">
            <Button
              variant="outline"
              size="sm"
              onClick={handleRefreshAll}
              data-testid="button-refresh-all"
              className="border-white/20"
            >
              <RefreshCw className="w-4 h-4 mr-2" />
              Refresh
            </Button>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
              data-testid="button-theme-toggle"
            >
              {theme === 'dark' ? <Sun className="w-5 h-5" /> : <Moon className="w-5 h-5" />}
            </Button>
            <Button
              variant="ghost"
              size="icon"
              onClick={handleLogout}
              data-testid="button-logout"
            >
              <LogOut className="w-5 h-5" />
            </Button>
          </div>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-4 lg:px-8 py-8 space-y-6">
        
        {/* CARD 1: Hero Prediction Card */}
        <Card className="bg-white/5 border-white/10 backdrop-blur-lg overflow-hidden">
          <CardHeader className="border-b border-white/10 bg-white/5">
            <CardTitle className="text-lg font-semibold text-white flex items-center gap-2">
              <Target className="w-5 h-5 text-purple-400" />
              Active Signal
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {predictionsLoading ? (
              <div className="h-64 flex items-center justify-center">
                <RefreshCw className="w-8 h-8 animate-spin text-slate-400" />
              </div>
            ) : latestPrediction ? (
              <div className="p-6 space-y-6">
                {/* Top Row: Ticker + Direction */}
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-4">
                    <span 
                      className="text-5xl font-black text-white tracking-tight"
                      data-testid="text-ticker"
                    >
                      {latestPrediction.ticker}
                    </span>
                    <Badge 
                      className={`text-2xl px-4 py-2 font-bold ${
                        latestPrediction.direction === 'CALL' 
                          ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/50' 
                          : 'bg-rose-500/20 text-rose-300 border-rose-500/50'
                      }`}
                      data-testid="badge-direction"
                    >
                      {latestPrediction.direction === 'CALL' ? (
                        <TrendingUp className="w-6 h-6 mr-2" />
                      ) : (
                        <TrendingDown className="w-6 h-6 mr-2" />
                      )}
                      {latestPrediction.direction}
                    </Badge>
                  </div>
                  <Badge 
                    variant="outline" 
                    className="border-white/20 text-slate-300 text-sm"
                    data-testid="badge-engine"
                  >
                    {latestPrediction.engine.replace('_', ' ')}
                  </Badge>
                </div>

                {/* Strike Price */}
                <div className="bg-white/5 rounded-lg p-4 border border-white/10">
                  <div className="text-slate-400 text-sm uppercase tracking-wide mb-1">Strike Price (OTM)</div>
                  <div 
                    className="text-4xl font-mono font-bold text-white"
                    data-testid="text-strike"
                  >
                    ${formatNumber(latestPrediction.strike)}
                  </div>
                </div>

                {/* Trade Plan */}
                {(latestPrediction.entryTrigger || latestPrediction.stopLoss || latestPrediction.takeProfit) && (
                  <div className="bg-white/5 rounded-lg p-4 border border-white/10">
                    <div className="text-slate-400 text-sm uppercase tracking-wide mb-3 flex items-center gap-2">
                      <Target className="w-4 h-4" />
                      Trade Plan
                      {latestPrediction.riskRewardRatio && latestPrediction.riskRewardRatio > 0 && (
                        <Badge 
                          variant="outline" 
                          className={`ml-auto text-xs ${
                            latestPrediction.riskRewardRatio >= 2 
                              ? 'border-emerald-500/50 text-emerald-300' 
                              : latestPrediction.riskRewardRatio >= 1 
                                ? 'border-amber-500/50 text-amber-300' 
                                : 'border-rose-500/50 text-rose-300'
                          }`}
                          data-testid="badge-rr-ratio"
                        >
                          R:R {latestPrediction.riskRewardRatio.toFixed(2)}
                        </Badge>
                      )}
                    </div>
                    <div className="grid grid-cols-3 gap-3">
                      <div className="text-center p-3 bg-emerald-500/10 rounded-lg border border-emerald-500/20">
                        <div className="text-emerald-400 text-xs uppercase mb-1">Entry</div>
                        <div 
                          className="text-xl font-mono font-bold text-emerald-300"
                          data-testid="text-entry-trigger"
                        >
                          ${formatNumber(latestPrediction.entryTrigger)}
                        </div>
                      </div>
                      <div className="text-center p-3 bg-blue-500/10 rounded-lg border border-blue-500/20">
                        <div className="text-blue-400 text-xs uppercase mb-1">Target</div>
                        <div 
                          className="text-xl font-mono font-bold text-blue-300"
                          data-testid="text-take-profit"
                        >
                          ${formatNumber(latestPrediction.takeProfit)}
                        </div>
                      </div>
                      <div className="text-center p-3 bg-rose-500/10 rounded-lg border border-rose-500/20">
                        <div className="text-rose-400 text-xs uppercase mb-1">Stop</div>
                        <div 
                          className="text-xl font-mono font-bold text-rose-300"
                          data-testid="text-stop-loss"
                        >
                          ${formatNumber(latestPrediction.stopLoss)}
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                {/* Confidence Level */}
                <div className="bg-white/5 rounded-lg p-4 border border-white/10">
                  <div className="flex items-center justify-between mb-3">
                    <div className="text-slate-400 text-sm uppercase tracking-wide">Confidence Level</div>
                    <div className="text-xs text-slate-500">Threshold: {CONFIDENCE_THRESHOLD}%</div>
                  </div>
                  <div className="flex items-center gap-4">
                    <div className="flex-1">
                      <div className="h-4 bg-slate-700 rounded-full overflow-hidden relative">
                        {/* Threshold marker */}
                        <div 
                          className="absolute top-0 bottom-0 w-0.5 bg-amber-400 z-10"
                          style={{ left: `${CONFIDENCE_THRESHOLD}%` }}
                        />
                        {/* Confidence bar */}
                        <div 
                          className={`h-full rounded-full transition-all duration-500 ${
                            latestPrediction.confidence >= 75 ? 'bg-emerald-500' :
                            latestPrediction.confidence >= CONFIDENCE_THRESHOLD ? 'bg-amber-500' : 'bg-rose-500'
                          }`}
                          style={{ width: `${Math.min(latestPrediction.confidence, 100)}%` }}
                        />
                      </div>
                    </div>
                    <span 
                      className={`text-3xl font-mono font-bold ${
                        latestPrediction.confidence >= CONFIDENCE_THRESHOLD ? 'text-emerald-400' : 'text-rose-400'
                      }`}
                      data-testid="text-confidence"
                    >
                      {latestPrediction.confidence.toFixed(0)}%
                    </span>
                  </div>
                </div>

                {/* Reasoning */}
                <div className="bg-white/5 rounded-lg p-4 border border-white/10">
                  <div className="text-slate-400 text-sm uppercase tracking-wide mb-3 flex items-center gap-2">
                    <FileText className="w-4 h-4" />
                    Why This Confidence
                  </div>
                  <div className="space-y-3">
                    {/* TPO Signal */}
                    {latestPrediction.reasoning.tpoSignal && (
                      <div className="flex items-start gap-3">
                        <Badge variant="outline" className="border-purple-500/50 text-purple-300 text-xs shrink-0">
                          TPO
                        </Badge>
                        <div className="text-slate-300 text-sm">
                          <span className="font-medium text-white">{latestPrediction.reasoning.tpoSignal.bias}</span>
                          {latestPrediction.reasoning.tpoSignal.reason && (
                            <span className="text-slate-400"> — {latestPrediction.reasoning.tpoSignal.reason}</span>
                          )}
                        </div>
                      </div>
                    )}

                    {/* Technicals */}
                    {latestPrediction.reasoning.technicals && (
                      <div className="flex items-start gap-3">
                        <Badge variant="outline" className="border-blue-500/50 text-blue-300 text-xs shrink-0">
                          Technical
                        </Badge>
                        <div className="text-slate-300 text-sm flex flex-wrap gap-3">
                          {latestPrediction.reasoning.technicals.rsi14 !== null && latestPrediction.reasoning.technicals.rsi14 !== undefined && (
                            <span>RSI: <span className="font-mono text-white">{latestPrediction.reasoning.technicals.rsi14.toFixed(1)}</span></span>
                          )}
                          {latestPrediction.reasoning.technicals.vwap !== null && latestPrediction.reasoning.technicals.vwap !== undefined && (
                            <span>VWAP: <span className="font-mono text-white">${latestPrediction.reasoning.technicals.vwap.toFixed(2)}</span></span>
                          )}
                          {latestPrediction.reasoning.technicals.atr !== null && latestPrediction.reasoning.technicals.atr !== undefined && (
                            <span>ATR: <span className="font-mono text-white">{latestPrediction.reasoning.technicals.atr.toFixed(2)}</span></span>
                          )}
                        </div>
                      </div>
                    )}

                    {/* Institutional */}
                    {latestPrediction.reasoning.institutional && (
                      <div className="flex items-start gap-3">
                        <Badge variant="outline" className="border-amber-500/50 text-amber-300 text-xs shrink-0">
                          Flow
                        </Badge>
                        <div className="text-slate-300 text-sm">
                          IB Breakout: <span className="font-medium text-white">{latestPrediction.reasoning.institutional.ibBreakout || 'N/A'}</span>
                          {latestPrediction.reasoning.institutional.cvdDivergence && (
                            <span className="ml-3 text-amber-400">CVD Divergence Detected</span>
                          )}
                        </div>
                      </div>
                    )}

                    {/* Confidence Components */}
                    {latestPrediction.reasoning.confidence_components && Object.keys(latestPrediction.reasoning.confidence_components).length > 0 && (
                      <div className="flex items-start gap-3">
                        <Badge variant="outline" className="border-slate-500/50 text-slate-300 text-xs shrink-0">
                          Weights
                        </Badge>
                        <div className="text-slate-400 text-xs font-mono flex flex-wrap gap-2">
                          {Object.entries(latestPrediction.reasoning.confidence_components).map(([key, value]) => (
                            <span key={key} className="bg-slate-800 px-2 py-1 rounded">
                              {key}: {typeof value === 'number' ? value.toFixed(2) : value}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                </div>

                {/* Generated timestamp */}
                <div className="text-center text-xs text-slate-500">
                  Generated: {new Date(latestPrediction.generatedAt).toLocaleString('en-US', { 
                    weekday: 'short', 
                    month: 'short', 
                    day: 'numeric',
                    hour: '2-digit', 
                    minute: '2-digit',
                    second: '2-digit'
                  })}
                </div>
              </div>
            ) : (
              <div className="h-64 flex flex-col items-center justify-center text-slate-400">
                <Target className="w-12 h-12 mb-3 opacity-50" />
                <p className="text-lg">No Active Signal</p>
                <p className="text-sm mt-1">Predictions are generated during market hours</p>
              </div>
            )}
          </CardContent>
        </Card>

        {/* CARD 2: Paper Trade Confirmation */}
        <Card className={`border backdrop-blur-lg overflow-hidden ${
          meetsThreshold 
            ? 'bg-emerald-500/10 border-emerald-500/30' 
            : 'bg-white/5 border-white/10'
        }`}>
          <CardContent className="p-6">
            {predictionsLoading ? (
              <div className="h-20 flex items-center justify-center">
                <RefreshCw className="w-6 h-6 animate-spin text-slate-400" />
              </div>
            ) : latestPrediction ? (
              <div className="flex items-center gap-4">
                {meetsThreshold ? (
                  <>
                    <div className="w-16 h-16 rounded-full bg-emerald-500/20 flex items-center justify-center shrink-0">
                      <CheckCircle className="w-10 h-10 text-emerald-400" />
                    </div>
                    <div className="flex-1">
                      <div className="text-xl font-bold text-emerald-300" data-testid="text-trade-status">
                        Paper Trade Entered
                      </div>
                      <div className="text-slate-400 mt-1">
                        Confidence of <span className="text-emerald-400 font-mono font-bold">{latestPrediction.confidence.toFixed(0)}%</span> exceeds {CONFIDENCE_THRESHOLD}% threshold
                      </div>
                      <div className="text-sm text-slate-500 mt-2">
                        {latestPrediction.ticker} {latestPrediction.direction} @ ${formatNumber(latestPrediction.strike)} strike
                      </div>
                    </div>
                    <Badge className="bg-emerald-500/20 text-emerald-300 border-emerald-500/50 text-sm px-3 py-1">
                      ACTIVE
                    </Badge>
                  </>
                ) : (
                  <>
                    <div className="w-16 h-16 rounded-full bg-slate-500/20 flex items-center justify-center shrink-0">
                      <AlertTriangle className="w-10 h-10 text-slate-400" />
                    </div>
                    <div className="flex-1">
                      <div className="text-xl font-bold text-slate-300" data-testid="text-trade-status">
                        No Trade — Below Threshold
                      </div>
                      <div className="text-slate-400 mt-1">
                        Confidence of <span className="text-rose-400 font-mono font-bold">{latestPrediction.confidence.toFixed(0)}%</span> is below {CONFIDENCE_THRESHOLD}% required
                      </div>
                      <div className="text-sm text-slate-500 mt-2">
                        Waiting for higher confidence signal...
                      </div>
                    </div>
                    <Badge variant="outline" className="border-slate-500/50 text-slate-400 text-sm px-3 py-1">
                      WATCHING
                    </Badge>
                  </>
                )}
              </div>
            ) : (
              <div className="flex items-center gap-4">
                <div className="w-16 h-16 rounded-full bg-slate-500/20 flex items-center justify-center shrink-0">
                  <Target className="w-10 h-10 text-slate-400" />
                </div>
                <div className="flex-1">
                  <div className="text-xl font-bold text-slate-400">Awaiting Signal</div>
                  <div className="text-slate-500 mt-1">
                    No predictions available — market may be closed
                  </div>
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        <div className="text-center text-xs text-slate-500 pb-4">
          Auto-refreshes every 30 seconds
        </div>
      </main>
    </div>
  );
}
