import { useState, useEffect, useMemo } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import {
  ChevronDown, ChevronRight, ChevronLeft, Trophy, Flag, DollarSign, Sparkles, TrendingUp,
  Plus, Save, AlertCircle, CheckCircle, Eye, EyeOff, ShoppingBag, Trash2, 
  Target, Anchor, X, Edit, ExternalLink, Ban, AlertTriangle, Calendar, Gift,
  Moon, Sun, LogOut
} from 'lucide-react';
import { useLocation } from 'wouter';
import { useTheme } from '@/hooks/use-theme';
import { useAuth } from '@/hooks/useAuth';
import { motion, AnimatePresence } from 'framer-motion';
import wolfLogoUrl from "@assets/image_1765606206883.png";
import { ResizablePanelGroup, ResizablePanel, ResizableHandle } from '@/components/ui/resizable';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Slider } from '@/components/ui/slider';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from '@/components/ui/collapsible';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useToast } from '@/hooks/use-toast';
import { apiRequest, queryClient } from '@/lib/queryClient';
import type { DreamItem, UserSettings } from '@shared/schema';

const TAX_RATE = 0.60;
const NET_RATE = 1 - TAX_RATE;
const GROWTH_RATE = 1.20;
const RISK_PCT = 0.20;
const MAX_RISK = 1000000;
const HOUSES_MULTIPLIER = 2;
const DEFAULT_MULTIPLIER = 3;
const MAX_BUFFER = 500_000;

interface LocalDreamItem {
  id: number;
  name: string;
  cost: number;
  purchased: boolean;
  iconType: string;
  url?: string;
  category?: string;
}

const getAffordabilityMultiplier = (category: string): number => {
  if (category === 'HOUSES') return HOUSES_MULTIPLIER;
  return DEFAULT_MULTIPLIER;
};

const getRequiredNetForItem = (cost: number, category?: string): number => {
  const multiplier = getAffordabilityMultiplier(category || '');
  const multiplierBased = cost * multiplier;
  const capBased = cost + MAX_BUFFER;
  return Math.min(multiplierBased, capBased);
};

const formatNumber = (num: number): string => {
  return num.toLocaleString('en-US', { maximumFractionDigits: 0 });
};

const formatCurrency = (num: number): string => {
  if (num >= 1000000000) return `$${(num / 1000000000).toFixed(2)}B`;
  if (num >= 1000000) return `$${(num / 1000000).toFixed(2)}M`;
  if (num >= 1000) return `$${(num / 1000).toFixed(1)}K`;
  return `$${num.toLocaleString('en-US', { maximumFractionDigits: 0 })}`;
};

const parseNumber = (str: string): number => {
  return parseFloat(str.replace(/,/g, '')) || 0;
};

const getLiquidityEfficiency = (balance: number): { efficiency: number; tier: { label: string } } => {
  if (balance < 10000) return { efficiency: 1.0, tier: { label: 'Under $10K' } };
  if (balance < 100000) return { efficiency: 0.85, tier: { label: '$10K-$100K' } };
  if (balance < 1000000) return { efficiency: 0.70, tier: { label: '$100K-$1M' } };
  if (balance < 10000000) return { efficiency: 0.50, tier: { label: '$1M-$10M' } };
  if (balance < 100000000) return { efficiency: 0.30, tier: { label: '$10M-$100M' } };
  return { efficiency: 0.15, tier: { label: '$100M+' } };
};

const getDailyMultiplier = (dailyWins: number, balance: number = 0, profitTarget: number = 1.0, riskPct: number = RISK_PCT): number => {
  const effectiveRiskPct = balance > 0 ? Math.min(riskPct, MAX_RISK / balance) : riskPct;
  return 1 + (effectiveRiskPct * profitTarget * dailyWins);
};

const getBalanceAfterDays = (
  startBalance: number, 
  days: number, 
  dailyWins: number,
  applyFriction: boolean = true,
  profitTarget: number = 1.0,
  riskPct: number = RISK_PCT
): number => {
  if (days <= 0) return startBalance;
  let balance = startBalance;
  for (let d = 0; d < days; d++) {
    const { efficiency } = applyFriction ? getLiquidityEfficiency(balance) : { efficiency: 1 };
    const dailyMultiplier = getDailyMultiplier(dailyWins, balance, profitTarget, riskPct);
    const dailyGain = (dailyMultiplier - 1) * efficiency;
    balance = balance * (1 + dailyGain);
  }
  return balance;
};

const getDaysToGoal = (
  currentBalance: number, 
  goalBalance: number, 
  dailyWins: number,
  profitTarget: number = 1.0,
  riskPct: number = RISK_PCT
): number => {
  if (currentBalance >= goalBalance || dailyWins <= 0) return 0;
  let balance = currentBalance;
  let days = 0;
  const maxDays = 9999;
  while (balance < goalBalance && days < maxDays) {
    const { efficiency } = getLiquidityEfficiency(balance);
    const dailyMultiplier = getDailyMultiplier(dailyWins, balance, profitTarget, riskPct);
    const dailyGain = (dailyMultiplier - 1) * efficiency;
    balance = balance * (1 + dailyGain);
    days++;
  }
  return days;
};

interface SimpleDreamItem {
  id: number;
  cost: number;
  category?: string;
}

const getDaysToGoalWithPurchases = (
  currentBalance: number,
  originBalance: number,
  goalBalance: number,
  dailyWins: number,
  unpurchasedItems: SimpleDreamItem[],
  alreadyPurchasedCost: number,
  profitTarget: number = 1.0,
  riskPct: number = RISK_PCT
): number => {
  if (currentBalance >= goalBalance || dailyWins <= 0) return 0;
  
  let balance = currentBalance;
  let days = 0;
  const maxDays = 9999;
  let runningPurchaseCost = 0;
  const purchasedIds = new Set<number>();
  
  const sortedItems = [...unpurchasedItems].sort((a, b) => {
    const reqA = getRequiredNetForItem(a.cost, a.category);
    const reqB = getRequiredNetForItem(b.cost, b.category);
    return reqA - reqB;
  });
  
  while (balance < goalBalance && days < maxDays) {
    const { efficiency } = getLiquidityEfficiency(balance);
    const dailyMultiplier = getDailyMultiplier(dailyWins, balance, profitTarget, riskPct);
    const dailyGain = (dailyMultiplier - 1) * efficiency;
    balance = balance * (1 + dailyGain);
    days++;
    
    const gain = Math.max(0, balance - originBalance);
    const tax = gain * TAX_RATE;
    const netLiquid = balance - tax - alreadyPurchasedCost - runningPurchaseCost;
    
    for (const item of sortedItems) {
      if (purchasedIds.has(item.id)) continue;
      const requiredNet = getRequiredNetForItem(item.cost, item.category);
      if (requiredNet <= netLiquid) {
        purchasedIds.add(item.id);
        runningPurchaseCost += item.cost;
        balance -= item.cost;
        if (balance < 0) balance = 0;
      }
    }
  }
  
  return days;
};

// ============================================
// NYSE TRADING CALENDAR - Dynamic Holiday Calculator
// ============================================

const getNthWeekdayOfMonth = (year: number, month: number, weekday: number, n: number): Date => {
  const firstOfMonth = new Date(year, month, 1);
  const firstWeekday = firstOfMonth.getDay();
  let dayOffset = weekday - firstWeekday;
  if (dayOffset < 0) dayOffset += 7;
  const firstOccurrence = 1 + dayOffset;
  const targetDay = firstOccurrence + (n - 1) * 7;
  return new Date(year, month, targetDay);
};

const getLastWeekdayOfMonth = (year: number, month: number, weekday: number): Date => {
  const lastOfMonth = new Date(year, month + 1, 0);
  const lastDay = lastOfMonth.getDate();
  const lastDayOfWeek = lastOfMonth.getDay();
  let dayOffset = lastDayOfWeek - weekday;
  if (dayOffset < 0) dayOffset += 7;
  return new Date(year, month, lastDay - dayOffset);
};

const getEasterSunday = (year: number): Date => {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31) - 1;
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(year, month, day);
};

const getGoodFriday = (year: number): Date => {
  const easter = getEasterSunday(year);
  const goodFriday = new Date(easter);
  goodFriday.setDate(easter.getDate() - 2);
  return goodFriday;
};

const getObservedDate = (date: Date): Date => {
  const dayOfWeek = date.getDay();
  if (dayOfWeek === 0) {
    const observed = new Date(date);
    observed.setDate(date.getDate() + 1);
    return observed;
  } else if (dayOfWeek === 6) {
    const observed = new Date(date);
    observed.setDate(date.getDate() - 1);
    return observed;
  }
  return date;
};

const formatDateKey = (date: Date): string => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const getNYSEHolidaysForYear = (year: number): string[] => {
  const holidays: string[] = [];
  const newYears = getObservedDate(new Date(year, 0, 1));
  holidays.push(formatDateKey(newYears));
  const mlkDay = getNthWeekdayOfMonth(year, 0, 1, 3);
  holidays.push(formatDateKey(mlkDay));
  const presidentsDay = getNthWeekdayOfMonth(year, 1, 1, 3);
  holidays.push(formatDateKey(presidentsDay));
  const goodFriday = getGoodFriday(year);
  holidays.push(formatDateKey(goodFriday));
  const memorialDay = getLastWeekdayOfMonth(year, 4, 1);
  holidays.push(formatDateKey(memorialDay));
  const juneteenth = getObservedDate(new Date(year, 5, 19));
  holidays.push(formatDateKey(juneteenth));
  const july4th = getObservedDate(new Date(year, 6, 4));
  holidays.push(formatDateKey(july4th));
  const laborDay = getNthWeekdayOfMonth(year, 8, 1, 1);
  holidays.push(formatDateKey(laborDay));
  const thanksgiving = getNthWeekdayOfMonth(year, 10, 4, 4);
  holidays.push(formatDateKey(thanksgiving));
  const christmas = getObservedDate(new Date(year, 11, 25));
  holidays.push(formatDateKey(christmas));
  return holidays;
};

const buildNYSEHolidaySet = (): Set<string> => {
  const currentYear = new Date().getFullYear();
  const holidays = new Set<string>();
  for (let year = currentYear - 2; year <= currentYear + 15; year++) {
    getNYSEHolidaysForYear(year).forEach(h => holidays.add(h));
  }
  return holidays;
};

const NYSE_HOLIDAYS_SET = buildNYSEHolidaySet();

const isNYSETradingDay = (date: Date): boolean => {
  const dayOfWeek = date.getDay();
  if (dayOfWeek === 0 || dayOfWeek === 6) return false;
  const dateKey = formatDateKey(date);
  if (NYSE_HOLIDAYS_SET.has(dateKey)) return false;
  return true;
};

const addTradingDays = (startDate: Date, tradingDays: number): Date => {
  const result = new Date(startDate);
  let daysAdded = 0;
  while (daysAdded < tradingDays) {
    result.setDate(result.getDate() + 1);
    if (isNYSETradingDay(result)) daysAdded++;
  }
  return result;
};

const formatGoalDate = (date: Date): string => {
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
};

const getIcon = (iconType: string) => {
  const icons: Record<string, JSX.Element> = {
    car: <Target className="w-4 h-4" />,
    home: <Target className="w-4 h-4" />,
    watch: <Target className="w-4 h-4" />,
    target: <Target className="w-4 h-4" />,
  };
  return icons[iconType] || <Target className="w-4 h-4" />;
};

