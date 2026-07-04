/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        paper: {
          DEFAULT: '#F3F5F0',
          dim: '#EAEDE5',
          card: '#FBFBF8'
        },
        ink: {
          DEFAULT: '#1F2A24',
          soft: '#4A554E',
          faint: '#8A9089'
        },
        emerald: {
          DEFAULT: '#2F6B4F',
          dark: '#234F3A',
          light: '#E4EDE7'
        },
        brick: {
          DEFAULT: '#B23A48',
          light: '#F5E4E4'
        },
        rule: '#D8D5C9'
      },
      fontFamily: {
        sans: ['"IBM Plex Sans"', 'system-ui', 'sans-serif'],
        mono: ['"IBM Plex Mono"', 'ui-monospace', 'monospace']
      },
      backgroundImage: {
        perforation:
          'repeating-linear-gradient(to right, transparent 0 6px, #D8D5C9 6px 8px)'
      }
    }
  },
  plugins: []
};
