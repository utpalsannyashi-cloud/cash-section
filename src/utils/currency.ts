const formatterCache = new Map<string, Intl.NumberFormat>();

export function formatCurrency(amount: number, currency = 'INR'): string {
  let formatter = formatterCache.get(currency);
  if (!formatter) {
    formatter = new Intl.NumberFormat(currency === 'INR' ? 'en-IN' : 'en-US', {
      style: 'currency',
      currency,
      maximumFractionDigits: 2
    });
    formatterCache.set(currency, formatter);
  }
  return formatter.format(amount);
}

export function currencySymbol(currency = 'INR'): string {
  return formatCurrency(0, currency).replace(/[0-9.,\s]/g, '');
}
