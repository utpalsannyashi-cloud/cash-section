/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // Dark navy + electric blue theme. Token names (paper/ink/emerald/
        // brick/rule) are kept as-is so every component that already
        // references them just picks up the new palette automatically.
        paper: {
          DEFAULT: '#0F172A',
          dim: '#0B1220',
          card: '#1E293B'
        },
        ink: {
          DEFAULT: '#E2E8F0',
          soft: '#94A3B8',
          faint: '#64748B'
        },
        emerald: {
          DEFAULT: '#3B82F6',
          dark: '#2563EB',
          light: '#1E3A5F'
        },
        brick: {
          DEFAULT: '#F87171',
          light: '#3F1D1D'
        },
        rule: '#27364A'
      },
      fontFamily: {
        sans: ['"IBM Plex Sans"', 'system-ui', 'sans-serif'],
        mono: ['"IBM Plex Mono"', 'ui-monospace', 'monospace']
      },
      backgroundImage: {
        perforation:
          'repeating-linear-gradient(to right, transparent 0 6px, #27364A 6px 8px)'
      }
    }
  },
  plugins: []
};
