/**
 * Shared utility functions and types for DealCard components.
 * Used by: deal-card.tsx, deal-card-list.tsx, deals-page grid view
 */

// ─── DealCard Data Shape ─────────────────────────────────────────────────────

export interface DealCardData {
  id: string;
  title: string;
  value?: number;
  currency?: string;
  priority?: string;
  stageName?: string;
  pipelineName?: string;
  expectedCloseDate?: string;
  assignedUser?: { id: string; firstName: string; lastName: string };
  companyName?: string;
  daysInStage?: number;
  isWon?: boolean;
  isLost?: boolean;
  stageOrder?: number;
  totalStages?: number;
  isArchived?: boolean;
}

// ─── Priority Helpers ────────────────────────────────────────────────────────

export type PriorityLevel = 'HIGH' | 'MEDIUM' | 'LOW';

export function normalizePriority(priority?: string): PriorityLevel {
  const upper = (priority ?? '').toUpperCase();
  if (upper === 'HIGH') return 'HIGH';
  if (upper === 'LOW') return 'LOW';
  return 'MEDIUM';
}

export function getPriorityClasses(priority: PriorityLevel): string {
  switch (priority) {
    case 'HIGH':
      return 'bg-red-50 border-red-200 text-red-700 dark:bg-red-950/30 dark:border-red-800/60 dark:text-red-400';
    case 'MEDIUM':
      return 'bg-amber-50 border-amber-200 text-amber-700 dark:bg-amber-950/30 dark:border-amber-800/60 dark:text-amber-400';
    case 'LOW':
      return 'bg-slate-50 border-slate-200 text-slate-600 dark:bg-slate-800/50 dark:border-slate-700 dark:text-slate-400';
  }
}

// ─── Stage Badge Helpers ─────────────────────────────────────────────────────

export function getStageClasses(isWon?: boolean, isLost?: boolean): string {
  if (isWon) {
    return 'bg-emerald-50 border-emerald-200 text-emerald-700 dark:bg-emerald-950/30 dark:border-emerald-800/60 dark:text-emerald-400';
  }
  if (isLost) {
    return 'bg-red-50 border-red-200 text-red-700 dark:bg-red-950/30 dark:border-red-800/60 dark:text-red-400';
  }
  return 'bg-blue-50 border-blue-200 text-blue-700 dark:bg-blue-950/30 dark:border-blue-800/60 dark:text-blue-400';
}

// ─── Value Formatting ────────────────────────────────────────────────────────

/**
 * Format a deal value using the deal's own currency field.
 * Falls back to PHP if no currency is specified.
 * Uses the centralized CURRENCY_MAP so new currencies are supported automatically.
 */
export function formatDealValue(value?: number, currency?: string): string {
  if (value === undefined || value === null || value === 0) return '—';
  // Import-free symbol lookup — CURRENCY_MAP is inlined here to keep
  // this utility file dependency-free (it's used in non-React contexts).
  const SYMBOL_MAP: Record<string, string> = {
    PHP: '₱', USD: '$', EUR: '€', GBP: '£', JPY: '¥',
    SGD: 'S$', AUD: 'A$', CAD: 'C$', INR: '₹', MYR: 'RM',
  };
  const symbol = SYMBOL_MAP[currency ?? 'PHP'] ?? (currency ?? '₱');
  return `${symbol}${value.toLocaleString()}`;
}

// ─── Date Formatting ─────────────────────────────────────────────────────────

export function formatCloseDate(dateStr?: string): string {
  if (!dateStr) return '—';
  try {
    return new Date(dateStr).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  } catch {
    return '—';
  }
}

// ─── Map from backend/DataContext shape to DealCardData ──────────────────────

export function mapToDealCardData(deal: Record<string, unknown>): DealCardData {
  const stage = deal.stage as Record<string, unknown> | null | undefined;
  const pipeline = deal.pipeline as Record<string, unknown> | null | undefined;
  const assignedUser = deal.assignedUser as { id: string; firstName: string; lastName: string } | null | undefined;
  const organization = deal.organization as Record<string, unknown> | null | undefined;

  return {
    id: String(deal.id ?? ''),
    title: String(deal.title ?? ''),
    value: typeof deal.value === 'number' ? deal.value : undefined,
    currency: typeof deal.currency === 'string' ? deal.currency : 'PHP',
    priority: typeof deal.priority === 'string' ? deal.priority : undefined,
    stageName: (stage?.name as string) ?? (deal.stageName as string) ?? undefined,
    pipelineName: (pipeline?.name as string) ?? (deal.pipelineName as string) ?? undefined,
    expectedCloseDate: (deal.expectedCloseDate as string) ?? undefined,
    assignedUser: assignedUser ?? undefined,
    companyName: (deal.companyName as string) ?? (organization?.name as string) ?? undefined,
    daysInStage: typeof deal.daysInStage === 'number' ? deal.daysInStage : undefined,
    isWon: (stage?.isWon as boolean) ?? (deal.isWon as boolean) ?? false,
    isLost: (stage?.isLost as boolean) ?? (deal.isLost as boolean) ?? false,
    stageOrder: typeof deal.stageOrder === 'number' ? deal.stageOrder : undefined,
    totalStages: typeof deal.totalStages === 'number' ? deal.totalStages : undefined,
    isArchived: (deal.isArchived as boolean) ?? false,
  };
}
