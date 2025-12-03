// Currency Configuration and Utilities

export const CURRENCY = 'AED';
export const CURRENCY_SYMBOL = 'AED';

/**
 * Format a number as currency with AED
 * @param amount - The amount to format
 * @param includeSymbol - Whether to include the currency symbol (default: true)
 * @returns Formatted currency string
 */
export function formatCurrency(amount: number, includeSymbol: boolean = true): string {
    const formatted = amount.toLocaleString('en-AE', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
    });

    return includeSymbol ? `${CURRENCY_SYMBOL} ${formatted}` : formatted;
}

/**
 * Parse a currency string to a number
 * @param currencyString - The currency string to parse
 * @returns The parsed number
 */
export function parseCurrency(currencyString: string): number {
    const cleaned = currencyString.replace(/[^0-9.-]+/g, '');
    return parseFloat(cleaned) || 0;
}

/**
 * Format currency for display in tables (shorter format)
 * @param amount - The amount to format
 * @returns Formatted currency string
 */
export function formatCurrencyCompact(amount: number): string {
    if (amount >= 1000000) {
        return `${CURRENCY_SYMBOL} ${(amount / 1000000).toFixed(1)}M`;
    }
    if (amount >= 1000) {
        return `${CURRENCY_SYMBOL} ${(amount / 1000).toFixed(1)}K`;
    }
    return formatCurrency(amount);
}

/**
 * Calculate percentage of total
 * @param part - The part amount
 * @param total - The total amount
 * @returns Percentage string
 */
export function calculatePercentage(part: number, total: number): string {
    if (total === 0) return '0%';
    return `${((part / total) * 100).toFixed(1)}%`;
}

/**
 * Add tax to an amount
 * @param amount - The base amount
 * @param taxRate - The tax rate (default: 5% VAT in UAE)
 * @returns Amount with tax
 */
export function addTax(amount: number, taxRate: number = 0.05): number {
    return amount * (1 + taxRate);
}

/**
 * Calculate tax amount
 * @param amount - The base amount
 * @param taxRate - The tax rate (default: 5% VAT in UAE)
 * @returns Tax amount
 */
export function calculateTax(amount: number, taxRate: number = 0.05): number {
    return amount * taxRate;
}
