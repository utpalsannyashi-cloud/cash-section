/**
 * Inline SVG icon set.
 *
 * Replaces the emoji that were previously used as interface icons (🔒 ⏳ 🚫
 * ✦ ☀️ 🌙 ×). Emoji render at different sizes, weights and colours on every
 * operating system and can't inherit currentColor, which is the single most
 * visible source of inconsistency in the UI.
 *
 * Deliberately dependency-free: one file, one map of paths, ~1KB. All icons
 * are drawn on the same 24x24 grid with a 1.75 stroke so they sit together
 * evenly, and they inherit colour from the parent via currentColor.
 *
 * <Icon name="lock" /> // 20px, inherits colour
 * <Icon name="spark" size={22} />
 * <Icon name="close" className="…" />
 *
 * Icons are decorative by default (aria-hidden). Pass a `label` only when
 * the icon is the sole content of a control and nothing else names it.
 */

export type IconName =
  | 'lock'
  | 'clock'
  | 'ban'
  | 'spark'
  | 'sun'
  | 'moon'
  | 'close'
  | 'check'
  | 'arrowLeft'
  | 'plus'
  | 'users'
  | 'receipt'
  | 'bell';

// Stroked paths only, so every icon responds to strokeWidth uniformly.
const PATHS: Record<IconName, string> = {
  lock: 'M7 11V8a5 5 0 0 1 10 0v3M6 11h12v9H6z',
  clock: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 7.5V12l3 2',
  ban: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM5.6 5.6l12.8 12.8',
  spark: 'M12 3.5l1.9 5.1 5.1 1.9-5.1 1.9L12 17.5l-1.9-5.1L5 10.5l5.1-1.9z',
  sun: 'M12 16.5a4.5 4.5 0 1 0 0-9 4.5 4.5 0 0 0 0 9zM12 2.5v2M12 19.5v2M4.5 12h-2M21.5 12h-2M6.7 6.7L5.3 5.3M18.7 18.7l-1.4-1.4M6.7 17.3l-1.4 1.4M18.7 5.3l-1.4 1.4',
  moon: 'M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5z',
  close: 'M6 6l12 12M18 6L6 18',
  check: 'M5 12.5l4.5 4.5L19 7.5',
  arrowLeft: 'M19 12H5M11 6l-6 6 6 6',
  plus: 'M12 5v14M5 12h14',
  users: 'M9 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7zM2.5 20c0-3.3 2.9-5.5 6.5-5.5s6.5 2.2 6.5 5.5M16 4.6a3.5 3.5 0 0 1 0 6.8M18 14.8c2.1.7 3.5 2.4 3.5 5.2',
  receipt: 'M6 3.5h12v17l-3-1.5-3 1.5-3-1.5-3 1.5zM9.5 8h5M9.5 12h5',
  bell: 'M6 8a6 6 0 1 1 12 0c0 3.6 1 5.6 1.8 6.7a.6.6 0 0 1-.5 1H4.7a.6.6 0 0 1-.5-1C5 13.6 6 11.6 6 8zM9.5 18.5a2.5 2.5 0 0 0 5 0'
};

export function Icon({
  name,
  size = 20,
  strokeWidth = 1.75,
  className,
  label
}: {
  name: IconName;
  size?: number;
  strokeWidth?: number;
  className?: string;
  label?: string;
}) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      // Sizing is driven by width/height rather than font-size so an icon
      // never inherits a stray text-2xl from a parent.
      style={{ flexShrink: 0 }}
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      focusable="false"
    >
      <path d={PATHS[name]} />
    </svg>
  );
}
