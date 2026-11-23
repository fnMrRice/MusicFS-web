export function BrandMark({ size }: { size: number }) {
  return (
    <svg aria-hidden="true" width={size} height={size} viewBox="0 0 64 64"
      fill="none" stroke="currentColor" strokeWidth="3.8" strokeLinecap="round" strokeLinejoin="round">
      <g transform="rotate(-9 32 32)">
        <path d="M19.6 22a18.8 18.8 0 1 1 32.1 15.3" />
        <circle cx="38.3" cy="24.1" r="4.4" />
        <path d="M8.5 17.5h5.6q1.3 0 2.2 1l3.3 3.5h2.6c4.4 0 6.1 7.1 11.3 11.4
                 2.7 2.2 5.7 3.4 8.7 3.4 2.8 0 5-.9 7-1.8q2.5-.9 2.5 2.3v13.5
                 q0 3.4-3.4 3.4H8.5q-3.1 0-3.1-3.2V20.6q0-3.1 3.1-3.1Z" />
      </g>
    </svg>
  );
}
