/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        surface: {
          DEFAULT: '#121216',
          light: '#15151a',
          dark: '#0d0d0f',
        },
        edge: '#232329',
        accent: {
          DEFAULT: '#4d6bfe',
          hover: '#3b58e0',
        },
      },
    },
  },
  plugins: [],
}
