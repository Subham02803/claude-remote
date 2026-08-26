import { useEffect, useRef, useState } from 'react';
import { api } from '../api.js';

/**
 * The prompt box, shared by the terminal and the chat.
 *
 * Scope §5.1: typing a long prompt on a phone inside an xterm is miserable, so
 * there is a real text box instead. Images work the same way for the same
 * reason — a screenshot is the fastest way to say what is wrong, and there is
 * no other way to get one into a session from a phone.
 *
 * An attached image is uploaded the moment it is picked, not when Send is
 * pressed. A failed upload is then a chip that says so, next to a prompt you
 * have not lost, rather than a Send that half-worked.
 */

/** Matches the server, which is the one that actually enforces both. */
const MAX_IMAGES = 5;
const MAX_BYTES = 10_000_000;

interface Attachment {
  key: string;
  /** Local preview; no round trip to show what you just picked. */
  preview: string;
  /** The name the server minted, once it has one. */
  name: string | null;
  state: 'uploading' | 'ready' | 'failed';
  note: string;
}

export function Composer({
  sessionId,
  live,
  placeholder,
  offlinePlaceholder,
  onSent,
}: {
  sessionId: string;
  live: boolean;
  placeholder: string;
  offlinePlaceholder: string;
  /**
   * Called once the prompt is in. The session does not report itself as
   * working until Claude's own hook says so, and whoever pressed Send should
   * not have to sit through that gap wondering — see Chat's working line.
   */
  onSent?: () => void;
}) {
  const [draft, setDraft] = useState('');
  const [shots, setShots] = useState<Attachment[]>([]);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const picker = useRef<HTMLInputElement>(null);

  // Object URLs are not garbage: the browser holds the blob until they are
  // revoked, and a session spent pasting screenshots would keep every one.
  const live_ = useRef<string[]>([]);
  live_.current = shots.map((s) => s.preview);
  useEffect(() => {
    return () => {
      for (const url of live_.current) URL.revokeObjectURL(url);
    };
  }, []);

  async function attach(files: File[]) {
    const images = files.filter((f) => f.type.startsWith('image/'));
    if (!images.length) return;
    setError(null);

    const room = MAX_IMAGES - shots.length;
    if (room <= 0) {
      setError(`That is as many images as one prompt can carry (${MAX_IMAGES}).`);
      return;
    }
    const taking = images.slice(0, room);
    if (taking.length < images.length) {
      setError(`Only the first ${room} went on; a prompt carries ${MAX_IMAGES}.`);
    }

    for (const file of taking) {
      const key = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const preview = URL.createObjectURL(file);
      setShots((prev) => [...prev, { key, preview, name: null, state: 'uploading', note: '' }]);

      const settle = (patch: Partial<Attachment>) =>
        setShots((prev) => prev.map((s) => (s.key === key ? { ...s, ...patch } : s)));

      if (file.size > MAX_BYTES) {
        settle({ state: 'failed', note: 'too big' });
        continue;
      }
      try {
        const { upload } = await api.uploadImage(sessionId, file);
        settle({ name: upload.name, state: 'ready', note: '' });
      } catch (err) {
        settle({ state: 'failed', note: err instanceof Error ? err.message : 'upload failed' });
      }
    }
  }

  function drop(key: string) {
    setShots((prev) => {
      const gone = prev.find((s) => s.key === key);
      if (gone) URL.revokeObjectURL(gone.preview);
      return prev.filter((s) => s.key !== key);
    });
  }

  const ready = shots.filter((s) => s.state === 'ready');
  const busy = shots.some((s) => s.state === 'uploading');
  const sendable = live && !sending && !busy && (Boolean(draft.trim()) || ready.length > 0);

  async function send() {
    if (!sendable) return;
    setSending(true);
    setError(null);
    try {
      await api.sendPrompt(
        sessionId,
        draft.trim(),
        ready.map((s) => s.name as string),
      );
      setDraft('');
      for (const s of shots) URL.revokeObjectURL(s.preview);
      setShots([]);
      onSent?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not send that.');
    } finally {
      setSending(false);
    }
  }

  return (
    <form
      className={`composer ${dragging ? 'composer--drop' : ''}`}
      onSubmit={(e) => {
        e.preventDefault();
        void send();
      }}
      onDragOver={(e) => {
        if (!live) return;
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => {
        if (!live) return;
        e.preventDefault();
        setDragging(false);
        void attach([...e.dataTransfer.files]);
      }}
    >
      {error && <p className="composer__error">{error}</p>}

      {shots.length > 0 && (
        <div className="composer__shelf">
          {shots.map((s) => (
            <div key={s.key} className={`shot shot--${s.state}`}>
              <img className="shot__img" src={s.preview} alt="" />
              {s.state !== 'ready' && (
                <span className="shot__state">{s.state === 'uploading' ? '…' : s.note}</span>
              )}
              <button
                type="button"
                className="shot__drop"
                onClick={() => drop(s.key)}
                aria-label="Remove this image"
              >
                ×
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="composer__row">
        <input
          ref={picker}
          className="composer__file"
          type="file"
          accept="image/png,image/jpeg,image/gif,image/webp"
          multiple
          onChange={(e) => {
            void attach([...(e.target.files ?? [])]);
            // Cleared so picking the same file twice still fires a change.
            e.target.value = '';
          }}
        />
        <button
          type="button"
          className="composer__attach"
          onClick={() => picker.current?.click()}
          disabled={!live || shots.length >= MAX_IMAGES}
          aria-label="Attach an image"
          title="Attach an image"
        >
          <svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true">
            <path
              d="M13.5 6.5 8 12a2.1 2.1 0 0 0 3 3l5.5-5.5a4.2 4.2 0 0 0-6-6L5 9a6.3 6.3 0 0 0 9 9l4-4"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
            />
          </svg>
        </button>
        <textarea
          className="composer__box"
          rows={1}
          value={draft}
          placeholder={live ? placeholder : offlinePlaceholder}
          disabled={!live}
          onChange={(e) => setDraft(e.target.value)}
          onPaste={(e) => {
            const files = [...e.clipboardData.files];
            if (!files.length) return;
            // Only swallow the paste when it was actually a picture; a paste
            // that is both text and an image is still text you meant to paste.
            if (files.some((f) => f.type.startsWith('image/'))) {
              if (!e.clipboardData.getData('text')) e.preventDefault();
              void attach(files);
            }
          }}
          onKeyDown={(e) => {
            // Enter sends, Shift-Enter is a newline — the same as every chat box
            // anyone has used, which is the point.
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              void send();
            }
          }}
        />
        <button type="submit" className="composer__send" disabled={!sendable}>
          {sending ? '…' : 'Send'}
        </button>
      </div>
    </form>
  );
}
