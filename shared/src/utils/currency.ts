export function formatMoney(value: number | string, symbol = '₱', fractionDigits = 0): string {
  return `${symbol}${Number(value).toLocaleString('en-PH', { minimumFractionDigits: fractionDigits, maximumFractionDigits: fractionDigits })}`;
}
