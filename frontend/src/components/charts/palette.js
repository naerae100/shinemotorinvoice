/**
 * Chart palette.
 *
 * These are NOT the steel/* tokens. The steel ramp is a near-neutral blue-grey
 * (chroma ~0.05) which reads as grey when used as a chart mark and stops doing
 * identity work — it fails the chroma floor. These two were validated together
 * with the dataviz six-checks validator against a white card surface:
 *
 *   lightness band  PASS   both inside OKLCH L 0.43–0.77
 *   chroma floor    PASS   both >= 0.10
 *   CVD separation  PASS   ΔE 21.2 protanopia · 24.6 tritanopia
 *   normal vision   PASS   ΔE 26.6
 *   contrast        PASS   both >= 3:1 on #FFFFFF
 *
 * Assigned in fixed order and never cycled. Purchases is slot 1 because buying
 * scrap is the main business; the blue also echoes the wave in the logo.
 *
 * These two did NOT move when the interface palette was retuned from copper to
 * blue. Blue against orange is the canonical colour-vision-safe pair, and it is
 * the only thing separating purchases from sales for a viewer who cannot rely on
 * hue — the ΔE figures above are what that costs to give up. Recolouring sales to
 * match the new accent would have made the two series near-identical under
 * protanopia. Interface chrome and data marks are different jobs.
 */
export const SERIES = {
  purchases: '#2F6FB5',
  sales: '#C17A3D',
};

/**
 * Recessive chart furniture — one step off the surface, never competing with data.
 * Tracks the retuned steel ramp; the axis label in particular was #587485, which
 * no longer exists and was too faint to read a value against.
 */
export const CHART_INK = {
  grid: '#F1F5F9',   // steel-100
  axis: '#CBD5E1',   // one step lighter than steel-300: furniture, not data
  label: '#475569',  // steel-500 — 7.2:1, because axis labels are read
  strong: '#0F172A', // steel-900
  surface: '#FFFFFF',
};

/**
 * A compact axis figure.
 *
 * AUD keeps the bare dollar sign — it is the default and the axis is not the
 * place to restate it. Any other currency is named, because two panels stacked
 * in one figure, one in AUD and one in USD, both reading `$1.2k` would be a
 * chart that actively misleads.
 */
export const formatAxisMoney = (n, currency = 'AUD') => {
  const abs = Math.abs(n);
  // A non-breaking space, not a plain one. Recharts measures a tick against
  // the axis width and splits it at spaces when it does not fit, so "USD 400k"
  // came out as two stacked lines with the top one clipped by the panel above.
  const unit = currency === 'AUD' ? '$' : `${currency}\u00A0`;
  if (abs >= 1_000_000) return `${unit}${(n / 1_000_000).toFixed(abs >= 10_000_000 ? 0 : 1)}M`;
  if (abs >= 1_000) return `${unit}${(n / 1_000).toFixed(abs >= 10_000 ? 0 : 1)}k`;
  return `${unit}${n.toFixed(0)}`;
};

/**
 * Colours for the sales panels, one per currency.
 *
 * AUD keeps the validated sales orange. Anything else is a hue that stays
 * separable from both it and the purchases blue under protanopia — a teal, not
 * a second orange, so two sales panels are not told apart by brightness alone.
 */
export const CURRENCY_INK = {
  AUD: SERIES.sales,
  USD: '#1F8A70',
  NZD: '#7D4E9E',
  EUR: '#A8437B',
  GBP: '#4B6BAF',
};

/** Fallback for a currency not in the map above, stable for a given code. */
export const currencyColor = (code) =>
  CURRENCY_INK[code] ?? ['#1F8A70', '#7D4E9E', '#A8437B', '#4B6BAF', '#8A6A1F'][
    [...String(code)].reduce((a, c) => a + c.charCodeAt(0), 0) % 5
  ];

/** Clean axis ceiling — 1/2/5 × a power of ten, so ticks land on round numbers. */
export function niceCeiling(max) {
  if (max <= 0) return 1;
  const mag = 10 ** Math.floor(Math.log10(max));
  const norm = max / mag;
  const step = norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 5 ? 5 : 10;
  return step * mag;
}
