import type { SessionStatus } from '@claude-remote/shared';

/* Icons and atoms, lifted from design/prototype.html so the app and the
   prototype look like one thing rather than two. */

export function Mark({ size = 20 }: { size?: number }) {
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
    <span className="brand">
      <Mark />
      <span className="brand__word">
        claude<i>·</i>remote
      </span>
    </span>
  );
}

export function Warn() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      stroke="var(--need)"
      strokeWidth="1.6"
      strokeLinecap="round"
      aria-hidden="true"
    >
      <path d="M8 2.6 14.4 13.4H1.6L8 2.6Z" />
      <path d="M8 6.6v3" />
      <path d="M8 11.4h.01" />
    </svg>
  );
}

export function Check() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 18 18"
      fill="none"
      stroke="var(--done)"
      strokeWidth="1.8"
      strokeLinecap="round"
      aria-hidden="true"
    >
      <path d="M3.6 9.4 7 12.8l7.4-7.4" />
    </svg>
  );
}

export function Plus() {
  return (
    <svg
      width="15"
      height="15"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.9"
      strokeLinecap="round"
      aria-hidden="true"
    >
      <path d="M8 3.2v9.6M3.2 8h9.6" />
    </svg>
  );
}

export function Back() {
  return (
    <svg
      width="17"
      height="17"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      aria-hidden="true"
    >
      <path d="M9.6 3.6 5.2 8l4.4 4.4" />
    </svg>
  );
}

export function Folder() {
  return (
    <svg
      width="15"
      height="15"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M1.8 4.2a1 1 0 0 1 1-1h3l1.4 1.6h5a1 1 0 0 1 1 1v6.4a1 1 0 0 1-1 1h-9.4a1 1 0 0 1-1-1V4.2Z" />
    </svg>
  );
}

/** A folder with a .git is almost always the thing someone means by "project". */
export function Git() {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      aria-hidden="true"
    >
      <circle cx="4.6" cy="4" r="1.8" />
      <circle cx="4.6" cy="12" r="1.8" />
      <circle cx="11.4" cy="8" r="1.8" />
      <path d="M4.6 5.8v4.4" />
      <path d="M9.6 8H8.2a3.6 3.6 0 0 1-3.6-3.6" />
    </svg>
  );
}

export function Trash() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M2.8 4.4h10.4" />
      <path d="M6.2 4.4V3.2a.8.8 0 0 1 .8-.8h2a.8.8 0 0 1 .8.8v1.2" />
      <path d="M4.2 4.4l.6 8a1 1 0 0 0 1 .9h4.4a1 1 0 0 0 1-.9l.6-8" />
    </svg>
  );
}

export function Chev({ down }: { down?: boolean }) {
  return (
    <svg
      width="11"
      height="11"
      viewBox="0 0 12 12"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      aria-hidden="true"
    >
      {down ? <path d="M2.8 4 6 7.6 9.2 4" /> : <path d="M4 2.8 7.6 6 4 9.2" />}
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

/** The one place a status becomes a colour, so nothing can disagree. */
export function railColour(s: SessionStatus): string {
  return s === 'waiting'
    ? 'var(--need)'
    : s === 'working'
      ? 'var(--work)'
      : s === 'done'
        ? 'var(--done)'
        : s === 'failed'
          ? 'var(--fail)'
          : 'var(--line-strong)';
}

const PILL: Record<SessionStatus, [string, string, boolean]> = {
  waiting: ['pill--need', 'Waiting on you', true],
  working: ['pill--work', 'Working', true],
  done: ['pill--done', 'Done', false],
  failed: ['pill--fail', 'Failed', false],
  starting: ['pill--work', 'Starting', true],
  ended: ['pill--stop', 'Ended', false],
};

export function Pill({ status, extra }: { status: SessionStatus; extra?: string }) {
  const [cls, label, pulse] = PILL[status];
  return (
    <span className={`pill ${cls}`}>
      {pulse && <span className="dot dot--pulse" style={{ background: 'currentColor' }} />}
      {label}
      {extra ? <span className="num"> {extra}</span> : null}
    </span>
  );
}
