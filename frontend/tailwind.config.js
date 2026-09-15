/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        // Steel — the interface neutral, and now the same slate ramp the
        // printed documents use, so screen and paper are one visual language.
        //
        // The old ramp was a blue-grey mixed to look calm, and its light end
        // could not be read: #7D97A5 on the warm paper ground measured about
        // 2.5:1, and #587485 about 4.0:1, against the 4.5:1 that normal text
        // has to meet. Between them those two tokens carried 190 pieces of real
        // text — dates, counts, captions, table labels — so most of the words in
        // the app were below the readable floor. Every step from 400 down is
        // darkened to clear it; the dark end barely moves, so headings and
        // solid fills look as they did.
        steel: {
          950: '#020617',
          900: '#0F172A',
          800: '#1E293B',
          700: '#334155',
          600: '#475569', // 7.4:1 on the page ground
          500: '#475569', // was #587485 at 4.0:1 — the most-used text colour
          400: '#64748B', // was #7D97A5 at 2.5:1
          300: '#94A3B8', // decorative only: rules, disabled, placeholder
          200: '#E2E8F0',
          100: '#F1F5F9',
        },
        // Ink — the neutral the document is built on. Deep, slightly blue-black
        // slate rather than pure black: on paper it reads as considered, where
        // #000 reads as a photocopy.
        ink: {
          950: '#0B1220',
          900: '#0F172A',
          800: '#1E293B',
          700: '#334155',
          600: '#475569',
          500: '#64748B',
          400: '#94A3B8',
          300: '#CBD5E1',
          200: '#E2E8F0',
          100: '#F1F5F9',
          50: '#F8FAFC',
        },
        // Brand — one accent blue, used only for labels, the title and the
        // totals plate. Deliberately NOT the logo's #0000B0: that electric blue
        // is right for signage and too loud for a page of figures.
        brand: {
          800: '#1E40AF',
          700: '#1D4ED8',
          600: '#2563EB',
          500: '#3B82F6',
          400: '#60A5FA',
          300: '#93C5FD',
          200: '#BFDBFE',
          100: '#DBEAFE',
          50: '#EFF6FF',
        },
        // Reserved for void stamps and genuine warnings.
        flag: {
          700: '#B91C1C',
          600: '#DC2626',
          500: '#EF4444',
          100: '#FEE2E2',
          50: '#FEF2F2',
        },
        // Copper — kept as a token name because ~110 places use it, but retuned
        // from orange to the identity's blue.
        //
        // A saturated orange accent on a warm cream ground is the combination
        // that glares: both are warm, so nothing recedes and the eye has no
        // rest. Blue is also what the company actually is — it is the logo's
        // colour, and the documents already label in it. Buttons built on this
        // now carry white text rather than near-black; see index.css.
        copper: {
          700: '#1D4ED8',
          600: '#2563EB',
          500: '#2563EB',
          400: '#1D4ED8', // hover: darker, not lighter, so it reads as pressed
          300: '#93C5FD',
          100: '#DBEAFE',
          50: '#EFF6FF',
        },
        // Paper — the page ground. Was a warm cream (#F7F5F1); now a neutral
        // cool off-white. The warm cast is what made grey text on it muddy, and
        // it is what the printed documents sit on, which are white.
        paper: {
          DEFAULT: '#F8FAFC',
          dim: '#F1F5F9',
        },
        // Working states
        working: {
          green: '#2F9E44',
          greenDim: '#E7F5EA',
          red: '#C0392B',
          redDim: '#FBEAE7',
          amber: '#B8862B',
          amberDim: '#F8F0DF',
        },
      },
      fontSize: {
        // Only the small end is retuned. Nearly every label, caption, table cell
        // and helper line in the app is `text-xs` or `text-sm`, and at 12px they
        // were both small and — in the greys above — faint. A point on each,
        // with more leading, is the difference between scanning and squinting.
        xs: ['0.8125rem', { lineHeight: '1.15rem' }], // 13px, was 12
        sm: ['0.90625rem', { lineHeight: '1.35rem' }], // 14.5px, was 14
        base: ['1rem', { lineHeight: '1.55rem' }],
      },
      fontFamily: {
        // One family throughout. Outfit's geometry went chunky at the weights a
        // document needs; Plus Jakarta Sans stays even from 400 to 600, which is
        // what lets weight alone carry the hierarchy.
        display: ['"Plus Jakarta Sans"', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        sans: ['"Plus Jakarta Sans"', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        // Figures must align in a column, so the numeric face stays monospaced.
        mono: ['"JetBrains Mono"', 'ui-monospace', 'monospace'],
      },
      boxShadow: {
        ticket: '0 1px 2px rgba(20, 31, 36, 0.06), 0 4px 16px rgba(20, 31, 36, 0.06)',
      },
    },
  },
  plugins: [],
};
