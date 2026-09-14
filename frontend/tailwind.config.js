/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        // Steel — the structural, near-black-blue of the identity
        steel: {
          950: '#141F24',
          900: '#1A2E35',
          800: '#22404A',
          700: '#2C525F',
          600: '#3D5A6C',
          500: '#587485',
          400: '#7D97A5',
          300: '#A9BCC5',
          200: '#D2DEE2',
          100: '#E9EFF1',
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
        // Copper — the accent, drawn from the material itself. Used sparingly.
        copper: {
          700: '#96552A',
          600: '#AD6530',
          500: '#C17A3D',
          400: '#D0935E',
          300: '#DFB086',
          100: '#F5E7D8',
        },
        // Paper — warm off-white background, not pure white
        paper: {
          DEFAULT: '#F7F5F1',
          dim: '#EFEBE4',
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
