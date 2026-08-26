import { randomBytes } from 'node:crypto';
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';

/**
 * Images sent from a browser, put where Claude can read them.
 *
 * There is no way to hand an image to Claude Code through this app's only
 * write channel: `tmux send-keys` types keystrokes, and a pasted image reaches
 * a TUI through the terminal emulator's clipboard, which is not a thing that
 * exists on the far side of a socket. What Claude Code *does* accept, from
 * every terminal, is a path — dragging a file into a desktop terminal only
 * inserts one. So an upload becomes a file on disk and the prompt carries its
 * path.
 *
 * The file lands inside the project on purpose. Claude reads files under its
 * own cwd without asking; anywhere else is a permission prompt per image,
 * answered from a phone, before it can even look. The cost is a directory in
 * the project, which is why `excludeFromGit` exists.
 */

/** Where uploads live, relative to the project root. */
export const UPLOADS = join('.claude-remote', 'uploads');

/** Past any screenshot, and small enough that a mistake cannot hold the loop. */
export const MAX_IMAGE_BYTES = 10_000_000;

/** How many can ride along with one prompt. */
export const MAX_IMAGES = 5;

/** The bytes were not an image we recognise. */
export class NotAnImage extends Error {
  constructor() {
    super('That file is not a PNG, JPEG, GIF or WebP image.');
    this.name = 'NotAnImage';
  }
}

interface ImageType {
  mime: string;
  ext: string;
}

/**
 * What these bytes actually are.
 *
 * By signature, never by the Content-Type header or the client's filename:
 * both are things a caller writes, and this decides what gets written to the
 * user's disk. Anything not on this list — SVG above all, which is a document
 * a browser will happily execute — has no signature here and is refused.
 */
export function sniff(buf: Buffer): ImageType | null {
  if (buf.length < 12) return null;
  if (buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return { mime: 'image/png', ext: 'png' };
  }
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) {
    return { mime: 'image/jpeg', ext: 'jpg' };
  }
  if (
    buf.subarray(0, 6).toString('latin1') === 'GIF89a' ||
    buf.subarray(0, 6).toString('latin1') === 'GIF87a'
  ) {
    return { mime: 'image/gif', ext: 'gif' };
  }
  if (
    buf.subarray(0, 4).toString('latin1') === 'RIFF' &&
    buf.subarray(8, 12).toString('latin1') === 'WEBP'
  ) {
    return { mime: 'image/webp', ext: 'webp' };
  }
  return null;
}

/** Names we mint, and the only shape this module will read back. */
const NAME = /^[0-9a-z]+-[0-9a-f]{6}\.(png|jpg|gif|webp)$/;

const BY_EXT: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
};

/** This session's folder. Sessions get their own so forgetting one is an `rm`. */
export function uploadDir(projectPath: string, sessionId: string): string {
  return join(projectPath, UPLOADS, sessionId);
}

/**
 * Keeps the uploads folder out of `git status`.
 *
 * `.git/info/exclude` rather than `.gitignore`: ignoring our own scratch space
 * is this checkout's business, not a change to a file the user commits and
 * reviews. Best-effort — a session that cannot write here still works, it just
 * leaves the folder visible.
 */
export function excludeFromGit(projectPath: string): void {
  const line = '.claude-remote/';
  try {
    const git = join(projectPath, '.git');
    // A worktree's `.git` is a file pointing elsewhere; not ours to chase.
    if (!existsSync(git) || !statSync(git).isDirectory()) return;
    const info = join(git, 'info');
    const file = join(info, 'exclude');
    const current = existsSync(file) ? readFileSync(file, 'utf8') : '';
    if (current.split('\n').some((l) => l.trim() === line)) return;
    mkdirSync(info, { recursive: true });
    appendFileSync(file, `${current && !current.endsWith('\n') ? '\n' : ''}${line}\n`);
  } catch {
    // Cosmetic. Never worth failing an upload over.
  }
}

export interface StoredImage {
  /** The minted filename, which is how every other endpoint refers to it. */
  name: string;
  /** Absolute, because this is what goes into the prompt. */
  path: string;
  mime: string;
  bytes: number;
}

/** Writes one image into a session's folder and says where it went. */
export function saveUpload(projectPath: string, sessionId: string, buf: Buffer): StoredImage {
  const type = sniff(buf);
  if (!type) throw new NotAnImage();

  const dir = uploadDir(projectPath, sessionId);
  mkdirSync(dir, { recursive: true });
  excludeFromGit(projectPath);

  // Time first so the folder sorts the way the conversation went, random tail
  // so two uploads in the same millisecond cannot collide. The client's own
  // filename is never used: it is attacker-chosen text going onto a disk.
  const name = `${Date.now().toString(36)}-${randomBytes(3).toString('hex')}.${type.ext}`;
  const path = join(dir, name);
  writeFileSync(path, buf);
  return { name, path, mime: type.mime, bytes: buf.length };
}

/** The absolute path for a name we minted, or null if that is not one. */
export function uploadPath(projectPath: string, sessionId: string, name: string): string | null {
  if (!NAME.test(name)) return null;
  const path = join(uploadDir(projectPath, sessionId), name);
  return existsSync(path) ? path : null;
}

/**
 * Reads one back, for showing it in the browser.
 *
 * The name has to match the shape we mint, which is what makes this safe: it
 * cannot contain a separator or a dot-dot, so there is no path to traverse.
 */
export function readUpload(
  projectPath: string,
  sessionId: string,
  name: string,
): { bytes: Buffer; mime: string } | null {
  const path = uploadPath(projectPath, sessionId, name);
  if (!path) return null;
  const ext = name.slice(name.lastIndexOf('.') + 1);
  return { bytes: readFileSync(path), mime: BY_EXT[ext] ?? 'application/octet-stream' };
}

/** Forgets a session's images. Called when its record is deleted. */
export function removeUploads(projectPath: string, sessionId: string): void {
  rmSync(uploadDir(projectPath, sessionId), { recursive: true, force: true });
}

/**
 * The prompt as Claude will receive it.
 *
 * One line, always: a newline inside `send-keys -l` is an Enter, which would
 * submit half a prompt. Paths with a space are quoted so the whole thing still
 * reads as one path — projects live under a home directory, and home
 * directories have spaces in them.
 */
export function composePrompt(text: string, paths: string[]): string {
  const refs = paths.map((p) => (p.includes(' ') ? `"${p}"` : p));
  return [text.trim(), ...refs].filter(Boolean).join(' ');
}
