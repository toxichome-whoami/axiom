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
        background: 'var(--background, #09090b)',
        foreground: 'var(--foreground, #f4f4f5)',
        card: {
          DEFAULT: 'var(--card, #121214)',
          foreground: 'var(--card-foreground, #f4f4f5)',
        },
        popover: {
          DEFAULT: 'var(--popover, #121214)',
          foreground: 'var(--popover-foreground, #f4f4f5)',
        },
        primary: {
          DEFAULT: 'var(--primary, #ececef)',
          foreground: 'var(--primary-foreground, #09090b)',
        },
        secondary: {
          DEFAULT: 'var(--secondary, #18181b)',
          foreground: 'var(--secondary-foreground, #f4f4f5)',
        },
        muted: {
          DEFAULT: 'var(--muted, #18181b)',
          foreground: 'var(--muted-foreground, #71717a)',
        },
        accent: {
          DEFAULT: 'var(--accent, #262626)',
          foreground: 'var(--accent-foreground, #ffffff)',
          orange: '#f38020',
          blue: '#3b82f6',
          danger: '#ef4444',
          green: '#10b981',
        },
        destructive: {
          DEFAULT: 'var(--destructive, #ef4444)',
          foreground: 'var(--destructive-foreground, #ffffff)',
        },
        success: {
          DEFAULT: 'var(--success, #10b981)',
          foreground: 'var(--success-foreground, #34d399)',
        },
        warning: {
          DEFAULT: 'var(--warning, #f59e0b)',
          foreground: 'var(--warning-foreground, #fbbf24)',
        },
        info: {
          DEFAULT: 'var(--info, #3b82f6)',
          foreground: 'var(--info-foreground, #60a5fa)',
        },
        border: 'var(--border, #262626)',
        input: 'var(--input, #262626)',
        ring: 'var(--ring, #3b82f6)',
        sidebar: {
          DEFAULT: 'var(--sidebar, #171717)',
          foreground: 'var(--sidebar-foreground, #f4f4f5)',
          primary: 'var(--sidebar-primary, #ffffff)',
          'primary-foreground': 'var(--sidebar-primary-foreground, #171717)',
          accent: 'var(--sidebar-accent, #262626)',
          'accent-foreground': 'var(--sidebar-accent-foreground, #ffffff)',
          border: 'var(--sidebar-border, #262626)',
          ring: 'var(--sidebar-ring, #3b82f6)',
        },
        // Axiom convenience mappings
        brand: {
          DEFAULT: '#3b82f6',
          hover: '#2563eb',
          muted: 'rgba(59, 130, 246, 0.15)',
        },
        surfaceBorder: '#262626',
        surfaceHover: '#262626',
        borderDefault: '#262626',
        focusRing: '#3b82f6',
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
        lg: 'var(--radius, 0.5rem)',
        md: 'calc(var(--radius, 0.5rem) - 2px)',
        sm: 'calc(var(--radius, 0.5rem) - 4px)',
      },
    },
  },
  plugins: [],
};
