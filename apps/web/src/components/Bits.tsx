import { useEffect, useRef } from 'react';

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

export function Tick() {
  return (
    <svg
      className="auth__tick"
      width="16"
      height="16"
      viewBox="0 0 18 18"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.9"
      strokeLinecap="round"
      aria-hidden="true"
    >
      <path d="M3.6 9.4 7 12.8l7.4-7.4" />
    </svg>
  );
}

export function Problem({ children }: { children: React.ReactNode }) {
  return (
    <div className="err" role="alert">
      {children}
    </div>
  );
}

/**
 * Six boxes over one real input. The input carries the value, so paste,
 * autofill and the on-screen keyboard all behave; the boxes are only paint.
 */
export function CodeInput({
  value,
  onChange,
  onComplete,
  disabled,
}: {
  value: string;
  onChange: (v: string) => void;
  onComplete?: (v: string) => void;
  disabled?: boolean;
}) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (!disabled) ref.current?.focus();
  }, [disabled]);

  return (
    <div className="codeboxes">
      {[0, 1, 2, 3, 4, 5].map((i) => (
        <div
          key={i}
          className="codebox"
          data-state={i < value.length ? 'filled' : i === value.length ? 'active' : 'empty'}
        >
          {value[i] ?? ''}
        </div>
      ))}
      <input
        ref={ref}
        className="code-capture"
        inputMode="numeric"
        autoComplete="one-time-code"
        maxLength={6}
        value={value}
        disabled={disabled}
        aria-label="Six-digit code"
        onChange={(e) => {
          const next = e.target.value.replace(/\D/g, '').slice(0, 6);
          onChange(next);
          if (next.length === 6) onComplete?.(next);
        }}
      />
    </div>
  );
}
