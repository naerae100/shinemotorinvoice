/**
 * How a field collection is referred to out loud: SHINE01, SHINE02, SHINE100.
 *
 * Mirrors backend/src/lib/collectionRef.js. The number stays an integer on
 * the record — it is a counter — and the prefix is applied at both ends so
 * the yard, the printed sheet and the seller all say the same word.
 */
export const collectionRef = (n) => `SHINE${String(n).padStart(2, '0')}`;
