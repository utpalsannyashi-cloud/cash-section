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
        violet: {
          DEFAULT: '#8B5CF6',
          dark: '#7C3AED',
          light: '#2E1F5E'
        },
        amber: {
          DEFAULT: '#F59E0B',
          dark: '#D97706',
          light: '#4A3111'
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
      },
      boxShadow: {
        glow: '0 0 0 1px rgba(59,130,246,0.4), 0 8px 24px -8px rgba(59,130,246,0.35)',
        glowViolet: '0 0 0 1px rgba(139,92,246,0.5), 0 8px 24px -8px rgba(139,92,246,0.45)',
        glowBrick: '0 0 0 1px rgba(248,113,113,0.55), 0 8px 24px -8px rgba(248,113,113,0.45)'
      }
    }
  },
  plugins: []
};
