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
        display: ['"Fraunces"', 'serif'],
        sans: ['"Inter"', 'sans-serif'],
        mono: ['"IBM Plex Mono"', 'monospace'],
      },
      boxShadow: {
        ticket: '0 1px 2px rgba(20, 31, 36, 0.06), 0 4px 16px rgba(20, 31, 36, 0.06)',
      },
    },
  },
  plugins: [],
};
