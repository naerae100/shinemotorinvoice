import { z } from 'zod';

/**
 * Field checks for the details that cost money when they are wrong.
 *
 * The bar is "this cannot be what you meant", not "this matches one format".
 * The yard trades with a dozen countries and a lot of walk-in sellers, so a
 * rule that only admits Australian conventions would block real records — the
 * phone check accepts any international number, and the postcode check only
 * applies where a postcode has a known shape.
 *
 * Every one of these is optional. A blank is always allowed; what is rejected
 * is a value that is present and cannot be right.
 */

const blankToNull = (v) => (typeof v === 'string' && v.trim() === '' ? null : v);

/** Wraps a check so blanks pass through untouched. */
function optionalString(check, message) {
  return z.preprocess(
    blankToNull,
    z
      .string()
      .trim()
      .refine(check, { message })
      .nullable()
      .optional()
  );
}

const digitsOnly = (s) => s.replace(/\D/g, '');

// ---------------------------------------------------------------------------

/**
 * A phone number, in any country's notation.
 *
 * Accepts digits, spaces, and the punctuation people actually type: + ( ) - . /
 * and "ext". Rejects anything with letters in it, which is what this exists for
 * — the field took "call the office" and printed it on a docket.
 */
export const phone = optionalString(
  (v) => {
    if (/[A-Za-z]/.test(v.replace(/\s*(ext|x)\.?\s*\d+$/i, ''))) return false;
    const d = digitsOnly(v);
    // E.164 allows 15 digits; 6 is shorter than any real number but long
    // enough to admit a local extension-style number someone insists on.
    return d.length >= 6 && d.length <= 15;
  },
  'Enter a phone number — digits, with + ( ) - and spaces if you like.'
);

/**
 * An ABN, checked against the ATO's own checksum rather than just its length.
 *
 * Eleven digits with one transposed still looks like an ABN, and it is copied
 * off a supplier's paperwork by hand onto a document the ATO may read. The
 * checksum catches almost every single-digit and transposition error, which
 * length alone does not.
 */
const ABN_WEIGHTS = [10, 1, 3, 5, 7, 9, 11, 13, 15, 17, 19];

export function isValidAbn(value) {
  const d = digitsOnly(String(value));
  if (d.length !== 11) return false;
  const digits = d.split('').map(Number);
  digits[0] -= 1; // the ATO's algorithm subtracts one from the leading digit
  const sum = digits.reduce((acc, n, i) => acc + n * ABN_WEIGHTS[i], 0);
  return sum % 89 === 0;
}

export const abn = optionalString(
  isValidAbn,
  'That is not a valid ABN. It is 11 digits, and this one fails the ATO check digit — worth re-reading off their paperwork.'
);

/**
 * A BSB: six digits, written with or without the dash.
 *
 * This is half of where the money goes, so a five-digit BSB is worth stopping
 * at the point someone types it rather than at the point a transfer bounces.
 */
export const bsb = optionalString(
  (v) => /^\d{3}-?\d{3}$/.test(v.replace(/\s/g, '')),
  'A BSB is six digits, like 032-372.'
);

/** An account number: digits, and enough of them to be one. */
export const accountNumber = optionalString(
  (v) => {
    const d = digitsOnly(v);
    return d.length >= 4 && d.length <= 12 && /^[\d\s-]+$/.test(v);
  },
  'An account number is between 4 and 12 digits.'
);

/**
 * A PayID is an email address or a mobile number — the two things the scheme
 * accepts — so it is checked as either rather than as free text.
 */
export const payId = optionalString(
  (v) => {
    if (v.includes('@')) return z.string().email().safeParse(v).success;
    const d = digitsOnly(v);
    return d.length >= 8 && d.length <= 15 && !/[A-Za-z]/.test(v);
  },
  'A PayID is an email address or a mobile number.'
);

/**
 * A postcode, checked only where its shape is known.
 *
 * Australian postcodes are four digits. Hong Kong has none at all, and the UK's
 * are alphanumeric, so anywhere else this only rejects something absurdly long.
 */
export const postcode = (countryKey = 'country') =>
  z.preprocess(blankToNull, z.string().trim().max(12).nullable().optional());

export function postcodeMatchesCountry(data) {
  const country = (data.country || '').trim().toLowerCase();
  const value = (data.postcode || '').trim();
  if (!value) return true;
  if (country === 'australia' || country === '') {
    return /^\d{4}$/.test(value);
  }
  return true;
}

/** An email, or nothing at all — plenty of walk-in sellers have none. */
export const optionalEmail = z.preprocess(
  blankToNull,
  z.string().trim().email('Enter a valid email address.').nullable().optional()
);
