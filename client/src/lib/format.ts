export function formatCurrency(value: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(value);
}

export function formatNumber(value: number): string {
  return value.toLocaleString('en-US', { maximumFractionDigits: 0 });
}

export function parseNumber(value: string | number): number {
  if (typeof value === 'number') return value;
  const cleaned = value.replace(/[^0-9.-]/g, '');
  return parseFloat(cleaned) || 0;
}
