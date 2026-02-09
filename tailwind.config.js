/** @type {import('tailwindcss').Config} */
export default {
  content: ['./src/renderer/**/*.{html,jsx,js}'],
  theme: {
    extend: {
      colors: {
        bg: '#ffffff',
        surface: '#f5f5f7',
        border: '#e5e5ea',
        muted: '#86868b',
        label: '#6e6e73',
        accent: '#0071e3',
      },
    },
  },
  plugins: [],
};
