export function Mark({ size = 22 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 20 20"
      fill="none"
      stroke="var(--need)"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="1.8" y="3.2" width="16.4" height="13.6" rx="3" />
      <path d="M6.4 8.2 8.8 10.2 6.4 12.2" />
      <path d="M10.8 12.6h3" />
    </svg>
  );
}

export function Brand() {
  return (
    <div className="brand">
      <Mark />
      <span>
        claude<span style={{ color: 'var(--ink-4)' }}>·</span>remote
      </span>
    </div>
  );
}

export function Problem({ children }: { children: React.ReactNode }) {
  return (
    <div className="err" role="alert">
      {children}
    </div>
  );
}