export default function DreamMachine() {
  const { toast } = useToast();
  const { theme, toggleTheme } = useTheme();
  const { logout } = useAuth();
  const [, setLocation] = useLocation();

  const [displayBalance, setDisplayBalance] = useState(500);
  const [dayStartBalance, setDayStartBalance] = useState(500);
  const [originBalance, setOriginBalance] = useState(500);
  const [ultimateGoal, setUltimateGoal] = useState('50000000');
  const [riskPercent, setRiskPercent] = useState(20);
  const [serverOriginBalance, setServerOriginBalance] = useState(500);
  const [serverUltimateGoal, setServerUltimateGoal] = useState(50000000);
  
  const [imagineDay, setImagineDay] = useState<number | null>(null);
  const [dailyWins, setDailyWins] = useState(1);
  const [profitTarget, setProfitTarget] = useState(1.0);
  
  const [dreamItems, setDreamItems] = useState<LocalDreamItem[]>([]);
  const [hiddenDreamIds, setHiddenDreamIds] = useState<Set<number>>(new Set());
  const [dreamSortMode, setDreamSortMode] = useState('price-asc');
  const [dreamFeedbackMode, setDreamFeedbackMode] = useState<'buyAsYouGo' | 'waitTillEnd'>('waitTillEnd');
  
  const [goalsCollapsed, setGoalsCollapsed] = useState(true);
  const [treasuryCollapsed, setTreasuryCollapsed] = useState(false);
  const [dreamBoardCollapsed, setDreamBoardCollapsed] = useState(true);
  const [calendarCollapsed, setCalendarCollapsed] = useState(true);
  const [imagineCollapsed, setImagineCollapsed] = useState(false);
  
  const [isAddingItem, setIsAddingItem] = useState(false);
  const [newItemName, setNewItemName] = useState('');
  const [newItemCategory, setNewItemCategory] = useState('CARS');
  const [newItemCost, setNewItemCost] = useState('');
  const [newItemUrl, setNewItemUrl] = useState('');
  
  const [editingItemId, setEditingItemId] = useState<number | null>(null);
  const [editingItemName, setEditingItemName] = useState('');
  const [editingItemCost, setEditingItemCost] = useState('');
  const [editingItemCategory, setEditingItemCategory] = useState('');
  const [editingItemUrl, setEditingItemUrl] = useState('');
  
  const [selectedDreamDay, setSelectedDreamDay] = useState<{ ordinal: number; tradingDay: number; calendarDate: Date; dreams: LocalDreamItem[] } | null>(null);
  const [showGoalCelebration, setShowGoalCelebration] = useState(false);
  const [goalCelebrationDate, setGoalCelebrationDate] = useState('');
  const [goalsDirty, setGoalsDirty] = useState(false);

  const today = new Date();

  const { data: settings } = useQuery<UserSettings>({
    queryKey: ['/api/settings'],
    staleTime: 0,
  });

  const { data: fetchedDreams } = useQuery<DreamItem[]>({
    queryKey: ['/api/dream-items'],
  });

  // Apply settings to local state only when not dirty (user hasn't started editing)
  useEffect(() => {
    if (settings && !goalsDirty) {
      setDisplayBalance(settings.currentBalance || 500);
      setDayStartBalance(settings.currentBalance || 500);
      setOriginBalance(settings.originBalance || 500);
      setServerOriginBalance(settings.originBalance || 500);
      setUltimateGoal(String(settings.ultimateGoal || 50000000));
      setServerUltimateGoal(settings.ultimateGoal || 50000000);
    }
  }, [settings, goalsDirty]);

  useEffect(() => {
    if (fetchedDreams) {
      setDreamItems(fetchedDreams.map(d => ({
        id: d.id,
        name: d.name,
        cost: d.cost,
        purchased: d.purchased,
        iconType: d.iconType || 'target',
        url: d.url || undefined,
        category: d.category || 'Uncategorized',
      })));
    }
  }, [fetchedDreams]);

  const updateSettingsMutation = useMutation({
    mutationFn: async (updates: Partial<UserSettings>) => {
      const res = await apiRequest('PATCH', '/api/settings', updates);
      return res.json();
    },
    onSuccess: (data: UserSettings) => {
      queryClient.setQueryData(['/api/settings'], data);
    },
  });

  const handleInputChange = (setter: (val: string) => void) => (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value.replace(/[^0-9.]/g, '');
    setter(val);
  };

  const activeDreamItems = useMemo(() => 
    dreamItems.filter(d => !hiddenDreamIds.has(d.id)),
    [dreamItems, hiddenDreamIds]
  );

  const hiddenDreamItems = useMemo(() => 
    dreamItems.filter(d => hiddenDreamIds.has(d.id)),
    [dreamItems, hiddenDreamIds]
  );

  const unpurchasedDreams = useMemo(() => 
    activeDreamItems.filter(d => !d.purchased).sort((a, b) => a.cost - b.cost),
    [activeDreamItems]
  );

  const totalDreamCosts = useMemo(() => 
    unpurchasedDreams.reduce((sum, d) => sum + d.cost, 0),
    [unpurchasedDreams]
  );

  const purchasedCosts = useMemo(() => 
    activeDreamItems.filter(d => d.purchased).reduce((sum, d) => sum + d.cost, 0),
    [activeDreamItems]
  );

  const goalAmount = parseNumber(ultimateGoal);
  const currentStep = Math.log(displayBalance / originBalance) / Math.log(GROWTH_RATE);
  const totalSteps = Math.log(goalAmount / originBalance) / Math.log(GROWTH_RATE);

  let minNetRequired = 0;
  let runningCostSum = 0;
  for (const item of unpurchasedDreams) {
    const requiredForItem = getRequiredNetForItem(item.cost, item.category);
    const constraintForItem = runningCostSum + requiredForItem;
    minNetRequired = Math.max(minNetRequired, constraintForItem);
    runningCostSum += item.cost;
  }
  const minGoalNeeded = Math.max(originBalance, (minNetRequired + purchasedCosts - TAX_RATE * originBalance) / NET_RATE);

  const taxLiability = Math.max(0, (goalAmount - originBalance) * TAX_RATE);
  const netAfterTaxes = goalAmount - taxLiability - purchasedCosts;

  let canAffordAll = true;
  let checkingNet = netAfterTaxes;
  for (const item of unpurchasedDreams) {
    const requiredForItem = getRequiredNetForItem(item.cost, item.category);
    if (checkingNet < requiredForItem) { canAffordAll = false; break; }
    checkingNet -= item.cost;
  }
  const goalCoversAll = unpurchasedDreams.length === 0 || canAffordAll;
  const hasUnsavedGoalChanges = goalAmount !== serverUltimateGoal || originBalance !== serverOriginBalance;

  const userRiskPct = riskPercent / 100;
  const currentRealBalance = displayBalance;
  const isImaginingFuture = imagineDay !== null && imagineDay > 0;
  const currentImagineDay = imagineDay ?? 0;

  const imagineBalance = isImaginingFuture 
    ? getBalanceAfterDays(currentRealBalance, currentImagineDay, dailyWins, true, profitTarget, userRiskPct)
    : displayBalance;

  const maxDaysToGoalWaitTillEnd = getDaysToGoal(currentRealBalance, goalAmount, dailyWins, profitTarget, userRiskPct);
  
  const maxDaysToGoalBuyAsYouGo = getDaysToGoalWithPurchases(
    currentRealBalance,
    originBalance,
    goalAmount,
    dailyWins,
    unpurchasedDreams.map(d => ({ id: d.id, cost: d.cost, category: d.category, purchased: d.purchased })),
    purchasedCosts,
    profitTarget,
    userRiskPct
  );
  
  const maxDaysToGoal = dreamFeedbackMode === 'buyAsYouGo' 
    ? maxDaysToGoalBuyAsYouGo 
    : maxDaysToGoalWaitTillEnd;
    
  const maxSliderDays = Math.min(maxDaysToGoal, 365);
  const daysRemainingFromImagine = isImaginingFuture 
    ? getDaysToGoal(imagineBalance, goalAmount, dailyWins, profitTarget, userRiskPct)
    : maxDaysToGoal;
  const hasValidVelocity = dailyWins > 0;
  const projectedDate = addTradingDays(new Date(), Math.min(maxDaysToGoal, 9999));
  
  const imagineStep = Math.log(imagineBalance / originBalance) / Math.log(GROWTH_RATE);
  const imagineRiskAmount = Math.min(imagineBalance * userRiskPct, MAX_RISK);
  const imagineStopLoss = imagineRiskAmount * 0.5;
  const dailyGainPct = (getDailyMultiplier(dailyWins, imagineBalance, profitTarget, userRiskPct) - 1) * 100;

  const imagineGain = Math.max(0, imagineBalance - originBalance);
  const imagineTax = imagineGain * TAX_RATE;
  const imagineNetLiquid = imagineBalance - imagineTax - purchasedCosts;

  const currentGain = Math.max(0, displayBalance - originBalance);
  const currentTax = currentGain * TAX_RATE;
  const currentNetLiquid = displayBalance - currentTax - purchasedCosts;

  const affordableNowSet = useMemo(() => {
    const set = new Set<number>();
    let remainingNet = currentNetLiquid;
    for (const item of unpurchasedDreams) {
      const requiredNet = getRequiredNetForItem(item.cost, item.category);
      if (requiredNet <= remainingNet) {
        set.add(item.id);
        remainingNet -= item.cost;
      }
    }
    return set;
  }, [unpurchasedDreams, currentNetLiquid]);

  const affordableImaginedSet = useMemo(() => {
    const set = new Set<number>();
    let remainingNet = imagineNetLiquid;
    for (const item of unpurchasedDreams) {
      const requiredNet = getRequiredNetForItem(item.cost, item.category);
      if (requiredNet <= remainingNet) {
        set.add(item.id);
        remainingNet -= item.cost;
      }
    }
    return set;
  }, [unpurchasedDreams, imagineNetLiquid]);

  const handleAddItem = async () => {
    if (!newItemName || !newItemCost) return;
    try {
      const res = await apiRequest('POST', '/api/dream-items', {
        name: newItemName,
        cost: parseFloat(newItemCost.replace(/,/g, '')),
        category: newItemCategory,
        url: newItemUrl || undefined,
        iconType: 'target',
      });
      const newItem = await res.json();
      setDreamItems(prev => [...prev, {
        id: newItem.id,
        name: newItem.name,
        cost: newItem.cost,
        purchased: newItem.purchased,
        iconType: newItem.iconType || 'target',
        url: newItem.url,
        category: newItem.category,
      }]);
      setNewItemName('');
      setNewItemCost('');
      setNewItemUrl('');
      setIsAddingItem(false);
      toast({ title: "Dream Added", description: `${newItemName} added to your dream board` });
    } catch (error) {
      toast({ title: "Error", description: "Failed to add dream", variant: "destructive" });
    }
  };

  const handleDeleteItem = async (id: number) => {
    try {
      await apiRequest('DELETE', `/api/dream-items/${id}`);
      setDreamItems(prev => prev.filter(d => d.id !== id));
      toast({ title: "Dream Removed" });
    } catch (error) {
      toast({ title: "Error", description: "Failed to delete dream", variant: "destructive" });
    }
  };

  const handlePurchaseItem = async (id: number) => {
    const item = dreamItems.find(d => d.id === id);
    if (!item) return;
    try {
      await apiRequest('PATCH', `/api/dream-items/${id}`, { purchased: !item.purchased });
      setDreamItems(prev => prev.map(d => d.id === id ? { ...d, purchased: !d.purchased } : d));
      toast({ title: item.purchased ? "Dream Unmarked" : "Dream Purchased!" });
    } catch (error) {
      toast({ title: "Error", description: "Failed to update dream", variant: "destructive" });
    }
  };

  const handleEditDreamItem = (item: LocalDreamItem) => {
    setEditingItemId(item.id);
    setEditingItemName(item.name);
    setEditingItemCost(String(item.cost));
    setEditingItemCategory(item.category || 'Uncategorized');
    setEditingItemUrl(item.url || '');
  };

  const handleSaveEditDreamItem = async () => {
    if (!editingItemId || !editingItemName || !editingItemCost) return;
    try {
      await apiRequest('PATCH', `/api/dream-items/${editingItemId}`, {
        name: editingItemName,
        cost: parseFloat(editingItemCost.replace(/,/g, '')),
        category: editingItemCategory,
        url: editingItemUrl || undefined,
      });
      setDreamItems(prev => prev.map(d => d.id === editingItemId ? {
        ...d,
        name: editingItemName,
        cost: parseFloat(editingItemCost.replace(/,/g, '')),
        category: editingItemCategory,
        url: editingItemUrl || undefined,
      } : d));
      setEditingItemId(null);
      toast({ title: "Dream Updated" });
    } catch (error) {
      toast({ title: "Error", description: "Failed to update dream", variant: "destructive" });
    }
  };

  const toggleDreamVisibility = (id: number) => {
    setHiddenDreamIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const showAllDreams = () => setHiddenDreamIds(new Set());

  const saveGoalSettings = async () => {
    try {
      const result = await updateSettingsMutation.mutateAsync({ 
        ultimateGoal: goalAmount,
        originBalance: originBalance
      });
      setServerUltimateGoal(goalAmount);
      setServerOriginBalance(originBalance);
      setGoalsDirty(false);
      queryClient.setQueryData(['/api/settings'], result);
      toast({ title: "Settings Saved", description: `Goal: ${formatCurrency(goalAmount)}, Origin: ${formatCurrency(originBalance)}` });
    } catch (error) {
      toast({ title: "Error", description: "Failed to save settings", variant: "destructive" });
    }
  };

  const calcDaysToAfford = (itemCost: number, itemCategory?: string) => {
    const requiredNet = getRequiredNetForItem(itemCost, itemCategory);
    const neededGross = (requiredNet + purchasedCosts - TAX_RATE * originBalance) / NET_RATE;
    return getDaysToGoal(currentRealBalance, neededGross, dailyWins, profitTarget, userRiskPct);
  };

  const getCategoryColor = (cat: string) => {
    const colors: Record<string, string> = {
      'CARS': 'text-blue-400',
      'HOUSES': 'text-emerald-400',
      'WATCHES': 'text-amber-400',
      'TRAVEL': 'text-purple-400',
      'JEWELRY': 'text-pink-400',
      'TECH': 'text-cyan-400',
      'SHOES': 'text-orange-400',
      'ACCESSORIES': 'text-rose-400',
      'CLOTHES': 'text-indigo-400',
      'ART': 'text-violet-400',
      'SUITS': 'text-slate-300',
      'SELF_IMPROVEMENT': 'text-teal-400',
      'GIFTS': 'text-red-400',
      'Uncategorized': 'text-muted-foreground'
    };
    return colors[cat] || 'text-muted-foreground';
  };

  let sortedItems = [...activeDreamItems];
  if (dreamSortMode === 'price-asc') sortedItems.sort((a, b) => a.cost - b.cost);
  else if (dreamSortMode === 'price-desc') sortedItems.sort((a, b) => b.cost - a.cost);

  let grouped: Record<string, LocalDreamItem[]> = {};
  if (dreamSortMode.startsWith('category')) {
    grouped = sortedItems.reduce((acc, item) => {
      const cat = item.category || 'Uncategorized';
      if (!acc[cat]) acc[cat] = [];
      acc[cat].push(item);
      return acc;
    }, {} as Record<string, LocalDreamItem[]>);
  } else {
    grouped = sortedItems.reduce((acc, item) => {
      const cat = item.category || 'Uncategorized';
      if (!acc[cat]) acc[cat] = [];
      acc[cat].push(item);
      return acc;
    }, {} as Record<string, LocalDreamItem[]>);
  }

  const totalCost = activeDreamItems.reduce((sum, item) => sum + item.cost, 0);
  const purchasedCost = activeDreamItems.filter(item => item.purchased).reduce((sum, item) => sum + item.cost, 0);
  const remainingNeeded = Math.max(0, totalCost - displayBalance);

  return (
    <div className="flex flex-col h-screen bg-background text-foreground">
      <div className="sticky top-0 z-20 bg-background/95 backdrop-blur border-b border-border/50">
        <div className="p-6 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <button 
              onClick={() => setLocation('/aurora')}
              className="h-14 w-14 rounded-xl shadow-[0_0_30px_rgba(236,72,153,0.3)] overflow-hidden border-2 border-pink-500/40 cursor-pointer transition-transform hover:scale-105"
              data-testid="button-nav-aurora"
            >
              <img src={wolfLogoUrl} alt="Go to Aurora" className="w-full h-full object-cover" />
            </button>
            <div>
              <h1 className="font-bold tracking-tight gradient-text text-2xl">Dream Machine</h1>
              <p className="text-xs text-primary font-semibold tracking-wide">Visualize Potential</p>
            </div>
          </div>
          
          {/* Motto - Centered in header */}
          <div className="flex-1 motto-container flex items-center justify-center gap-2 px-2" data-testid="header-motto">
            <span 
              className="motto-text-script font-semibold text-purple-600 dark:text-purple-400"
              style={{ 
                fontFamily: "'Dancing Script', cursive",
                fontWeight: 700
              }}
            >
              Trust the Process:
            </span>
<span 
              className="motto-text font-black uppercase"
              style={{ 
                fontFamily: "'Black Ops One', cursive",
                letterSpacing: '0.08em',
                color: '#4ADE80',
                textShadow: '1px 1px 3px rgba(0,0,0,0.3)'
              }}
              data-testid="text-take-profits"
            >
              TAKE YOUR PROFITS!
            </span>
            <span 
              className="motto-text font-black uppercase line-through decoration-2"
              style={{ 
                fontFamily: "'Black Ops One', cursive",
                letterSpacing: '0.08em',
                color: '#EF4444',
                textDecorationColor: '#EF4444',
                textShadow: '1px 1px 3px rgba(0,0,0,0.3)'
              }}
              data-testid="text-cut-losses"
            >
              CUT YOUR LOSSES
            </span>
          </div>
          
          <div className="flex items-center gap-3">
            <div className={`flex items-center rounded-lg gap-2 px-3 py-2 ${isImaginingFuture ? 'bg-primary/10 border border-primary/30' : 'bg-card/80 border border-border/50'}`} data-testid="badge-risk-compact">
              <DollarSign className={`w-4 h-4 ${isImaginingFuture ? 'text-primary' : 'text-primary'}`} />
              <div className="flex flex-col">
                <span className={`text-xs font-medium ${isImaginingFuture ? 'text-primary' : 'text-muted-foreground'}`}>Risk</span>
                <span className={`font-bold tabular-nums text-sm ${isImaginingFuture ? 'text-primary' : ''}`}>{formatCurrency(isImaginingFuture ? imagineRiskAmount : Math.min(displayBalance * (riskPercent / 100), MAX_RISK))}</span>
              </div>
            </div>

            {/* Date Box - Standalone, responds to IMAGINE slider */}
            <div className={`px-3 py-2 rounded-lg border ${isImaginingFuture ? 'bg-primary/10 border-primary/50 text-primary' : 'bg-muted/30 border-border/50'}`}>
              <div className="text-[10px] text-muted-foreground uppercase tracking-wider mb-0.5">
                {isImaginingFuture ? 'Projected' : 'Today'}
              </div>
              <div className={`text-sm font-bold tabular-nums ${isImaginingFuture ? 'text-primary' : ''}`}>
                {isImaginingFuture 
                  ? formatGoalDate(addTradingDays(new Date(), currentImagineDay))
                  : new Date().toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}
              </div>
            </div>

            <div className="flex flex-col gap-1">
              <Badge 
                variant="outline" 
                className={`text-xs justify-center ${isImaginingFuture ? 'text-primary border-primary/50 bg-primary/10' : ''}`}
              >
                Day {isImaginingFuture ? currentImagineDay : 1} / {Math.ceil(maxDaysToGoal)}
              </Badge>
              <Badge 
                variant="outline" 
                className={`text-xs tabular-nums justify-center ${isImaginingFuture ? 'text-primary border-primary/50 bg-primary/10' : ''}`}
                data-testid="badge-step-progress"
              >
                Step {(isImaginingFuture ? imagineStep : currentStep).toFixed(1)} / {totalSteps.toFixed(0)}
              </Badge>
            </div>

            <Button
              variant="ghost"
              size="icon"
              onClick={toggleTheme}
              className="text-muted-foreground hover:text-foreground hover:bg-muted/50"
              data-testid="button-theme-toggle"
            >
              {theme === 'dark' ? <Sun className="w-5 h-5" /> : <Moon className="w-5 h-5" />}
            </Button>
            <Button
              variant="outline"
              size="icon"
              onClick={logout}
              className="text-red-400 border-red-500/30 bg-red-500/10 hover:bg-red-500/20"
              data-testid="button-logout"
            >
              <LogOut className="w-4 h-4" />
            </Button>
          </div>
        </div>
      </div>

      <ResizablePanelGroup direction="horizontal" className="flex-1 overflow-hidden">
        <ResizablePanel defaultSize={50} minSize={30}>
          <ScrollArea className="h-full">
            <div className="p-4 space-y-4">
              <Card data-testid="card-goals">
                <div 
                  className="bg-muted/20 px-6 py-3 border-b border-border/30 cursor-pointer" 
                  onClick={() => setGoalsCollapsed(prev => !prev)}
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <Button variant="ghost" size="icon" className="h-6 w-6 p-0" data-testid="button-collapse-goals">
                        {goalsCollapsed ? <ChevronRight className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
                      </Button>
                      <Flag className="w-4 h-4 text-primary" />
                      <h2 className="text-sm font-bold text-primary uppercase tracking-widest">Goals</h2>
                    </div>
                    {hasUnsavedGoalChanges && (
                      <Button 
                        size="sm" 
                        variant="default" 
                        onClick={(e) => { e.stopPropagation(); saveGoalSettings(); }} 
                        className="gap-1.5" 
                        data-testid="button-save-goals"
                      >
                        <Save className="w-3 h-3" />
                        Save Changes
                      </Button>
                    )}
                  </div>
                </div>

                {!goalsCollapsed && (
                  <>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-px bg-border/30">
                      <div className="bg-card p-4">
                        <label className="flex items-center gap-2 text-xs font-bold text-primary uppercase tracking-widest mb-1">
                          <TrendingUp className="w-3 h-3" /> Current Balance
                        </label>
                        <div className="flex items-center">
                          <span className="text-primary text-2xl font-bold">$</span>
                          <span className="text-2xl font-bold tabular-nums text-primary" data-testid="text-current-balance">
                            {formatNumber(displayBalance)}
                          </span>
                        </div>
                      </div>

                      <div className="bg-card p-4 border-l border-border/30">
                        <label className="flex items-center gap-2 text-xs font-bold text-muted-foreground uppercase tracking-widest mb-1">
                          <Flag className="w-3 h-3" /> Day's Starting Balance
                        </label>
                        <div className="flex items-center">
                          <span className="text-muted-foreground text-2xl font-bold">$</span>
                          <span className="text-2xl font-bold tabular-nums" data-testid="text-day-start-balance">
                            {formatNumber(dayStartBalance)}
                          </span>
                        </div>
                      </div>

                      <div className="bg-card p-4 group focus-within:bg-muted/30 transition-colors border-l border-border/30">
                        <div className="flex items-center justify-between mb-1">
                          <label className="flex items-center gap-2 text-xs font-bold text-muted-foreground uppercase tracking-widest">
                            <Trophy className="w-3 h-3 text-yellow-500" /> Ultimate Goal
                            {goalCoversAll && goalAmount > 0 && <CheckCircle className="w-3 h-3 text-win" />}
                          </label>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="text-primary text-2xl font-bold">$</span>
                          <input
                            type="text"
                            inputMode="decimal"
                            value={ultimateGoal}
                            onChange={(e) => {
                              const val = e.target.value.replace(/[^0-9.]/g, '');
                              setUltimateGoal(val);
                              setGoalsDirty(true);
                            }}
                            className="text-2xl font-bold tabular-nums bg-transparent border-none outline-none flex-1 text-primary"
                            data-testid="input-ultimate-goal"
                          />
                        </div>
                        {unpurchasedDreams.length > 0 && (
                          <div className={`mt-2 text-xs flex items-center gap-1.5 ${goalCoversAll ? 'text-muted-foreground' : 'text-loss font-semibold'}`}>
                            <span>Min:</span>
                            <span className="tabular-nums" data-testid="text-min-goal">${formatNumber(Math.ceil(minGoalNeeded))}</span>
                            {!goalCoversAll && goalAmount > 0 && (
                              <span className="text-loss/70">(need +${formatNumber(Math.ceil(minGoalNeeded - goalAmount))})</span>
                            )}
                          </div>
                        )}
                      </div>
                    </div>

                    <div className="bg-muted/10 px-6 py-3 border-b border-border/30">
                      <div className="flex items-center justify-between">
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <div className="flex items-center gap-2 cursor-help">
                              <Anchor className="w-4 h-4 text-muted-foreground" />
                              <span className="text-sm font-bold text-muted-foreground uppercase tracking-widest">Origin Balance</span>
                            </div>
                          </TooltipTrigger>
                          <TooltipContent className="max-w-xs">
                            <p className="text-xs">Your Day 0 starting point for all step calculations.</p>
                          </TooltipContent>
                        </Tooltip>
                        <div className="flex items-center gap-2">
                          <span className="text-muted-foreground text-lg font-bold">$</span>
                          <input
                            type="text"
                            inputMode="decimal"
                            value={formatNumber(originBalance)}
                            onChange={(e) => {
                              const val = parseNumber(e.target.value.replace(/[^0-9.]/g, ''));
                              if (val > 0) {
                                setOriginBalance(val);
                                setGoalsDirty(true);
                              }
                            }}
                            className="text-lg font-bold tabular-nums bg-transparent border-none outline-none w-24 text-right text-muted-foreground focus:text-primary transition-colors"
                            data-testid="input-origin-balance"
                          />
                        </div>
                      </div>
                    </div>
                  </>
                )}
              </Card>

              <Card data-testid="card-imagine" className={`animate-fade-in ${isImaginingFuture ? 'ring-1 ring-primary/30' : ''}`}>
                <div 
                  className="bg-muted/20 px-6 py-3 border-b border-border/30 cursor-pointer" 
                  onClick={() => setImagineCollapsed(prev => !prev)}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Button variant="ghost" size="icon" className="h-6 w-6 p-0" data-testid="button-collapse-imagine">
                        {imagineCollapsed ? <ChevronRight className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
                      </Button>
                      <Sparkles className="w-4 h-4 text-primary" />
                      <h2 className="text-sm font-bold text-primary uppercase tracking-widest">IMAGINE</h2>
                    </div>
                    {isImaginingFuture && (
                      <Button size="sm" variant="ghost" onClick={(e) => { e.stopPropagation(); setImagineDay(0); }} className="text-xs h-6">
                        Reset
                      </Button>
                    )}
                  </div>
                </div>

                {!imagineCollapsed && (
                  <CardContent className="p-4 space-y-4">
                    <div className="mb-4">
                      <div className="flex justify-between items-center mb-2">
                        <span className="text-xs text-muted-foreground">Day</span>
                        <span className={`text-sm font-bold tabular-nums ${isImaginingFuture ? 'text-primary' : ''}`}>
                          {currentImagineDay === 0 ? 'Today' : `Day ${currentImagineDay}`}
                        </span>
                      </div>
                      <Slider
                        value={[currentImagineDay]}
                        min={0}
                        max={Math.max(1, maxSliderDays)}
                        step={1}
                        onValueChange={(val) => setImagineDay(val[0])}
                        data-testid="slider-imagine-day"
                      />
                    </div>

                    <div className="mb-4 p-3 rounded bg-card/30 border border-border/20">
                      <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center gap-2">
                          <TrendingUp className="w-3 h-3 text-muted-foreground" />
                          <span className="text-xs text-muted-foreground">Daily Wins</span>
                        </div>
                        <span className={`text-xs font-mono tabular-nums ${dailyWins !== 1 ? 'text-primary font-bold' : ''}`}>
                          {dailyWins.toFixed(1)} wins = +{dailyGainPct.toFixed(0)}%/day
                        </span>
                      </div>
                      <Slider
                        value={[dailyWins]}
                        min={0.5}
                        max={3}
                        step={0.5}
                        onValueChange={(val) => setDailyWins(val[0])}
                        className="opacity-80"
                        data-testid="slider-trades-per-day"
                      />
                      <div className="flex justify-between text-xs text-muted-foreground mt-1">
                        <span>0.5</span><span>1</span><span>1.5</span><span>2</span><span>2.5</span><span>3</span>
                      </div>
                    </div>

                    <div className="mb-4 p-3 rounded bg-card/30 border border-border/20">
                      <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center gap-2">
                          <Target className="w-3 h-3 text-muted-foreground" />
                          <span className="text-xs text-muted-foreground">Profit Target</span>
                        </div>
                        <span className={`text-xs font-mono tabular-nums ${profitTarget !== 1.0 ? 'text-primary font-bold' : ''}`}>
                          {(profitTarget * 100).toFixed(0)}% ROI
                        </span>
                      </div>
                      <Slider
                        value={[profitTarget]}
                        min={0.25}
                        max={2.0}
                        step={0.25}
                        onValueChange={(val) => setProfitTarget(val[0])}
                        className="opacity-80"
                        data-testid="slider-profit-target"
                      />
                      <div className="flex justify-between text-xs text-muted-foreground mt-1">
                        <span>25%</span><span>50%</span><span>75%</span><span className="font-bold">100%</span><span>125%</span><span>150%</span><span>175%</span><span>200%</span>
                      </div>
                    </div>

                    <div className="grid grid-cols-4 gap-3">
                      <div className="text-center p-2 rounded bg-card/50">
                        <div className="text-xs text-muted-foreground mb-1">Balance</div>
                        <div className={`text-lg font-bold tabular-nums ${isImaginingFuture ? 'text-primary' : ''}`}>
                          {formatCurrency(imagineBalance)}
                        </div>
                        <div className="text-xs text-muted-foreground">~Step {imagineStep.toFixed(1)}</div>
                      </div>
                      <div className="text-center p-2 rounded bg-card/50">
                        <div className="text-xs text-muted-foreground mb-1">{riskPercent}% Risk</div>
                        <div className={`text-lg font-bold tabular-nums ${isImaginingFuture ? 'text-foreground' : ''}`}>
                          {formatCurrency(imagineRiskAmount)}
                        </div>
                      </div>
                      <div className="text-center p-2 rounded bg-card/50">
                        <div className="text-xs text-muted-foreground mb-1">Stop Loss</div>
                        <div className={`text-lg font-bold tabular-nums ${isImaginingFuture ? 'text-destructive' : ''}`}>
                          -{formatCurrency(imagineStopLoss)}
                        </div>
                      </div>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <div className="text-center p-2 rounded bg-card/50 cursor-help">
                            <div className="text-xs text-muted-foreground mb-1">Days to Goal</div>
                            <div className={`text-lg font-bold tabular-nums ${hasValidVelocity ? 'text-primary' : ''}`}>
                              {daysRemainingFromImagine <= 0 
                                ? <span className="text-win">Goal!</span>
                                : hasValidVelocity 
                                  ? `${daysRemainingFromImagine.toLocaleString()}`
                                  : <span className="text-muted-foreground text-sm">Set velocity</span>
                              }
                            </div>
                            {daysRemainingFromImagine > 0 && hasValidVelocity && (
                              <div className="text-xs text-muted-foreground mt-1">{formatGoalDate(projectedDate)}</div>
                            )}
                          </div>
                        </TooltipTrigger>
                        <TooltipContent className="max-w-xs">
                          <p className="text-xs">
                            {daysRemainingFromImagine.toLocaleString()} trading days remaining.
                            Daily gain: +{dailyGainPct.toFixed(0)}% ({dailyWins} wins × {riskPercent}% additive).
                          </p>
                        </TooltipContent>
                      </Tooltip>
                    </div>
                  </CardContent>
                )}
              </Card>
            </div>
          </ScrollArea>
        </ResizablePanel>

        <ResizableHandle withHandle />

        <ResizablePanel defaultSize={50} minSize={30}>
          <ScrollArea className="h-full">
            <div className="p-4 space-y-4">
              <Card className={`animate-fade-in ${isImaginingFuture ? 'ring-1 ring-primary/30' : ''}`} data-testid="card-treasury">
                <CardHeader className="pb-3 cursor-pointer" onClick={() => setTreasuryCollapsed(prev => !prev)}>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Button variant="ghost" size="icon" className="h-6 w-6 p-0" data-testid="button-collapse-treasury">
                        {treasuryCollapsed ? <ChevronRight className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
                      </Button>
                      <DollarSign className="w-4 h-4 text-primary" />
                      <h3 className="text-xs font-bold text-foreground uppercase tracking-widest">Treasury</h3>
                    </div>
                    {isImaginingFuture && (
                      <Badge variant="outline" className="text-xs text-primary border-primary/30">
                        <Sparkles className="w-3 h-3 mr-1" />
                        Imagined
                      </Badge>
                    )}
                  </div>
                </CardHeader>
                {!treasuryCollapsed && (
                  <CardContent className="space-y-2">
                    <div className={`p-2 rounded-lg border ${isImaginingFuture ? 'bg-primary/10 border-primary/30' : 'bg-muted/30 border-border/50'}`}>
                      <div className="text-xs text-muted-foreground font-bold uppercase mb-0.5">Gross Balance</div>
                      <div className={`text-2xl font-bold tabular-nums ${isImaginingFuture ? 'text-primary' : ''}`} data-testid="text-gross-balance">
                        {formatCurrency(isImaginingFuture ? imagineBalance : displayBalance)}
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <div className="p-2 rounded-lg bg-loss/10 border border-loss/20">
                        <div className="text-xs text-loss font-bold uppercase mb-0.5">Tax Reserve</div>
                        <div className="text-lg font-bold text-loss tabular-nums" data-testid="text-tax-reserve">
                          {formatCurrency(isImaginingFuture ? imagineTax : currentTax)}
                        </div>
                        <div className="text-xs text-muted-foreground mt-0.5">60%</div>
                      </div>
                      <div className="p-2 rounded-lg bg-win/10 border border-win/20">
                        <div className="text-xs text-win font-bold uppercase mb-0.5">Net Liquid</div>
                        <div className="text-lg font-bold text-win tabular-nums" data-testid="text-net-liquid">
                          {formatCurrency(isImaginingFuture ? imagineNetLiquid : currentNetLiquid)}
                        </div>
                        <div className="text-xs text-muted-foreground mt-0.5">Spendable</div>
                      </div>
                    </div>
                  </CardContent>
                )}
              </Card>

              {!isImaginingFuture && (() => {
                const rawSliderDay = Math.max(0, imagineDay ?? 0);
                const isSliderMoved = rawSliderDay > 0;
                
                const giftDays = new Set<number>();
                const giftDayDetails = new Map<number, number[]>();
                
                if (dreamFeedbackMode === 'buyAsYouGo') {
                  let runningPurchaseCost = 0;
                  const purchasedIds = new Set<number>();
                  
                  for (let day = 1; day <= maxDaysToGoal; day++) {
                    const dayBalance = getBalanceAfterDays(displayBalance, day, dailyWins, true, profitTarget, userRiskPct);
                    const dayGain = Math.max(0, dayBalance - originBalance);
                    const dayTax = dayGain * TAX_RATE;
                    const availableNetLiquid = dayBalance - dayTax - purchasedCosts - runningPurchaseCost;
                    
                    for (const item of unpurchasedDreams) {
                      if (purchasedIds.has(item.id)) continue;
                      const requiredNet = getRequiredNetForItem(item.cost, item.category);
                      if (requiredNet <= availableNetLiquid) {
                        giftDays.add(day);
                        if (!giftDayDetails.has(day)) giftDayDetails.set(day, []);
                        giftDayDetails.get(day)!.push(item.id);
                        purchasedIds.add(item.id);
                        runningPurchaseCost += item.cost;
                      }
                    }
                  }
                } else {
                  for (const item of unpurchasedDreams) {
                    const daysToAffordItem = calcDaysToAfford(item.cost, item.category);
                    if (daysToAffordItem > 0 && daysToAffordItem <= maxDaysToGoal) {
                      giftDays.add(daysToAffordItem);
                      if (!giftDayDetails.has(daysToAffordItem)) giftDayDetails.set(daysToAffordItem, []);
                      giftDayDetails.get(daysToAffordItem)!.push(item.id);
                    }
                  }
                }
                
                if (dreamFeedbackMode === 'buyAsYouGo') {
                  let runningPurchaseCost = 0;
                  const purchasedIds = new Set<number>();
                  
                  for (let day = 1; day <= maxDaysToGoal; day++) {
                    const dayBalance = getBalanceAfterDays(displayBalance, day, dailyWins, true, profitTarget, userRiskPct);
                    const dayGain = Math.max(0, dayBalance - originBalance);
                    const dayTax = dayGain * TAX_RATE;
                    const availableNetLiquid = dayBalance - dayTax - purchasedCosts - runningPurchaseCost;
                    
                    for (const item of unpurchasedDreams) {
                      if (purchasedIds.has(item.id)) continue;
                      const requiredNet = getRequiredNetForItem(item.cost, item.category);
                      if (requiredNet <= availableNetLiquid) {
                        giftDays.add(day);
                        if (!giftDayDetails.has(day)) giftDayDetails.set(day, []);
                        giftDayDetails.get(day)!.push(item.id);
                        purchasedIds.add(item.id);
                        runningPurchaseCost += item.cost;
                      }
                    }
                  }
                } else {
                  for (const item of unpurchasedDreams) {
                    const daysToAffordItem = calcDaysToAfford(item.cost, item.category);
                    if (daysToAffordItem > 0 && daysToAffordItem <= maxDaysToGoal) {
                      giftDays.add(daysToAffordItem);
                      if (!giftDayDetails.has(daysToAffordItem)) giftDayDetails.set(daysToAffordItem, []);
                      giftDayDetails.get(daysToAffordItem)!.push(item.id);
                    }
                  }
                }
                
                const sortedGiftDays = Array.from(giftDays).sort((a, b) => a - b);
                
                const maxTradingDaysDisplayed = 500;
                const daysNotShown = Math.max(0, maxDaysToGoal - maxTradingDaysDisplayed);
                const tradingDaysToShow = Math.min(maxDaysToGoal, maxTradingDaysDisplayed);
                
                const goalDateForCalendar = addTradingDays(today, tradingDaysToShow);
                const calendarEndDate = new Date(goalDateForCalendar);
                
                const calendarWeeks: { date: Date; isTrading: boolean; isSimulated: boolean; dayNum: number; isGiftDay: boolean; isGoalDay: boolean }[][] = [];
                
                let tradingDayCount = 0;
                let goalDayMarked = false;
                let passedGoalDay = false;
                let currentDate = new Date(today);
                let currentWeek: { date: Date; isTrading: boolean; isSimulated: boolean; dayNum: number; isGiftDay: boolean; isGoalDay: boolean }[] = [];
                
                const startDayOfWeek = currentDate.getDay();
                for (let i = 0; i < startDayOfWeek; i++) {
                  const prevDate = new Date(currentDate);
                  prevDate.setDate(prevDate.getDate() - (startDayOfWeek - i));
                  currentWeek.push({ date: prevDate, isTrading: false, isSimulated: false, dayNum: 0, isGiftDay: false, isGoalDay: false });
                }
                
                let currentCalendarDate = new Date(currentDate);
                while (currentCalendarDate <= calendarEndDate) {
                  const thisDate = new Date(currentCalendarDate);
                  const dayOfWeek = thisDate.getDay();
                  const isTradingDay = isNYSETradingDay(thisDate);
                  const isBeforeOrAtGoal = tradingDayCount < tradingDaysToShow;
                  
                  if (isTradingDay && isBeforeOrAtGoal) {
                    tradingDayCount++;
                  } else if (isTradingDay && tradingDayCount >= tradingDaysToShow) {
                    passedGoalDay = true;
                  }
                  
                  const sliderDay = Math.min(rawSliderDay, tradingDaysToShow);
                  const shouldHighlight = isSliderMoved && isTradingDay && tradingDayCount <= sliderDay && tradingDayCount > 0 && !passedGoalDay;
                  const isGiftDay = isTradingDay && tradingDayCount > 0 && giftDays.has(tradingDayCount) && !passedGoalDay;
                  const isGoalDay = isTradingDay && tradingDayCount === tradingDaysToShow && daysNotShown === 0 && !goalDayMarked;
                  if (isGoalDay) goalDayMarked = true;
                  
                  currentWeek.push({
                    date: thisDate,
                    isTrading: isTradingDay,
                    isSimulated: shouldHighlight,
                    dayNum: isTradingDay && tradingDayCount > 0 ? tradingDayCount : 0,
                    isGiftDay,
                    isGoalDay
                  });
                  
                  if (dayOfWeek === 6) {
                    calendarWeeks.push(currentWeek);
                    currentWeek = [];
                  }
                  currentCalendarDate.setDate(currentCalendarDate.getDate() + 1);
                }
                
                if (currentWeek.length > 0) {
                  while (currentWeek.length < 7) {
                    const lastDate = currentWeek[currentWeek.length - 1]?.date || new Date();
                    const nextDate = new Date(lastDate);
                    nextDate.setDate(nextDate.getDate() + 1);
                    currentWeek.push({ date: nextDate, isTrading: false, isSimulated: false, dayNum: 0, isGiftDay: false, isGoalDay: false });
                  }
                  calendarWeeks.push(currentWeek);
                }
                
                let lastLabeledMonth = -1;
                
                return calendarWeeks.length > 0 ? (
                  <Card data-testid="card-calendar" className="animate-fade-in">
                    <CardHeader className="pb-3 cursor-pointer" onClick={() => setCalendarCollapsed(prev => !prev)}>
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <Button variant="ghost" size="icon" className="h-6 w-6 p-0" data-testid="button-collapse-calendar">
                            {calendarCollapsed ? <ChevronRight className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
                          </Button>
                          <Calendar className="w-4 h-4 text-primary" />
                          <h3 className="text-xs font-bold text-foreground uppercase tracking-widest">Upcoming Trading Days</h3>
                        </div>
                      </div>
                    </CardHeader>
                    {!calendarCollapsed && (
                      <CardContent className="space-y-4">
                        <div className="grid grid-cols-5 gap-1.5 mb-2">
                          {['Mon', 'Tue', 'Wed', 'Thu', 'Fri'].map((day, i) => (
                            <div key={i} className="text-xs text-center font-semibold text-muted-foreground py-1">
                              {day}
                            </div>
                          ))}
                        </div>
                        {giftDays.size > 0 && (
                          <div className="text-xs text-purple-400 text-center">
                            {giftDays.size} Dream Day{giftDays.size !== 1 ? 's' : ''} (purple)
                          </div>
                        )}
                        <div className="max-h-[300px] overflow-y-auto scrollbar-thin">
                          {calendarWeeks.map((week, weekIdx) => {
                            const firstOfMonthDay = week.find(d => d.date.getDate() === 1 && d.date.getMonth() !== lastLabeledMonth);
                            const showMonthLabel = weekIdx === 0 || firstOfMonthDay;
                            
                            let monthToLabel: Date | null = null;
                            if (weekIdx === 0) {
                              monthToLabel = today;
                              lastLabeledMonth = today.getMonth();
                            } else if (firstOfMonthDay) {
                              monthToLabel = firstOfMonthDay.date;
                              lastLabeledMonth = firstOfMonthDay.date.getMonth();
                            }
                            
                            return (
                              <div key={weekIdx}>
                                {showMonthLabel && monthToLabel && (
                                  <div className="sticky top-0 z-10 text-sm font-semibold text-primary py-2 px-2 bg-background/95 backdrop-blur border-b border-border/50 mb-2 mt-3 first:mt-0">
                                    {monthToLabel.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}
                                  </div>
                                )}
                                <div className="grid grid-cols-5 gap-1.5 mb-1">
                                  {week.filter(d => {
                                    const dow = d.date.getDay();
                                    return dow >= 1 && dow <= 5;
                                  }).map((day, dayIdx) => {
                                    const isToday = day.date.toDateString() === today.toDateString();
                                    const isPast = day.date < today;
                                    
                                    let dayClasses = 'min-h-[32px] px-1 py-1.5 text-xs leading-tight text-center rounded-md flex items-center justify-center ';
                                    let dayTitle = '';
                                    
                                    if (isPast) {
                                      dayClasses += 'text-muted-foreground/30 bg-muted/20';
                                    } else if (day.isGoalDay) {
                                      dayClasses += 'bg-yellow-500 text-yellow-950 font-bold ring-2 ring-yellow-400 cursor-pointer hover:bg-yellow-400';
                                      dayTitle = `GOAL DAY - Day ${day.dayNum}`;
                                    } else if (day.isGiftDay) {
                                      dayClasses += 'bg-purple-600 text-white font-semibold cursor-pointer hover:bg-purple-500';
                                      if (day.isSimulated) dayClasses += ' ring-2 ring-win';
                                      dayTitle = `Dream Day ${sortedGiftDays.indexOf(day.dayNum) + 1}`;
                                    } else if (day.isSimulated) {
                                      dayClasses += 'bg-win/30 text-win font-semibold';
                                      dayTitle = `Day ${day.dayNum}`;
                                    } else if (day.isTrading) {
                                      dayClasses += 'font-medium text-foreground bg-muted/30';
                                      dayTitle = `Day ${day.dayNum}`;
                                    } else {
                                      dayClasses += 'text-muted-foreground/40 bg-muted/10';
                                    }
                                    
                                    if (isToday && !day.isGoalDay) {
                                      dayClasses += ' ring-1 ring-primary ring-offset-1 font-bold';
                                    }
                                    
                                    return (
                                      <div 
                                        key={dayIdx}
                                        className={dayClasses}
                                        title={dayTitle}
                                        onClick={day.isGoalDay ? () => {
                                          const goalDateStr = day.date.toLocaleDateString('en-US', { 
                                            weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' 
                                          });
                                          setGoalCelebrationDate(goalDateStr);
                                          setShowGoalCelebration(true);
                                        } : day.isGiftDay ? () => {
                                          const dreamIdsOnDay = giftDayDetails.get(day.dayNum) || [];
                                          const dreamsOnDay = activeDreamItems.filter(item => dreamIdsOnDay.includes(item.id));
                                          if (dreamsOnDay.length > 0) {
                                            const ordinal = sortedGiftDays.indexOf(day.dayNum) + 1;
                                            setSelectedDreamDay({ 
                                              ordinal,
                                              tradingDay: day.dayNum, 
                                              calendarDate: day.date,
                                              dreams: dreamsOnDay 
                                            });
                                          }
                                        } : undefined}
                                        data-testid={day.isGoalDay ? `calendar-goal-day-${day.dayNum}` : day.isGiftDay ? `calendar-dream-day-${day.dayNum}` : undefined}
                                      >
                                        {day.date.getDate()}
                                      </div>
                                    );
                                  })}
                                </div>
                              </div>
                            );
                          })}
                          {daysNotShown > 0 && (
                            <div className="text-xs text-muted-foreground text-center py-2 mt-2 border-t border-border/30">
                              +{daysNotShown.toLocaleString()} more trading days to goal
                            </div>
                          )}
                        </div>
                      </CardContent>
                    )}
                  </Card>
                ) : null;
              })()}

              {isImaginingFuture && (() => {
                const rawSliderDay = Math.max(0, imagineDay ?? 0);
                const isSliderMoved = rawSliderDay > 0;
                
                const giftDays = new Set<number>();
                const giftDayDetails = new Map<number, number[]>();
                
                if (dreamFeedbackMode === 'buyAsYouGo') {
                  let runningPurchaseCost = 0;
                  const purchasedIds = new Set<number>();
                  
                  for (let day = 1; day <= maxDaysToGoal; day++) {
                    const dayBalance = getBalanceAfterDays(displayBalance, day, dailyWins, true, profitTarget, userRiskPct);
                    const dayGain = Math.max(0, dayBalance - originBalance);
                    const dayTax = dayGain * TAX_RATE;
                    const availableNetLiquid = dayBalance - dayTax - purchasedCosts - runningPurchaseCost;
                    
                    for (const item of unpurchasedDreams) {
                      if (purchasedIds.has(item.id)) continue;
                      const requiredNet = getRequiredNetForItem(item.cost, item.category);
                      if (requiredNet <= availableNetLiquid) {
                        giftDays.add(day);
                        if (!giftDayDetails.has(day)) giftDayDetails.set(day, []);
                        giftDayDetails.get(day)!.push(item.id);
                        purchasedIds.add(item.id);
                        runningPurchaseCost += item.cost;
                      }
                    }
                  }
                } else {
                  for (const item of unpurchasedDreams) {
                    const daysToAffordItem = calcDaysToAfford(item.cost, item.category);
                    if (daysToAffordItem > 0 && daysToAffordItem <= maxDaysToGoal) {
                      giftDays.add(daysToAffordItem);
                      if (!giftDayDetails.has(daysToAffordItem)) giftDayDetails.set(daysToAffordItem, []);
                      giftDayDetails.get(daysToAffordItem)!.push(item.id);
                    }
                  }
                }
                
                if (dreamFeedbackMode === 'buyAsYouGo') {
                  let runningPurchaseCost = 0;
                  const purchasedIds = new Set<number>();
                  
                  for (let day = 1; day <= maxDaysToGoal; day++) {
                    const dayBalance = getBalanceAfterDays(displayBalance, day, dailyWins, true, profitTarget, userRiskPct);
                    const dayGain = Math.max(0, dayBalance - originBalance);
                    const dayTax = dayGain * TAX_RATE;
                    const availableNetLiquid = dayBalance - dayTax - purchasedCosts - runningPurchaseCost;
                    
                    for (const item of unpurchasedDreams) {
                      if (purchasedIds.has(item.id)) continue;
                      const requiredNet = getRequiredNetForItem(item.cost, item.category);
                      if (requiredNet <= availableNetLiquid) {
                        giftDays.add(day);
                        if (!giftDayDetails.has(day)) giftDayDetails.set(day, []);
                        giftDayDetails.get(day)!.push(item.id);
                        purchasedIds.add(item.id);
                        runningPurchaseCost += item.cost;
                      }
                    }
                  }
                } else {
                  for (const item of unpurchasedDreams) {
                    const daysToAffordItem = calcDaysToAfford(item.cost, item.category);
                    if (daysToAffordItem > 0 && daysToAffordItem <= maxDaysToGoal) {
                      giftDays.add(daysToAffordItem);
                      if (!giftDayDetails.has(daysToAffordItem)) giftDayDetails.set(daysToAffordItem, []);
                      giftDayDetails.get(daysToAffordItem)!.push(item.id);
                    }
                  }
                }
                
                const sortedGiftDays = Array.from(giftDays).sort((a, b) => a - b);
                
                const maxTradingDaysDisplayed = 500;
                const daysNotShown = Math.max(0, maxDaysToGoal - maxTradingDaysDisplayed);
                const tradingDaysToShow = Math.min(maxDaysToGoal, maxTradingDaysDisplayed);
                
                const goalDateForCalendar = addTradingDays(today, tradingDaysToShow);
                const calendarEndDate = new Date(goalDateForCalendar);
                
                const calendarWeeks: { date: Date; isTrading: boolean; isSimulated: boolean; dayNum: number; isGiftDay: boolean; isGoalDay: boolean }[][] = [];
                
                let tradingDayCount = 0;
                let goalDayMarked = false;
                let passedGoalDay = false;
                let currentDate = new Date(today);
                let currentWeek: { date: Date; isTrading: boolean; isSimulated: boolean; dayNum: number; isGiftDay: boolean; isGoalDay: boolean }[] = [];
                
                const startDayOfWeek = currentDate.getDay();
                for (let i = 0; i < startDayOfWeek; i++) {
                  const prevDate = new Date(currentDate);
                  prevDate.setDate(prevDate.getDate() - (startDayOfWeek - i));
                  currentWeek.push({ date: prevDate, isTrading: false, isSimulated: false, dayNum: 0, isGiftDay: false, isGoalDay: false });
                }
                
                let currentCalendarDate = new Date(currentDate);
                while (currentCalendarDate <= calendarEndDate) {
                  const thisDate = new Date(currentCalendarDate);
                  const dayOfWeek = thisDate.getDay();
                  const isTradingDay = isNYSETradingDay(thisDate);
                  const isBeforeOrAtGoal = tradingDayCount < tradingDaysToShow;
                  
                  if (isTradingDay && isBeforeOrAtGoal) {
                    tradingDayCount++;
                  } else if (isTradingDay && tradingDayCount >= tradingDaysToShow) {
                    passedGoalDay = true;
                  }
                  
                  const sliderDay = Math.min(rawSliderDay, tradingDaysToShow);
                  const shouldHighlight = isSliderMoved && isTradingDay && tradingDayCount <= sliderDay && tradingDayCount > 0 && !passedGoalDay;
                  const isGiftDay = isTradingDay && tradingDayCount > 0 && giftDays.has(tradingDayCount) && !passedGoalDay;
                  const isGoalDay = isTradingDay && tradingDayCount === tradingDaysToShow && daysNotShown === 0 && !goalDayMarked;
                  if (isGoalDay) goalDayMarked = true;
                  
                  currentWeek.push({
                    date: thisDate,
                    isTrading: isTradingDay,
                    isSimulated: shouldHighlight,
                    dayNum: isTradingDay && tradingDayCount > 0 ? tradingDayCount : 0,
                    isGiftDay,
                    isGoalDay
                  });
                  
                  if (dayOfWeek === 6) {
                    calendarWeeks.push(currentWeek);
                    currentWeek = [];
                  }
                  currentCalendarDate.setDate(currentCalendarDate.getDate() + 1);
                }
                
                if (currentWeek.length > 0) {
                  while (currentWeek.length < 7) {
                    const lastDate = currentWeek[currentWeek.length - 1]?.date || new Date();
                    const nextDate = new Date(lastDate);
                    nextDate.setDate(nextDate.getDate() + 1);
                    currentWeek.push({ date: nextDate, isTrading: false, isSimulated: false, dayNum: 0, isGiftDay: false, isGoalDay: false });
                  }
                  calendarWeeks.push(currentWeek);
                }
                
                let lastLabeledMonth = -1;
                
                return calendarWeeks.length > 0 ? (
                  <Card data-testid="card-calendar" className="animate-fade-in">
                    <CardHeader className="pb-3 cursor-pointer" onClick={() => setCalendarCollapsed(prev => !prev)}>
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <Button variant="ghost" size="icon" className="h-6 w-6 p-0" data-testid="button-collapse-calendar">
                            {calendarCollapsed ? <ChevronRight className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
                          </Button>
                          <Calendar className="w-4 h-4 text-primary" />
                          <h3 className="text-xs font-bold text-foreground uppercase tracking-widest">Upcoming Trading Days</h3>
                        </div>
                      </div>
                    </CardHeader>
                    {!calendarCollapsed && (
                      <CardContent className="space-y-4">
                        <div className="grid grid-cols-5 gap-1.5 mb-2">
                          {['Mon', 'Tue', 'Wed', 'Thu', 'Fri'].map((day, i) => (
                            <div key={i} className="text-xs text-center font-semibold text-muted-foreground py-1">
                              {day}
                            </div>
                          ))}
                        </div>
                        {giftDays.size > 0 && (
                          <div className="text-xs text-purple-400 text-center">
                            {giftDays.size} Dream Day{giftDays.size !== 1 ? 's' : ''} (purple)
                          </div>
                        )}
                        <div className="max-h-[300px] overflow-y-auto scrollbar-thin">
                          {calendarWeeks.map((week, weekIdx) => {
                            const firstOfMonthDay = week.find(d => d.date.getDate() === 1 && d.date.getMonth() !== lastLabeledMonth);
                            const showMonthLabel = weekIdx === 0 || firstOfMonthDay;
                            
                            let monthToLabel: Date | null = null;
                            if (weekIdx === 0) {
                              monthToLabel = today;
                              lastLabeledMonth = today.getMonth();
                            } else if (firstOfMonthDay) {
                              monthToLabel = firstOfMonthDay.date;
                              lastLabeledMonth = firstOfMonthDay.date.getMonth();
                            }
                            
                            return (
                              <div key={weekIdx}>
                                {showMonthLabel && monthToLabel && (
                                  <div className="sticky top-0 z-10 text-sm font-semibold text-primary py-2 px-2 bg-background/95 backdrop-blur border-b border-border/50 mb-2 mt-3 first:mt-0">
                                    {monthToLabel.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}
                                  </div>
                                )}
                                <div className="grid grid-cols-5 gap-1.5 mb-1">
                                  {week.filter(d => {
                                    const dow = d.date.getDay();
                                    return dow >= 1 && dow <= 5;
                                  }).map((day, dayIdx) => {
                                    const isToday = day.date.toDateString() === today.toDateString();
                                    const isPast = day.date < today;
                                    
                                    let dayClasses = 'min-h-[32px] px-1 py-1.5 text-xs leading-tight text-center rounded-md flex items-center justify-center ';
                                    let dayTitle = '';
                                    
                                    if (isPast) {
                                      dayClasses += 'text-muted-foreground/30 bg-muted/20';
                                    } else if (day.isGoalDay) {
                                      dayClasses += 'bg-yellow-500 text-yellow-950 font-bold ring-2 ring-yellow-400 cursor-pointer hover:bg-yellow-400';
                                      dayTitle = `GOAL DAY - Day ${day.dayNum}`;
                                    } else if (day.isGiftDay) {
                                      dayClasses += 'bg-purple-600 text-white font-semibold cursor-pointer hover:bg-purple-500';
                                      if (day.isSimulated) dayClasses += ' ring-2 ring-win';
                                      dayTitle = `Dream Day ${sortedGiftDays.indexOf(day.dayNum) + 1}`;
                                    } else if (day.isSimulated) {
                                      dayClasses += 'bg-win/30 text-win font-semibold';
                                      dayTitle = `Day ${day.dayNum}`;
                                    } else if (day.isTrading) {
                                      dayClasses += 'font-medium text-foreground bg-muted/30';
                                      dayTitle = `Day ${day.dayNum}`;
                                    } else {
                                      dayClasses += 'text-muted-foreground/40 bg-muted/10';
                                    }
                                    
                                    if (isToday && !day.isGoalDay) {
                                      dayClasses += ' ring-1 ring-primary ring-offset-1 font-bold';
                                    }
                                    
                                    return (
                                      <div 
                                        key={dayIdx}
                                        className={dayClasses}
                                        title={dayTitle}
                                        onClick={day.isGoalDay ? () => {
                                          const goalDateStr = day.date.toLocaleDateString('en-US', { 
                                            weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' 
                                          });
                                          setGoalCelebrationDate(goalDateStr);
                                          setShowGoalCelebration(true);
                                        } : day.isGiftDay ? () => {
                                          const dreamIdsOnDay = giftDayDetails.get(day.dayNum) || [];
                                          const dreamsOnDay = activeDreamItems.filter(item => dreamIdsOnDay.includes(item.id));
                                          if (dreamsOnDay.length > 0) {
                                            const ordinal = sortedGiftDays.indexOf(day.dayNum) + 1;
                                            setSelectedDreamDay({ 
                                              ordinal,
                                              tradingDay: day.dayNum, 
                                              calendarDate: day.date,
                                              dreams: dreamsOnDay 
                                            });
                                          }
                                        } : undefined}
                                        data-testid={day.isGoalDay ? `calendar-goal-day-${day.dayNum}` : day.isGiftDay ? `calendar-dream-day-${day.dayNum}` : undefined}
                                      >
                                        {day.date.getDate()}
                                      </div>
                                    );
                                  })}
                                </div>
                              </div>
                            );
                          })}
                          {daysNotShown > 0 && (
                            <div className="text-xs text-muted-foreground text-center py-2 mt-2 border-t border-border/30">
                              +{daysNotShown.toLocaleString()} more trading days to goal
                            </div>
                          )}
                        </div>
                      </CardContent>
                    )}
                  </Card>
                ) : null;
              })()}

              <Card data-testid="card-dream-items" className="animate-fade-in">
                <CardHeader className="pb-3 space-y-3 cursor-pointer" onClick={() => setDreamBoardCollapsed(prev => !prev)}>
                  <div className="flex flex-row items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <Button variant="ghost" size="icon" className="h-6 w-6 p-0" data-testid="button-collapse-dream-board">
                        {dreamBoardCollapsed ? <ChevronRight className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
                      </Button>
                      <Sparkles className="w-4 h-4 text-primary" />
                      <h3 className="text-xs font-bold text-muted-foreground uppercase tracking-widest">Dream Board</h3>
                    </div>
                    <div className="flex items-center gap-1">
                      {hiddenDreamIds.size > 0 && (
                        <Button variant="outline" size="sm" className="text-xs gap-1" onClick={(e) => { e.stopPropagation(); showAllDreams(); }} data-testid="button-show-all-dreams">
                          <Eye className="w-3 h-3" />
                          Show {hiddenDreamIds.size} Hidden
                        </Button>
                      )}
                      <Button
                        variant={dreamSortMode.startsWith('price') ? 'default' : 'outline'}
                        size="sm"
                        onClick={(e) => { e.stopPropagation(); setDreamSortMode(prev => prev === 'price-asc' ? 'price-desc' : 'price-asc'); }}
                        className="text-xs gap-1"
                        data-testid="button-sort-price"
                      >
                        Price {dreamSortMode === 'price-asc' ? '↑' : dreamSortMode === 'price-desc' ? '↓' : ''}
                      </Button>
                      <Button
                        variant={dreamSortMode.startsWith('category') ? 'default' : 'outline'}
                        size="sm"
                        onClick={(e) => { e.stopPropagation(); setDreamSortMode(prev => prev === 'category-asc' ? 'category-desc' : 'category-asc'); }}
                        className="text-xs gap-1"
                        data-testid="button-sort-category"
                      >
                        Category {dreamSortMode === 'category-asc' ? '↑' : dreamSortMode === 'category-desc' ? '↓' : ''}
                      </Button>
                    </div>
                  </div>

                  {!dreamBoardCollapsed && (
                    <>
                      <div className="flex items-center justify-between p-2 rounded-lg bg-muted/30 border border-border/50" onClick={(e) => e.stopPropagation()}>
                        <div className="flex items-center gap-2">
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <div className="cursor-help flex items-center gap-1.5">
                                <ShoppingBag className="w-3.5 h-3.5 text-muted-foreground" />
                                <span className="text-xs text-muted-foreground uppercase tracking-wide font-medium">Purchase Mode</span>
                              </div>
                            </TooltipTrigger>
                            <TooltipContent side="bottom" className="max-w-xs">
                              <p className="text-xs">
                                <strong>Buy As You Go:</strong> Items auto-purchase at unlock step.
                                <br /><br />
                                <strong>Wait Till End:</strong> All items stay potential purchases until the goal.
                              </p>
                            </TooltipContent>
                          </Tooltip>
                        </div>
                        <div className="flex items-center gap-1 bg-background rounded-md p-0.5 border border-border/30">
                          <Button
                            variant={dreamFeedbackMode === 'buyAsYouGo' ? 'default' : 'ghost'}
                            size="sm"
                            onClick={(e) => { e.stopPropagation(); setDreamFeedbackMode('buyAsYouGo'); }}
                            className={`text-xs h-7 px-2 ${dreamFeedbackMode === 'buyAsYouGo' ? 'bg-primary text-primary-foreground' : ''}`}
                            data-testid="button-mode-buy-as-you-go"
                          >
                            Buy As You Go
                          </Button>
                          <Button
                            variant={dreamFeedbackMode === 'waitTillEnd' ? 'default' : 'ghost'}
                            size="sm"
                            onClick={(e) => { e.stopPropagation(); setDreamFeedbackMode('waitTillEnd'); }}
                            className={`text-xs h-7 px-2 ${dreamFeedbackMode === 'waitTillEnd' ? 'bg-primary text-primary-foreground' : ''}`}
                            data-testid="button-mode-wait-till-end"
                          >
                            Wait Till End
                          </Button>
                        </div>
                      </div>

                      <div className="flex justify-end" onClick={(e) => e.stopPropagation()}>
                        <Dialog open={isAddingItem} onOpenChange={setIsAddingItem}>
                          <DialogTrigger asChild>
                            <Button variant="outline" size="sm" className="gap-1.5" data-testid="button-add-dream">
                              <Plus className="w-3.5 h-3.5" />
                              Add Dream
                            </Button>
                          </DialogTrigger>
                          <DialogContent onClick={(e) => e.stopPropagation()}>
                            <DialogHeader>
                              <DialogTitle>Add New Dream</DialogTitle>
                            </DialogHeader>
                            <div className="space-y-4 pt-4">
                              <div>
                                <label className="text-sm font-medium mb-2 block">Dream Name</label>
                                <Input value={newItemName} onChange={(e) => setNewItemName(e.target.value)} placeholder="e.g., Sports Car, Vacation Home" data-testid="input-dream-name" />
                              </div>
                              <div>
                                <label className="text-sm font-medium mb-2 block">Category</label>
                                <Select value={newItemCategory} onValueChange={setNewItemCategory}>
                                  <SelectTrigger data-testid="input-dream-category">
                                    <SelectValue placeholder="Select a category" />
                                  </SelectTrigger>
                                  <SelectContent>
                                    <SelectItem value="CARS">Cars</SelectItem>
                                    <SelectItem value="HOUSES">Houses</SelectItem>
                                    <SelectItem value="WATCHES">Watches</SelectItem>
                                    <SelectItem value="SHOES">Shoes</SelectItem>
                                    <SelectItem value="ACCESSORIES">Accessories</SelectItem>
                                    <SelectItem value="CLOTHES">Clothes</SelectItem>
                                    <SelectItem value="ART">Art</SelectItem>
                                    <SelectItem value="SUITS">Suits</SelectItem>
                                    <SelectItem value="TECH">Tech</SelectItem>
                                    <SelectItem value="JEWELRY">Jewelry</SelectItem>
                                    <SelectItem value="TRAVEL">Travel</SelectItem>
                                    <SelectItem value="SELF_IMPROVEMENT">Self Improvement</SelectItem>
                                    <SelectItem value="GIFTS">Gifts</SelectItem>
                                  </SelectContent>
                                </Select>
                              </div>
                              <div>
                                <label className="text-sm font-medium mb-2 block">Cost ($)</label>
                                <Input value={newItemCost} onChange={handleInputChange(setNewItemCost)} placeholder="0" data-testid="input-dream-cost" />
                              </div>
                              <div>
                                <label className="text-sm font-medium mb-2 block">Link</label>
                                <Input value={newItemUrl} onChange={(e) => setNewItemUrl(e.target.value)} placeholder="https://..." data-testid="input-dream-url" />
                              </div>
                              <Button onClick={handleAddItem} className="w-full" disabled={!newItemName || !newItemCost} data-testid="button-save-dream">
                                Add Dream
                              </Button>
                            </div>
                          </DialogContent>
                        </Dialog>
                      </div>
                    </>
                  )}
                </CardHeader>

                {!dreamBoardCollapsed && (
                  <CardContent className="space-y-4">
                    {activeDreamItems.length === 0 && hiddenDreamItems.length === 0 ? (
                      <div className="text-center py-8" data-testid="empty-state-dreams">
                        <Sparkles className="w-8 h-8 text-muted mx-auto mb-2" />
                        <p className="text-sm text-muted-foreground">No dreams yet. Add your first goal!</p>
                      </div>
                    ) : (
                      <div className="space-y-4">
                        <div className="p-3 rounded-lg bg-muted/30 border border-border/50 space-y-2">
                          <div className="flex justify-between text-sm">
                            <span className="text-muted-foreground">Total Cost</span>
                            <span className="font-bold tabular-nums" data-testid="text-dream-total">{formatCurrency(totalCost)}</span>
                          </div>
                          <div className="flex justify-between text-sm">
                            <span className="text-muted-foreground">Purchased</span>
                            <span className="font-bold text-win tabular-nums" data-testid="text-dream-purchased">{formatCurrency(purchasedCost)}</span>
                          </div>
                          <div className="flex justify-between text-sm">
                            <span className="text-muted-foreground">Remaining</span>
                            <span className={`font-bold tabular-nums ${remainingNeeded > 0 ? 'text-loss' : 'text-win'}`} data-testid="text-dream-remaining">{formatCurrency(remainingNeeded)}</span>
                          </div>
                        </div>

                        {Object.entries(grouped).map(([category, items]) => {
                          const categoryTotal = items.reduce((sum, item) => sum + item.cost, 0);
                          return (
                            <div key={category} className="space-y-2">
                              <div className="flex justify-between items-center">
                                <h4 className={`text-xs font-bold uppercase tracking-wide ${getCategoryColor(category)}`}>{category}</h4>
                                <span className={`text-xs font-bold ${getCategoryColor(category)}`} data-testid={`text-category-total-${category}`}>{formatCurrency(categoryTotal)}</span>
                              </div>
                              <div className="space-y-2">
                                {items.map((item) => {
                                  const canAffordNow = affordableNowSet.has(item.id);
                                  const canAffordImagined = affordableImaginedSet.has(item.id);
                                  const newlyAffordable = isImaginingFuture && canAffordImagined && !canAffordNow;
                                  const canAfford = canAffordNow || canAffordImagined;
                                  
                                  const requiredNetLiquid = getRequiredNetForItem(item.cost, item.category);
                                  const progress = Math.min(100, (currentNetLiquid / requiredNetLiquid) * 100);
                                  
                                  const canCoverCost = currentNetLiquid >= item.cost;
                                  const meetsAffordabilityRule = currentNetLiquid >= requiredNetLiquid;
                                  const purchaseBlocked = !canCoverCost;
                                  const purchaseWarning = canCoverCost && !meetsAffordabilityRule;
                                  
                                  const requiredGrossForItem = (requiredNetLiquid + purchasedCosts - TAX_RATE * originBalance) / NET_RATE;
                                  const minStepToAfford = Math.max(0, Math.ceil(Math.log(requiredGrossForItem / originBalance) / Math.log(GROWTH_RATE)));

                                  return (
                                    <div
                                      key={item.id}
                                      className={`p-4 rounded-lg border transition-all duration-300 ${
                                        item.purchased 
                                          ? 'bg-win/10 border-win/30' 
                                          : newlyAffordable
                                            ? 'bg-win/20 border-win/50'
                                            : canAffordNow 
                                              ? 'bg-primary/10 border-primary/30' 
                                              : 'bg-muted/20 border-border/50'
                                      }`}
                                      data-testid={`card-dream-${item.id}`}
                                    >
                                      <div className="flex items-start justify-between gap-3">
                                        <div className="flex items-center gap-3 flex-1 min-w-0">
                                          <div className={`p-2 rounded-lg flex-shrink-0 ${
                                            item.purchased 
                                              ? 'bg-win/20 text-win' 
                                              : newlyAffordable
                                                ? 'bg-win/30 text-win'
                                                : canAffordNow 
                                                  ? 'bg-primary/20 text-primary' 
                                                  : 'bg-muted text-muted-foreground'
                                          }`}>
                                            {getIcon(item.iconType)}
                                          </div>
                                          <div className="flex-1 min-w-0">
                                            {item.url ? (
                                              <a href={item.url} target="_blank" rel="noopener noreferrer" className={`font-bold truncate hover:underline block ${item.purchased ? 'line-through text-muted-foreground' : 'text-primary'}`} data-testid={`link-dream-${item.id}`}>
                                                {item.name}
                                              </a>
                                            ) : (
                                              <div className={`font-bold truncate ${item.purchased ? 'line-through text-muted-foreground' : ''}`}>
                                                {item.name}
                                              </div>
                                            )}
                                            <div className="flex items-center gap-2">
                                              <span className="text-sm text-muted-foreground tabular-nums">{formatCurrency(item.cost)}</span>
                                              {!item.purchased && !canAfford && dailyWins > 0 && (
                                                <Tooltip>
                                                  <TooltipTrigger asChild>
                                                    <span className={`text-xs cursor-help ${dailyWins !== 1 ? 'text-primary/70' : 'text-muted-foreground/70'}`} data-testid={`text-days-${item.id}`}>
                                                      ~{calcDaysToAfford(item.cost, item.category).toLocaleString()} {calcDaysToAfford(item.cost, item.category) === 1 ? 'day' : 'days'}
                                                    </span>
                                                  </TooltipTrigger>
                                                  <TooltipContent>
                                                    <p className="text-xs">At {dailyWins.toFixed(1)} wins/day</p>
                                                  </TooltipContent>
                                                </Tooltip>
                                              )}
                                              {!item.purchased && newlyAffordable && (
                                                <Badge className="text-xs bg-win/20 text-win border-win/30" data-testid={`badge-imagined-${item.id}`}>
                                                  At Step {minStepToAfford}
                                                </Badge>
                                              )}
                                              {!item.purchased && canAffordNow && (
                                                <Badge className="text-xs bg-win/20 text-win border-win/30" data-testid={`badge-affordable-${item.id}`}>
                                                  Ready
                                                </Badge>
                                              )}
                                            </div>
                                          </div>
                                        </div>
                                        <div className="flex items-center gap-1">
                                          <Tooltip>
                                            <TooltipTrigger asChild>
                                              <Button variant="ghost" size="icon" className="h-6 w-6 p-0" onClick={(e) => { e.stopPropagation(); toggleDreamVisibility(item.id); }} data-testid={`button-toggle-dream-${item.id}`}>
                                                {hiddenDreamIds.has(item.id) ? <Eye className="h-3 w-3 text-muted-foreground" /> : <EyeOff className="h-3 w-3 text-muted-foreground" />}
                                              </Button>
                                            </TooltipTrigger>
                                            <TooltipContent className="max-w-xs">
                                              <p className="text-xs">
                                                {hiddenDreamIds.has(item.id) 
                                                  ? "Show this dream and include in budget calculations"
                                                  : "Hide from budget — removes from treasury, affordability, and projection calculations"
                                                }
                                              </p>
                                            </TooltipContent>
                                          </Tooltip>
                                          <Button variant="ghost" size="icon" onClick={() => handleEditDreamItem(item)} className="h-8 w-8" data-testid={`button-edit-dream-${item.id}`}>
                                            <Flag className="w-4 h-4 text-muted-foreground" />
                                          </Button>
                                          <Tooltip>
                                            <TooltipTrigger asChild>
                                              <Button
                                                variant="ghost"
                                                size="icon"
                                                onClick={() => (item.purchased || !purchaseBlocked) && handlePurchaseItem(item.id)}
                                                disabled={purchaseBlocked && !item.purchased}
                                                className={`h-8 w-8 ${
                                                  item.purchased 
                                                    ? '' 
                                                    : purchaseBlocked 
                                                      ? 'opacity-40 cursor-not-allowed' 
                                                      : purchaseWarning 
                                                        ? 'ring-1 ring-loss/50' 
                                                        : ''
                                                }`}
                                                data-testid={`button-purchase-${item.id}`}
                                              >
                                                {item.purchased ? (
                                                  <CheckCircle className="w-4 h-4 text-win" />
                                                ) : purchaseBlocked ? (
                                                  <Ban className="w-4 h-4 text-muted-foreground" />
                                                ) : purchaseWarning ? (
                                                  <AlertTriangle className="w-4 h-4 text-loss" />
                                                ) : (
                                                  <CheckCircle className="w-4 h-4 text-muted-foreground hover:text-win" />
                                                )}
                                              </Button>
                                            </TooltipTrigger>
                                            <TooltipContent className="max-w-xs">
                                              {item.purchased ? (
                                                <p className="text-xs">Click to unmark as purchased</p>
                                              ) : purchaseBlocked ? (
                                                <p className="text-xs">
                                                  <span className="font-bold text-loss">Tax Blocked:</span> Need {formatCurrency(item.cost)} net liquid after taxes.<br/>
                                                  Current net: {formatCurrency(currentNetLiquid)}<br/>
                                                  <span className="text-muted-foreground">Pay down taxes first</span>
                                                </p>
                                              ) : purchaseWarning ? (
                                                <p className="text-xs">
                                                  <span className="font-bold text-loss">Warning:</span> Below safety threshold.<br/>
                                                  Need: {formatCurrency(requiredNetLiquid)}<br/>
                                                  Have: {formatCurrency(currentNetLiquid)}<br/>
                                                  <span className="italic text-muted-foreground">Click to purchase anyway (not recommended)</span>
                                                </p>
                                              ) : (
                                                <p className="text-xs">
                                                  <span className="font-bold text-win">Ready!</span> Meets safety threshold.<br/>
                                                  Click to mark as purchased
                                                </p>
                                              )}
                                            </TooltipContent>
                                          </Tooltip>
                                          <Button variant="ghost" size="icon" onClick={() => handleDeleteItem(item.id)} className="h-8 w-8 text-muted-foreground hover:text-destructive" data-testid={`button-delete-${item.id}`}>
                                            <Trash2 className="w-4 h-4" />
                                          </Button>
                                        </div>
                                      </div>
                                      {!item.purchased && (
                                        <div className="mt-3">
                                          <div className="flex justify-between text-xs mb-1">
                                            <span className="text-muted-foreground">Progress</span>
                                            <span className={`font-bold ${canAfford ? 'text-primary' : ''}`}>{progress.toFixed(0)}%</span>
                                          </div>
                                          <Progress value={progress} className="h-1.5" />
                                        </div>
                                      )}
                                    </div>
                                  );
                                })}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </CardContent>
                )}
              </Card>

              {hiddenDreamItems.length > 0 && (
                      <Collapsible className="mt-6 border border-border/50 rounded-lg bg-muted/20">
                        <div className="flex items-center justify-between w-full p-3">
                          <CollapsibleTrigger asChild>
                            <div className="flex items-center gap-2 cursor-pointer hover:bg-muted/30 transition-colors rounded-lg p-1 -m-1" data-testid="trigger-hidden-dreams">
                              <EyeOff className="w-4 h-4 text-muted-foreground" />
                              <span className="text-sm font-medium text-muted-foreground">Hidden Dreams ({hiddenDreamItems.length})</span>
                              <Badge variant="outline" className="text-xs bg-muted/50">Not affecting budget</Badge>
                              <ChevronDown className="w-4 h-4 text-muted-foreground" />
                            </div>
                          </CollapsibleTrigger>
                          <Button variant="ghost" size="sm" className="text-xs h-7" onClick={(e) => { e.stopPropagation(); showAllDreams(); }} data-testid="button-restore-all-dreams">
                            Restore All
                          </Button>
                        </div>
                        <CollapsibleContent>
                          <div className="px-3 pb-3 space-y-2">
                            <p className="text-xs text-muted-foreground mb-3">
                              These dreams are hidden from your budget. Hiding dreams lets you experiment with "what if I didn't have this goal?" scenarios without deleting them.
                            </p>
                            {hiddenDreamItems.map((item) => (
                              <div key={item.id} className="flex items-center justify-between p-2 rounded-lg border border-border/30 bg-background/50" data-testid={`hidden-dream-${item.id}`}>
                                <div className="flex items-center gap-2 flex-1 min-w-0">
                                  <div className="p-1.5 rounded bg-muted/50 text-muted-foreground">
                                    {getIcon(item.iconType)}
                                  </div>
                                  <div className="flex-1 min-w-0">
                                    <div className="text-sm font-medium truncate text-muted-foreground">{item.name}</div>
                                    <div className="text-xs text-muted-foreground/70 tabular-nums">{formatCurrency(item.cost)}</div>
                                  </div>
                                </div>
                                <Button variant="outline" size="sm" className="text-xs h-7 gap-1" onClick={() => toggleDreamVisibility(item.id)} data-testid={`button-restore-dream-${item.id}`}>
                                  <Eye className="w-3 h-3" />
                                  Restore
                                </Button>
                              </div>
                            ))}
                          </div>
                        </CollapsibleContent>
                      </Collapsible>
                    )}

                    <Dialog open={editingItemId !== null} onOpenChange={(open) => {
                      if (!open) {
                        setEditingItemId(null);
                        setEditingItemName('');
                        setEditingItemCost('');
                        setEditingItemCategory('');
                        setEditingItemUrl('');
                      }
                    }}>
                      <DialogContent>
                        <DialogHeader>
                          <DialogTitle>Edit Dream</DialogTitle>
                        </DialogHeader>
                        <div className="space-y-4 pt-4">
                          <div>
                            <label className="text-sm font-medium mb-2 block">Dream Name</label>
                            <Input value={editingItemName} onChange={(e) => setEditingItemName(e.target.value)} placeholder="e.g., Sports Car" data-testid="input-edit-dream-name" />
                          </div>
                          <div>
                            <label className="text-sm font-medium mb-2 block">Category</label>
                            <Select value={editingItemCategory} onValueChange={setEditingItemCategory}>
                              <SelectTrigger data-testid="input-edit-dream-category">
                                <SelectValue placeholder="Select a category" />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="CARS">Cars</SelectItem>
                                <SelectItem value="HOUSES">Houses</SelectItem>
                                <SelectItem value="WATCHES">Watches</SelectItem>
                                <SelectItem value="SHOES">Shoes</SelectItem>
                                <SelectItem value="ACCESSORIES">Accessories</SelectItem>
                                <SelectItem value="CLOTHES">Clothes</SelectItem>
                                <SelectItem value="ART">Art</SelectItem>
                                <SelectItem value="SUITS">Suits</SelectItem>
                                <SelectItem value="TECH">Tech</SelectItem>
                                <SelectItem value="JEWELRY">Jewelry</SelectItem>
                                <SelectItem value="TRAVEL">Travel</SelectItem>
                                <SelectItem value="SELF_IMPROVEMENT">Self Improvement</SelectItem>
                                <SelectItem value="GIFTS">Gifts</SelectItem>
                              </SelectContent>
                            </Select>
                          </div>
                          <div>
                            <label className="text-sm font-medium mb-2 block">Cost ($)</label>
                            <Input value={editingItemCost} onChange={handleInputChange(setEditingItemCost)} placeholder="0" data-testid="input-edit-dream-cost" />
                          </div>
                          <div>
                            <label className="text-sm font-medium mb-2 block">Link</label>
                            <Input value={editingItemUrl} onChange={(e) => setEditingItemUrl(e.target.value)} placeholder="https://..." data-testid="input-edit-dream-url" />
                          </div>
                          <Button onClick={handleSaveEditDreamItem} className="w-full" disabled={!editingItemName || !editingItemCost} data-testid="button-save-edit-dream">
                            Save Changes
                          </Button>
                        </div>
                      </DialogContent>
                    </Dialog>

                    <Dialog open={selectedDreamDay !== null} onOpenChange={(open) => { if (!open) setSelectedDreamDay(null); }}>
                      <DialogContent className="max-w-md">
                        <DialogHeader>
                          <DialogTitle className="flex items-center gap-2">
                            <Gift className="w-5 h-5 text-purple-400" />
                            Dream Day {selectedDreamDay?.ordinal}
                          </DialogTitle>
                        </DialogHeader>
                        {selectedDreamDay && (
                          <div className="space-y-4 pt-2">
                            <div className="text-sm text-muted-foreground">
                              On <span className="font-semibold text-primary">{selectedDreamDay.calendarDate.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}</span> (Trading Day {selectedDreamDay.tradingDay}), you can afford:
                            </div>
                            <div className="space-y-2">
                              {selectedDreamDay.dreams.map((dream) => (
                                <div key={dream.id} className="flex items-center justify-between p-3 rounded-lg bg-purple-500/10 border border-purple-500/30">
                                  <div className="flex items-center gap-3">
                                    <div className="p-2 rounded bg-purple-500/20 text-purple-400">
                                      {getIcon(dream.iconType)}
                                    </div>
                                    <div>
                                      <div className="font-medium">{dream.name}</div>
                                      <div className="text-xs text-muted-foreground">{dream.category}</div>
                                    </div>
                                  </div>
                                  <div className="text-lg font-bold text-purple-400 tabular-nums">
                                    {formatCurrency(dream.cost)}
                                  </div>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                      </DialogContent>
                    </Dialog>

                    <Dialog open={showGoalCelebration} onOpenChange={setShowGoalCelebration}>
                      <DialogContent className="max-w-md text-center">
                        <DialogHeader>
                          <DialogTitle className="flex items-center justify-center gap-2 text-2xl">
                            <Trophy className="w-8 h-8 text-yellow-500" />
                            GOAL DAY!
                          </DialogTitle>
                        </DialogHeader>
                        <div className="py-6 space-y-4">
                          <div className="text-4xl">🎉🏆🎉</div>
                          <p className="text-lg">
                            On <span className="font-bold text-primary">{goalCelebrationDate}</span>, you will reach your ultimate goal!
                          </p>
                          <p className="text-sm text-muted-foreground">
                            Keep trading with discipline and this day will be yours.
                          </p>
                        </div>
                      </DialogContent>
                    </Dialog>
            </div>
          </ScrollArea>
        </ResizablePanel>
      </ResizablePanelGroup>

    </div>
  );
}
