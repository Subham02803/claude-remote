import { readFileSync, readdirSync, realpathSync, statSync } from 'node:fs';
import { extname, isAbsolute, join, relative, resolve } from 'node:path';
import type { DirEntry, DirListing, FileKind, FilePreview } from '@claude-remote/shared';

/** The requested path resolved somewhere outside the project it was asked for. */
export class OutsideProject extends Error {
  constructor() {
    super('That path is not inside this project.');
    this.name = 'OutsideProject';
  }
}

/** The file exists but is not something a browser can usefully show. */
export class NotPreviewable extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NotPreviewable';
  }
}

/**
 * A preview is for reading, not for downloading a disk image through the API.
 * Two megabytes is far past any document or prototype worth looking at on a
 * phone, and small enough that a mistake cannot hold the event loop.
 */
export const MAX_BYTES = 2_000_000;

export function fileKind(path: string): FileKind {
  const ext = extname(path).toLowerCase();
  if (ext === '.md' || ext === '.markdown') return 'md';
  if (ext === '.html' || ext === '.htm') return 'html';
  return 'text';
}

/** True when `abs` sits strictly underneath `dir`, by name alone. */
function under(dir: string, abs: string): boolean {
  const rel = relative(dir, abs);
  // '' means the path *is* the directory: never a file to preview.
  return rel !== '' && !rel.startsWith('..') && !isAbsolute(rel);
}

/**
 * Turns a requested path into a real file inside a project, or refuses.
 *
 * This is the whole security surface of the preview feature, so it checks the
 * same thing twice on purpose:
 *
 * 1. **Lexically**, after `resolve` — this is what stops `../../.ssh/id_rsa`.
 * 2. **After `realpath`** — this is what stops a symlink *inside* the project
 *    pointing back out of it. The first check cannot see that; a file named
 *    `docs/notes.md` can be a link to anywhere on the disk.
 *
 * Declared projects are what make this tractable: `config.projects` is a short
 * list of directories the user named, not a filesystem to be walked, so
 * "inside a project" is a question with an answer.
 */
export function resolveInProject(projectRoot: string, requested: string): string {
  const raw = resolve(projectRoot);
  // Resolved separately because the two can differ: on macOS /var is a symlink
  // to /private/var, so a project under /var realpaths somewhere a path from
  // the hook log will never lexically match.
  const root = realpathSync(raw);
  const abs = isAbsolute(requested) ? resolve(requested) : resolve(raw, requested);

  // Checked against both spellings of the root. Only one has to hold — a
  // traversal is outside both, so this loosens nothing.
  if (!under(raw, abs) && !under(root, abs)) throw new OutsideProject();

  // Throws ENOENT when the file is gone, which the caller turns into a 404.
  // This second check is the one that catches a symlink *inside* the project
  // pointing out of it; the lexical check above cannot see that.
  const real = realpathSync(abs);
  if (!under(root, real)) throw new OutsideProject();

  return real;
}

/**
 * Reads one file from a declared project, for previewing.
 *
 * Returns the text and lets the browser decide how to show it. It never
 * responds as `text/html`, and nothing here renders anything — see the route
 * and `SessionView` for why the content only ever reaches the page inside a
 * sandboxed frame.
 */
export function readProjectFile(projectRoot: string, requested: string): FilePreview {
  const real = resolveInProject(projectRoot, requested);

  const stat = statSync(real);
  if (stat.isDirectory()) throw new NotPreviewable('That is a directory, not a file.');
  if (stat.size > MAX_BYTES) {
    throw new NotPreviewable(
      `That file is ${Math.round(stat.size / 1e6)} MB — too big to preview.`,
    );
  }

  const buf = readFileSync(real);
  // A NUL byte in the first few KB is the cheap, boring test for "this is not
  // text". Better to say so than to hand a page a screenful of mojibake.
  if (buf.subarray(0, 8192).includes(0)) {
    throw new NotPreviewable('That file is binary.');
  }

  return {
    path: relative(realpathSync(projectRoot), real),
    kind: fileKind(real),
    text: buf.toString('utf8'),
    bytes: stat.size,
  };
}

/**
 * A directory listing is capped. A project with `node_modules` in it has tens
 * of thousands of entries in one folder, and a phone will not thank you.
 */
export const MAX_ENTRIES = 800;

/**
 * Like `resolveInProject`, but the project root itself is a legal answer.
 *
 * Browsing has to start somewhere, and that somewhere is the root — which
 * `resolveInProject` deliberately refuses, because the root is never a file to
 * preview. Same two-stage containment otherwise.
 */
export function resolveDirInProject(projectRoot: string, requested: string): string {
  const root = realpathSync(resolve(projectRoot));
  if (!requested || requested === '.' || requested === '/') return root;
  const hit = resolveInProject(projectRoot, requested);
  return hit;
}

/**
 * Lists one directory inside a project, for the Preview tab.
 *
 * Directories first, then files, both alphabetical — the ordering a file tree
 * has everywhere else, and not worth being clever about. Entries that cannot
 * be read (a broken symlink, a permission) are skipped rather than failing the
 * whole listing.
 */
export function listProjectDir(projectRoot: string, requested: string): DirListing {
  const root = realpathSync(resolve(projectRoot));
  const dir = resolveDirInProject(projectRoot, requested);
  if (!statSync(dir).isDirectory()) throw new NotPreviewable('That is a file, not a directory.');

  const names = readdirSync(dir);
  const truncated = names.length > MAX_ENTRIES;

  const entries: DirEntry[] = [];
  for (const name of names.slice(0, MAX_ENTRIES)) {
    const abs = join(dir, name);
    let stat: ReturnType<typeof statSync>;
    try {
      stat = statSync(abs);
    } catch {
      continue;
    }
    const isDir = stat.isDirectory();
    entries.push({
      name,
      path: relative(root, abs),
      dir: isDir,
      bytes: isDir ? null : stat.size,
      // Only what the preview can actually show is offered as previewable.
      kind: isDir ? null : fileKind(name),
    });
  }

  entries.sort((a, b) => {
    if (a.dir !== b.dir) return a.dir ? -1 : 1;
    return a.name.localeCompare(b.name);
  });

  return { path: relative(root, dir), entries, truncated };
}
