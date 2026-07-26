/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // Every token resolves through a CSS variable (see src/index.css)
        // so the app can switch between dark and light mode by flipping
        // the [data-theme] attribute on <html> — no component changes
        // needed. Values are stored as "R G B" triplets so Tailwind's
        // opacity modifiers (e.g. bg-emerald/10) keep working via the
        // <alpha-value> placeholder. Token names (paper/ink/emerald/
        // brick/violet/amber/rule) are kept as-is so every component that
        // already references them just picks up each theme automatically.
        // brick/violet/amber are intentionally monochrome (green/white/
        // gray only, no red/purple/gold) per the app's current palette.
        paper: {
          DEFAULT: 'rgb(var(--color-paper) / <alpha-value>)',
          dim: 'rgb(var(--color-paper-dim) / <alpha-value>)',
          card: 'rgb(var(--color-paper-card) / <alpha-value>)'
        },
        ink: {
          DEFAULT: 'rgb(var(--color-ink) / <alpha-value>)',
          soft: 'rgb(var(--color-ink-soft) / <alpha-value>)',
          faint: 'rgb(var(--color-ink-faint) / <alpha-value>)'
        },
        emerald: {
          DEFAULT: 'rgb(var(--color-emerald) / <alpha-value>)',
          dark: 'rgb(var(--color-emerald-dark) / <alpha-value>)',
          light: 'rgb(var(--color-emerald-light) / <alpha-value>)'
        },
        brick: {
          DEFAULT: 'rgb(var(--color-brick) / <alpha-value>)',
          light: 'rgb(var(--color-brick-light) / <alpha-value>)'
        },
        violet: {
          DEFAULT: 'rgb(var(--color-violet) / <alpha-value>)',
          dark: 'rgb(var(--color-violet-dark) / <alpha-value>)',
          light: 'rgb(var(--color-violet-light) / <alpha-value>)'
        },
        amber: {
          DEFAULT: 'rgb(var(--color-amber) / <alpha-value>)',
          dark: 'rgb(var(--color-amber-dark) / <alpha-value>)',
          light: 'rgb(var(--color-amber-light) / <alpha-value>)'
        },
        rule: 'rgb(var(--color-rule) / <alpha-value>)',
        // Stat-card accents only — four distinct hues, themed via CSS
        // variables like every other token (see src/index.css). These are
        // the one deliberate exception to the monochrome note above: the
        // four summary tiles are only tellable apart at a glance if their
        // left borders are genuinely different colours.
        accent: {
          green: 'rgb(var(--color-accent-green) / <alpha-value>)',
          violet: 'rgb(var(--color-accent-violet) / <alpha-value>)',
          amber: 'rgb(var(--color-accent-amber) / <alpha-value>)',
          sky: 'rgb(var(--color-accent-sky) / <alpha-value>)'
        }
      },
      fontFamily: {
        sans: ['"IBM Plex Sans"', 'system-ui', 'sans-serif'],
        mono: ['"IBM Plex Mono"', 'ui-monospace', 'monospace']
      },
      // One radius scale, so cards, buttons, inputs and pills stop
      // disagreeing (the app previously mixed 4px, rounded-lg and 2xl).
      borderRadius: {
        sm: '4px',
        DEFAULT: '6px',
        md: '6px',
        lg: '10px',
        xl: '14px'
      },
      backgroundImage: {
        perforation:
          'repeating-linear-gradient(to right, transparent 0 6px, rgb(var(--color-rule)) 6px 8px)'
      },
      boxShadow: {
        glow: '0 0 0 1px rgb(var(--color-emerald) / 0.4), 0 8px 24px -8px rgb(var(--color-emerald) / 0.35)',
        glowViolet: '0 0 0 1px rgb(var(--color-violet) / 0.5), 0 8px 24px -8px rgb(var(--color-violet) / 0.45)',
        glowBrick: '0 0 0 1px rgb(var(--color-brick) / 0.55), 0 8px 24px -8px rgb(var(--color-brick) / 0.45)',
        // Neutral elevation for things that genuinely float (the FAB,
        // sheets). Preferred over the coloured glows above, which read as
        // decoration rather than depth.
        card: '0 1px 2px rgb(0 0 0 / 0.04)',
        lift: '0 1px 2px rgb(0 0 0 / 0.08), 0 10px 24px -14px rgb(0 0 0 / 0.45)'
      }
    }
  },
  plugins: []
};
