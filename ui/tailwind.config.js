/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,html}",
  ],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        background: '#1F1F1F',
        surface: '#262626',
        surfaceHover: '#333333',
        surfaceBorder: '#404040',
        primary: '#F5F5F5',
        secondary: '#A1A1A1',
        borderDefault: '#454545',
        focusRing: '#F59E0B',
        accent: {
          orange: '#F6821F',
          blue: '#4693FF',
          danger: '#AE292F',
          green: '#10B981',
        },
      },
      borderRadius: {
        md: '4px',
        lg: '6px',
      },
    },
  },
  plugins: [],
};
