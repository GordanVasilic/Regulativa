/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./index.html",
    "./src/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Inter', 'sans-serif'],
      },
      colors: {
        legalistik: {
          navy: '#0f172a',         // slate-900
          teal: '#0ea5e9',         // sky-500
          green: '#10b981',        // emerald-500
          amber: '#f59e0b',        // amber-500
          red: '#ef4444',          // red-500
          grayBg: '#f8fafc',       // slate-50
          cardBorder: '#e2e8f0',   // slate-200

          // Soft tints
          tealSoft: '#e0f2fe',     // sky-100
          amberSoft: '#fef3c7',    // amber-100
          greenSoft: '#d1fae5',    // emerald-100
          redSoft: '#fee2e2',      // red-100
          navySoft: '#f1f5f9',     // slate-100
        },
      },
      boxShadow: {
        'soft': '0 4px 6px -1px rgba(0, 0, 0, 0.05), 0 2px 4px -1px rgba(0, 0, 0, 0.03)',
        'glow': '0 0 15px rgba(14, 165, 233, 0.3)',
      },
      borderRadius: {
        'xl': '1rem',
        '2xl': '1.5rem',
      }
    },
  },
  plugins: [],
};