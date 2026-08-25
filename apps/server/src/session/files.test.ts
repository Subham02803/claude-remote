import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, realpathSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { after, before, describe, test } from 'node:test';
import {
  NotPreviewable,
  OutsideProject,
  fileKind,
  listProjectDir,
  readProjectFile,
  resolveInProject,
} from './files.js';

/**
 * The containment tests are written first and kept together, because this is
 * the only part of the preview feature that can lose someone their SSH key.
 */
describe('resolveInProject', () => {
  let root: string;
  let project: string;
  let secret: string;

  before(() => {
    root = mkdtempSync(join(tmpdir(), 'cr-files-'));
    project = join(root, 'project');
    mkdirSync(join(project, 'docs'), { recursive: true });
    writeFileSync(join(project, 'docs', 'scope.md'), '# Scope\n\nA document.\n');

    secret = join(root, 'secrets.txt');
    writeFileSync(secret, 'id_rsa\n');
  });

  test('resolves a plain relative path inside the project', () => {
    const hit = resolveInProject(project, 'docs/scope.md');
    // realpath'd, so on macOS this is /private/var/... not /var/...
    assert.equal(hit, realpathSync(resolve(join(project, 'docs', 'scope.md'))));
  });

  test('accepts the absolute path of a file inside the project', () => {
    // Changes reports absolute paths, so this is the shape the UI actually sends.
    const hit = resolveInProject(project, join(project, 'docs', 'scope.md'));
    assert.ok(hit.endsWith('scope.md'));
  });

  test('refuses a traversal out of the project', () => {
    assert.throws(() => resolveInProject(project, '../secrets.txt'), OutsideProject);
    assert.throws(() => resolveInProject(project, 'docs/../../secrets.txt'), OutsideProject);
    assert.throws(() => resolveInProject(project, '../../../../etc/passwd'), OutsideProject);
  });

  test('refuses an absolute path outside the project', () => {
    assert.throws(() => resolveInProject(project, secret), OutsideProject);
    assert.throws(() => resolveInProject(project, '/etc/passwd'), OutsideProject);
  });

  test('refuses a symlink that points out of the project', () => {
    // The lexical check passes here — only realpath catches this one.
    const link = join(project, 'docs', 'leak.md');
    symlinkSync(secret, link);
    assert.throws(() => resolveInProject(project, 'docs/leak.md'), OutsideProject);
  });

  test('refuses the project root itself', () => {
    assert.throws(() => resolveInProject(project, '.'), OutsideProject);
    assert.throws(() => resolveInProject(project, project), OutsideProject);
  });

  test('reports a missing file as ENOENT, not as an escape', () => {
    assert.throws(
      () => resolveInProject(project, 'docs/nope.md'),
      (err: NodeJS.ErrnoException) => err.code === 'ENOENT',
    );
  });
});

describe('readProjectFile', () => {
  let project: string;

  before(() => {
    project = mkdtempSync(join(tmpdir(), 'cr-read-'));
    mkdirSync(join(project, 'docs'), { recursive: true });
    writeFileSync(join(project, 'docs', 'scope.md'), '# Scope\n');
    writeFileSync(join(project, 'page.html'), '<h1>hi</h1>');
    writeFileSync(join(project, 'blob.bin'), Buffer.from([0x00, 0x01, 0x02, 0x00]));
  });

  test('returns text and a project-relative path', () => {
    const file = readProjectFile(project, 'docs/scope.md');
    assert.equal(file.path, join('docs', 'scope.md'));
    assert.equal(file.kind, 'md');
    assert.equal(file.text, '# Scope\n');
    assert.ok(file.bytes > 0);
  });

  test('classifies html so the UI knows to sandbox it', () => {
    assert.equal(readProjectFile(project, 'page.html').kind, 'html');
  });

  test('refuses a binary file rather than returning mojibake', () => {
    assert.throws(() => readProjectFile(project, 'blob.bin'), NotPreviewable);
  });

  test('refuses a directory', () => {
    assert.throws(() => readProjectFile(project, 'docs'), NotPreviewable);
  });
});

describe('fileKind', () => {
  test('knows the three shapes it can show', () => {
    assert.equal(fileKind('a/b/README.md'), 'md');
    assert.equal(fileKind('NOTES.MARKDOWN'), 'md');
    assert.equal(fileKind('design/prototype.html'), 'html');
    assert.equal(fileKind('index.HTM'), 'html');
    assert.equal(fileKind('src/app.ts'), 'text');
    assert.equal(fileKind('Makefile'), 'text');
  });
});

after(() => {
  /* mkdtemp dirs live under the OS temp dir; the OS reaps them. */
});

describe('listProjectDir', () => {
  let project: string;

  before(() => {
    project = mkdtempSync(join(tmpdir(), 'cr-tree-'));
    mkdirSync(join(project, 'docs'), { recursive: true });
    mkdirSync(join(project, 'src'), { recursive: true });
    writeFileSync(join(project, 'README.md'), '# hi\n');
    writeFileSync(join(project, 'index.html'), '<p>hi</p>');
    writeFileSync(join(project, 'docs', 'scope.md'), '# scope\n');
  });

  test('lists the root when no path is given', () => {
    const listing = listProjectDir(project, '');
    assert.equal(listing.path, '');
    assert.deepEqual(
      listing.entries.map((e) => e.name),
      // Directories first, then files. localeCompare is case-insensitive, so
      // index.html sorts before README.md — what a file browser should do.
      ['docs', 'src', 'index.html', 'README.md'],
    );
  });

  test('marks directories and classifies files', () => {
    const byName = new Map(listProjectDir(project, '').entries.map((e) => [e.name, e]));
    assert.equal(byName.get('docs')?.dir, true);
    assert.equal(byName.get('docs')?.kind, null);
    assert.equal(byName.get('README.md')?.kind, 'md');
    assert.equal(byName.get('index.html')?.kind, 'html');
    assert.ok((byName.get('README.md')?.bytes ?? 0) > 0);
  });

  test('descends into a subdirectory', () => {
    const listing = listProjectDir(project, 'docs');
    assert.equal(listing.path, 'docs');
    assert.deepEqual(
      listing.entries.map((e) => e.path),
      [join('docs', 'scope.md')],
    );
  });

  test('refuses to list outside the project', () => {
    assert.throws(() => listProjectDir(project, '..'), OutsideProject);
    assert.throws(() => listProjectDir(project, '/etc'), OutsideProject);
  });

  test('refuses a file', () => {
    assert.throws(() => listProjectDir(project, 'README.md'), NotPreviewable);
  });
});
