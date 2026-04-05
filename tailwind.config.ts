import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        brand: {
          50: '#eef7ff',
          100: '#d9ecff',
          200: '#bcdfff',
          300: '#8eccff',
          400: '#59afff',
          500: '#338cff',
          600: '#1b6bf5',
          700: '#1455e1',
          800: '#1745b6',
          900: '#193d8f',
          950: '#142757',
        },
        charge: { DEFAULT: '#22c55e', dark: '#16a34a' },
        discharge: { DEFAULT: '#f97316', dark: '#ea580c' },
        critical: { DEFAULT: '#ef4444', dark: '#dc2626' },
        surface: {
          0: '#ffffff',
          1: '#f8fafc',
          2: '#f1f5f9',
          3: '#e2e8f0',
        },
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
        mono: ['JetBrains Mono', 'Fira Code', 'monospace'],
      },
    },
  },
  plugins: [],
};

export default config;
