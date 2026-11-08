/** Ration mark: a gauge split into slices, with a needle. Original artwork. */
export function Mark({ size = 34 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 40 40" role="img" aria-label="Ration">
      <rect width="40" height="40" rx="12" fill="#0E1411" />
      <g fill="none" stroke="#B8F23A" strokeWidth="4.2" strokeLinecap="round">
        <path d="M7.4 27.2A13.6 13.6 0 0 1 9.6 15.6" />
        <path d="M12.6 11.7A13.6 13.6 0 0 1 21.3 7.5" strokeOpacity="0.9" />
        <path d="M25.6 8.2A13.6 13.6 0 0 1 32.6 15.4" strokeOpacity="0.9" />
        <path d="M34.1 20.7A13.6 13.6 0 0 1 32.9 27.6" strokeOpacity="0.45" />
      </g>
      <g transform="rotate(38 20 27)">
        <rect x="18.5" y="13" width="3" height="14.5" rx="1.5" fill="#F2F4F3" />
      </g>
      <circle cx="20" cy="27" r="3.4" fill="#F2F4F3" />
    </svg>
  );
}

export function Logo({ size = 34, word = true }: { size?: number; word?: boolean }) {
  return (
    <>
      <Mark size={size} />
      {word && <span>Ration</span>}
    </>
  );
}
