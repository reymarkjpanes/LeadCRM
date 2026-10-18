import { formatMoney } from '@leadcrm/shared';

interface CurrencyConfig {
  code: string;   // ISO 4217 (e.g. 'PHP', 'USD')
  symbol: string; // Display symbol (e.g. '₱', '$')
}

const CURRENCY_MAP: Record<string, string> = {
  PHP: '₱', USD: '$', EUR: '€', GBP: '£', JPY: '¥',
  SGD: 'S$', AUD: 'A$', CAD: 'C$', INR: '₹', MYR: 'RM',
};

const DEFAULT_CURRENCY: CurrencyConfig = { code: 'PHP', symbol: '₱' };

export function getTenantCurrency(tenant: { currency?: string } | null): CurrencyConfig {
  const code = tenant?.currency || 'PHP';
  const symbol = CURRENCY_MAP[code] || code;
  return { code, symbol };
}

export function formatCurrency(value: number, config: CurrencyConfig = DEFAULT_CURRENCY, fractionDigits = 0): string {
  return formatMoney(fractionDigits ? value : Math.round(value), config.symbol, fractionDigits);
}

export { CURRENCY_MAP, DEFAULT_CURRENCY };
export type { CurrencyConfig };
