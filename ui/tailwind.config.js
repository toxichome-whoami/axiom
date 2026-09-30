/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        brand: {
          DEFAULT: '#3b82f6',
          hover: '#2563eb',
          muted: 'rgba(59, 130, 246, 0.15)',
        },
        surface: {
          DEFAULT: '#0f0f0f',
          dark: '#0f0f0f',
        },
        base: {
          DEFAULT: '#000000',
          dark: '#000000',
        },
        elevated: {
          DEFAULT: '#161616',
          dark: '#161616',
        },
        border: {
          DEFAULT: '#222222',
          dark: '#222222',
        },
        background: '#000000',
        hairline: '#262626',
        accent: {
          DEFAULT: '#3b82f6',
          hover: '#2563eb',
          soft: 'rgba(59, 130, 246, 0.12)',
        },
        status: {
          green: '#30a46c',
          amber: '#f59e0b',
          red: '#e5484d',
        },
        primary: '#f3f4f6',
        secondary: '#8c8c8c',
        muted: '#555555',
      },
      fontFamily: {
        sans: [
          'Inter',
          '-apple-system',
          'BlinkMacSystemFont',
          'system-ui',
          'Segoe UI',
          'Roboto',
          'sans-serif',
        ],
        mono: [
          '"JetBrains Mono"',
          'Consolas',
          'Menlo',
          'monospace',
        ],
      },
      borderRadius: {
        none: '0',
        sm: '4px',
        DEFAULT: '6px',
        md: '6px',
        lg: '8px',
        xl: '8px',
        '2xl': '8px',
        '3xl': '8px',
        full: '9999px',
      },
    },
  },
  plugins: [],
}
