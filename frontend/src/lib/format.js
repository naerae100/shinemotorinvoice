export const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

export function formatAud(n) {
  return new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD' }).format(
    Number(n) || 0
  );
}

/** Plain grouped number — for weights and quantities, where a currency symbol would be wrong. */
export function formatNumber(n, dp = 2) {
  return new Intl.NumberFormat('en-AU', {
    minimumFractionDigits: dp,
    maximumFractionDigits: dp,
  }).format(Number(n) || 0);
}

const ONES = [
  '', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine',
  'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen',
  'Seventeen', 'Eighteen', 'Nineteen',
];
const TENS = [
  '', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety',
];
const SCALES = [
  { value: 1_000_000_000, name: 'Billion' },
  { value: 1_000_000, name: 'Million' },
  { value: 1_000, name: 'Thousand' },
];

/** 0–999 into words. */
function chunkToWords(n) {
  const parts = [];
  if (n >= 100) {
    parts.push(ONES[Math.floor(n / 100)], 'Hundred');
    n %= 100;
    if (n > 0) parts.push('and');
  }
  if (n >= 20) {
    const tens = TENS[Math.floor(n / 10)];
    const ones = ONES[n % 10];
    parts.push(ones ? `${tens}-${ones}` : tens);
  } else if (n > 0) {
    parts.push(ONES[n]);
  }
  return parts.join(' ');
}

function integerToWords(n) {
  if (n === 0) return 'Zero';
  const parts = [];
  let hasLargerGroup = false;
  for (const { value, name } of SCALES) {
    if (n >= value) {
      parts.push(chunkToWords(Math.floor(n / value)), name);
      n %= value;
      hasLargerGroup = true;
    }
  }
  if (n > 0) {
    // Australian/British usage joins a trailing sub-hundred remainder with "and":
    // "one thousand and fifty-three", not "one thousand fifty-three". A remainder
    // of 100+ already gets its own "and" from chunkToWords.
    if (hasLargerGroup && n < 100) parts.push('and');
    parts.push(chunkToWords(n));
  }
  return parts.join(' ');
}

/**
 * Renders an amount the way a commercial invoice states it, as a check against
 * the figures being altered after issue. e.g.
 *   188600    → "AUD One Hundred and Eighty-Eight Thousand Six Hundred Dollars Only"
 *   1234.56   → "AUD One Thousand Two Hundred and Thirty-Four Dollars and Fifty-Six Cents Only"
 */
export function amountInWords(amount, currency = 'AUD') {
  const value = Number(amount) || 0;
  const negative = value < 0;
  const abs = Math.abs(value);

  const dollars = Math.floor(abs);
  // Round the remainder rather than truncating, so 0.999 reads as one dollar, not 99 cents.
  const cents = Math.round((abs - dollars) * 100);
  const carried = cents === 100;

  const whole = carried ? dollars + 1 : dollars;
  const remainder = carried ? 0 : cents;

  let words = `${integerToWords(whole)} Dollar${whole === 1 ? '' : 's'}`;
  if (remainder > 0) {
    words += ` and ${integerToWords(remainder)} Cent${remainder === 1 ? '' : 's'}`;
  }

  return `${negative ? 'Minus ' : ''}${currency} ${words} Only`;
}
