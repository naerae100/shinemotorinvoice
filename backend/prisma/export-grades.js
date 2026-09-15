/**
 * The export grade catalogue — the names the yard SELLS under, as published at
 * shinemotor.com.au/services/buy-from-us. These are trade grade names (mostly
 * ISRI), and they are what an overseas buyer's contract is written in, so they
 * are what has to appear on a packing list and a commercial invoice.
 *
 * Deliberately separate from the 33-item purchase price list: the same metal is
 * bought as "Copper Bright Wire" and sold as "Mill Berry".
 *
 * No prices. Export grades are priced per contract against the market on the
 * day, not off a standing list, so a price here would be wrong the moment it
 * was written. The invoice asks for the price per tonne on the line.
 *
 *   npm run seed:export-grades
 */
export const EXPORT_GRADES = [
  { category: 'Copper', description: 'Mill Berry' },
  { category: 'Copper', description: 'Candy' },
  { category: 'Copper', description: 'Birch Cliff' },
  { category: 'Copper', description: 'Ocean' },

  { category: 'Aluminium', description: 'Extruded' },
  { category: 'Aluminium', description: 'Tense' },
  { category: 'Aluminium', description: 'Talk' },
  { category: 'Aluminium', description: 'Troma' },

  { category: 'Brass', description: 'Honey' },
  { category: 'Brass', description: 'Night' },

  { category: 'Stainless steel', description: 'Stainless Steel 304' },
  { category: 'Stainless steel', description: 'Stainless Steel 316' },

  { category: 'Ferrous', description: 'Ferrous metal' },
  { category: 'Ferrous', description: 'HMS 1 & 2' },

  { category: 'Wiring', description: 'Insulated copper wire' },
  { category: 'Wiring', description: 'Druid' },
  { category: 'Wiring', description: 'Car wiring harness' },

  { category: 'Other', description: 'Lead' },
  { category: 'Other', description: 'Electric motors' },
  { category: 'Other', description: 'Starter motors & alternators' },
  { category: 'Other', description: 'Compressors' },
];
