/**
 * How a field collection is referred to out loud: SHINE01, SHINE02, SHINE100.
 *
 * The number stays an integer in the database — it is a counter, and making
 * it a string would mean sorting "SHINE10" before "SHINE9" and reinventing
 * the sequence by hand. The prefix is presentation, applied at both ends so
 * the yard, the printed sheet and the seller all say the same word.
 *
 * Two digits is the floor, not the ceiling: the hundredth collection is
 * SHINE100, not SHINE00.
 */
export const COLLECTION_PREFIX = 'SHINE';

export const collectionRef = (n) => `${COLLECTION_PREFIX}${String(n).padStart(2, '0')}`;

/**
 * The reverse, for search: "SHINE01", "shine1", "01" and "1" all mean 1.
 *
 * Somebody reading a reference off a phone screen will type it however it
 * suits them, and a search that only matched one spelling would look broken.
 *
 * @returns {number|null} null when the text is not a reference at all.
 */
export function parseCollectionRef(text) {
  const t = String(text ?? '').trim();
  const m = /^(?:shine[\s-]*)?0*(\d{1,9})$/i.exec(t);
  return m ? Number(m[1]) : null;
}
