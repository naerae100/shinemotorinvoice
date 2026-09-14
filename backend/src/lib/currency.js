/**
 * The currencies an export invoice can be raised in.
 *
 * Amounts are never converted between them: a USD invoice is recorded, printed
 * and reported in USD only. That is why totals are summed per currency rather
 * than added together anywhere in the system.
 */
export const CURRENCIES = ['AUD', 'USD'];

export const isCurrency = (v) => CURRENCIES.includes(v);
