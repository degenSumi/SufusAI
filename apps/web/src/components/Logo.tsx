interface LogoProps {
  className?: string;
}

// One inbound line forking to two agent nodes — the routing model, reduced.
export function Logo({ className = "h-4 w-4" }: LogoProps) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden="true">
      <path
        fill="none"
        stroke="currentColor"
        strokeWidth={2.8}
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M3.6 12h6.2c3.2 0 3.2-5.4 6.4-5.4M9.8 12c3.2 0 3.2 5.4 6.4 5.4"
      />
      <circle cx="18.8" cy="6.6" r="2.4" fill="currentColor" />
      <circle cx="18.8" cy="17.4" r="2.4" fill="currentColor" />
    </svg>
  );
}
