/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx,html}",
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
          DEFAULT: '#ffffff',
          dark: '#0f0f0f',
        },
        base: {
          DEFAULT: '#f8fafc',
          dark: '#000000',
        },
        elevated: {
          DEFAULT: '#f1f5f9',
          dark: '#161616',
        },
        border: {
          DEFAULT: '#e2e8f0',
          dark: '#222222',
        },
        // Axiom convenience and backward compatibility mappings
        background: '#000000',
        surfaceBorder: '#222222',
        surfaceHover: '#161616',
        borderDefault: '#262626',
        primary: '#f3f4f6',
        secondary: '#8c8c8c',
        focusRing: '#3b82f6',
        accent: {
          orange: '#f38020',
          blue: '#3b82f6',
          danger: '#ef4444',
          green: '#10b981',
        },
      },
      fontFamily: {
        sans: [
          'Inter',
          '-apple-system',
          'BlinkMacSystemFont',
          'system-ui',
          'sans-serif',
        ],
        mono: [
          '"JetBrains Mono"',
          'Consolas',
          'monospace',
        ],
      },
      borderRadius: {
        md: '6px',
        lg: '8px',
      },
    },
  },
  plugins: [],
};
