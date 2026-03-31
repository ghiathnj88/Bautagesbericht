import type { Config } from 'tailwindcss';

export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        primary: {
          DEFAULT: '#C0392B',
          dark: '#922B21',
          light: '#E74C3C',
        },
        dark: {
          DEFAULT: '#1C1C1C',
          mid: '#2E2E2E',
        },
        mid: '#4A4A4A',
        light: '#F5F5F5',
        border: '#D5D5D5',
        success: '#27AE60',
        warning: '#E67E22',
        error: '#E74C3C',
      },
      fontFamily: {
        sans: ['Inter', 'Source Sans Pro', 'system-ui', 'sans-serif'],
      },
    },
  },
  plugins: [],
} satisfies Config;
