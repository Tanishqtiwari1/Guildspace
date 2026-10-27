/** Guildspace mark: shield + infinity loop, indigo → mint. */
export function Logo({ size = 36 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden="true" className="logo-mark">
      <defs>
        <linearGradient id="gs-grad" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#4338CA" />
          <stop offset="1" stopColor="#34D399" />
        </linearGradient>
      </defs>
      <rect width="64" height="64" rx="14" fill="#EEF2FF" />
      <path d="M14 14c12-4 24-4 36 0v16c0 12-8 20-18 26C22 50 14 42 14 30z" fill="none" stroke="url(#gs-grad)" strokeWidth="5" strokeLinejoin="round" />
      <path d="M20 32c0-5 4-8 8-5l8 10c4 3 8 0 8-5s-4-8-8-5l-8 10c-4 3-8 0-8-5z" fill="none" stroke="url(#gs-grad)" strokeWidth="4.5" strokeLinecap="round" />
    </svg>
  )
}

/** Material Symbols Outlined icon (font loaded in index.html). */
export function Icon({ name, fill = false, size, className = '', style }) {
  return (
    <span className={`msi ${className}`} aria-hidden="true"
      style={{ ...(size ? { fontSize: size } : {}), ...(fill ? { fontVariationSettings: "'FILL' 1" } : {}), ...style }}>
      {name}
    </span>
  )
}
