import { existsSync, readdirSync, realpathSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { isAbsolute, join, relative, sep } from 'node:path';
import type { FolderEntry, FolderListing } from '@claude-remote/shared';

/**
 * Browsing folders so a project can be picked instead of typed.
 *
 * The whole surface is one directory: home. Not a preference — it is what makes
 * "is this path allowed" a question with an answer. There is no sign-in here,
 * so a browser being able to walk the disk would be a browser being able to
 * read the disk, and `/etc`, `/var` and every other machine on a mounted share
 * are simply not reachable through this API.
 *
 * Cross-platform by not caring: the browser only ever sends a path *relative to
 * home*, with forward slashes. macOS resolves that against `/Users/you` and
 * Windows against `C:\Users\you`, and neither the client nor this module has to
 * special-case the other.
 */

/** A requested path resolved somewhere outside the home directory. */
export class OutsideHome extends Error {
  constructor() {
    super('That folder is outside your home directory.');
    this.name = 'OutsideHome';
  }
}

/** A folder can hold a great many things; a picker cannot show them all. */
const MAX_ENTRIES = 500;

/** Windows compares paths without regard to case; unix does not. */
const CASE_INSENSITIVE = process.platform === 'win32' || process.platform === 'darwin';

/**
 * The home directory, resolved through any symlinks.
 *
 * Resolved once per call rather than cached: it is cheap, and a cached realpath
 * would be wrong for the whole life of the process if home were ever a link
 * that moved.
 */
export function homeRoot(): string {
  return realpathSync(homedir());
}

function sameCase(p: string): string {
  return CASE_INSENSITIVE ? p.toLowerCase() : p;
}

/** True when `abs` is the home directory or sits underneath it. */
function underHome(root: string, abs: string): boolean {
  const rel = relative(sameCase(root), sameCase(abs));
  // '' means it *is* home, which is a legal place to browse.
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
}

/**
 * Turns a home-relative path from the browser into a real absolute one.
 *
 * Refuses rather than sanitises. A segment that is `..`, a drive letter, or a
 * backslash pretending to be a separator is a request that should not have been
 * made, and quietly stripping it would turn a rejected path into a different
 * accepted one.
 *
 * Checked twice, like `session/files.ts`: lexically, which stops `../..`, and
 * again after `realpath`, which is the only thing that catches a symlink inside
 * home pointing back out of it.
 */
export function resolveInHome(requested: string): string {
  const root = homeRoot();
  const parts = requested.split('/').filter((s) => s !== '' && s !== '.');
  for (const part of parts) {
    if (part === '..' || part.includes('\\') || part.includes(':')) throw new OutsideHome();
  }
  const abs = parts.length ? join(root, ...parts) : root;
  if (!underHome(root, abs)) throw new OutsideHome();

  // Throws ENOENT when the folder is gone, which callers turn into a 404.
  const real = realpathSync(abs);
  if (!underHome(root, real)) throw new OutsideHome();
  return real;
}

/**
 * An absolute path expressed relative to home, with forward slashes, or null
 * when it is not under home at all.
 *
 * Used to show a stored project the way the picker would, and to mark the
 * folders already taken.
 */
export function homeRelative(abs: string): string | null {
  let root: string;
  try {
    root = homeRoot();
  } catch {
    return null;
  }
  if (!underHome(root, abs)) return null;
  const rel = relative(root, abs);
  return rel === '' ? '' : rel.split(sep).join('/');
}

/** Dot-prefixed. Windows' hidden *attribute* is not visible through fs.Stats. */
function isHidden(name: string): boolean {
  return name.startsWith('.');
}

/**
 * The folders inside one folder under home, and nothing else.
 *
 * Files are left out entirely rather than shown and refused — a project is a
 * directory, so a file is not a choice that was ever available.
 *
 * @param requested home-relative, forward slashes, '' for home itself
 * @param added home-relative paths already used as projects, to mark them
 */
export function listHomeDir(requested: string, added: Set<string> = new Set()): FolderListing {
  const abs = resolveInHome(requested);
  const here = homeRelative(abs) ?? '';

  const found = readdirSync(abs, { withFileTypes: true });
  const dirs = found.filter((d) => {
    if (d.isDirectory()) return true;
    // A symlinked folder is still a folder worth offering. Whether its target
    // is inside home is decided by resolveInHome when it is actually picked,
    // so a link out of home can be listed but never added.
    if (!d.isSymbolicLink()) return false;
    try {
      return statSync(join(abs, d.name)).isDirectory();
    } catch {
      // A broken link, or one we may not follow. Not a folder anyone can pick.
      return false;
    }
  });

  dirs.sort((a, b) => {
    const ah = isHidden(a.name);
    const bh = isHidden(b.name);
    // Hidden folders last: reachable, but never the first thing you scroll past.
    if (ah !== bh) return ah ? 1 : -1;
    return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
  });

  const truncated = dirs.length > MAX_ENTRIES;
  const entries: FolderEntry[] = dirs.slice(0, MAX_ENTRIES).map((d) => {
    const childPath = here ? `${here}/${d.name}` : d.name;
    return {
      name: d.name,
      path: childPath,
      hidden: isHidden(d.name),
      repo: existsSync(join(abs, d.name, '.git')),
      added: added.has(childPath),
    };
  });

  const cut = here.lastIndexOf('/');
  return {
    home: homedir(),
    sep,
    path: here,
    parent: here === '' ? null : here.slice(0, Math.max(0, cut)),
    entries,
    truncated,
  };
}
