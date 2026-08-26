import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, test } from 'node:test';
import {
  NotAnImage,
  composePrompt,
  excludeFromGit,
  readUpload,
  removeUploads,
  saveUpload,
  sniff,
  uploadPath,
} from './uploads.js';

const PNG = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.alloc(16, 7),
]);
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(16, 7)]);
const GIF = Buffer.concat([Buffer.from('GIF89a', 'latin1'), Buffer.alloc(16, 7)]);
const WEBP = Buffer.concat([
  Buffer.from('RIFF', 'latin1'),
  Buffer.alloc(4, 0),
  Buffer.from('WEBP', 'latin1'),
  Buffer.alloc(16, 7),
]);

function project(): string {
  return mkdtempSync(join(tmpdir(), 'cr-uploads-'));
}

describe('sniff', () => {
  test('recognises the four formats by signature', () => {
    assert.equal(sniff(PNG)?.ext, 'png');
    assert.equal(sniff(JPEG)?.mime, 'image/jpeg');
    assert.equal(sniff(GIF)?.ext, 'gif');
    assert.equal(sniff(WEBP)?.ext, 'webp');
  });

  test('refuses anything else, SVG included', () => {
    assert.equal(
      sniff(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script/></svg>')),
      null,
    );
    assert.equal(sniff(Buffer.from('#!/bin/sh\nrm -rf /\n')), null);
    assert.equal(sniff(Buffer.alloc(4)), null);
  });
});

describe('saveUpload', () => {
  test('writes the bytes under the project and names the file itself', () => {
    const root = project();
    try {
      const stored = saveUpload(root, 'sess1', PNG);
      assert.match(stored.name, /^[0-9a-z]+-[0-9a-f]{6}\.png$/);
      assert.equal(stored.path, join(root, '.claude-remote', 'uploads', 'sess1', stored.name));
      assert.deepEqual(readFileSync(stored.path), PNG);
      assert.equal(stored.bytes, PNG.length);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('refuses bytes that are not an image', () => {
    const root = project();
    try {
      assert.throws(() => saveUpload(root, 'sess1', Buffer.from('not an image')), NotAnImage);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('two uploads in the same moment do not collide', () => {
    const root = project();
    try {
      const names = new Set([
        saveUpload(root, 's', PNG).name,
        saveUpload(root, 's', PNG).name,
        saveUpload(root, 's', PNG).name,
      ]);
      assert.equal(names.size, 3);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe('uploadPath', () => {
  test('resolves a name it minted', () => {
    const root = project();
    try {
      const stored = saveUpload(root, 'sess1', PNG);
      assert.equal(uploadPath(root, 'sess1', stored.name), stored.path);
      assert.equal(readUpload(root, 'sess1', stored.name)?.mime, 'image/png');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('refuses anything that is not one, traversal above all', () => {
    const root = project();
    try {
      saveUpload(root, 'sess1', PNG);
      writeFileSync(join(root, 'secret.txt'), 'shh');
      for (const name of [
        '../../../secret.txt',
        '../secret.txt',
        'secret.txt',
        'abc-123456.png/../../secret.txt',
        'abc-12345.png',
        'abc-123456.svg',
      ]) {
        assert.equal(uploadPath(root, 'sess1', name), null, name);
        assert.equal(readUpload(root, 'sess1', name), null, name);
      }
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('a name from another session is not this session’s to read', () => {
    const root = project();
    try {
      const mine = saveUpload(root, 'sess1', PNG);
      assert.equal(uploadPath(root, 'sess2', mine.name), null);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe('removeUploads', () => {
  test('takes the session’s folder and nothing else', () => {
    const root = project();
    try {
      const kept = saveUpload(root, 'keep', PNG);
      saveUpload(root, 'drop', PNG);
      removeUploads(root, 'drop');
      assert.equal(existsSync(join(root, '.claude-remote', 'uploads', 'drop')), false);
      assert.equal(existsSync(kept.path), true);
      // Gone already is the outcome we wanted, not an error.
      removeUploads(root, 'drop');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe('excludeFromGit', () => {
  test('adds the line once, and leaves what was already there', () => {
    const root = project();
    try {
      mkdirSync(join(root, '.git', 'info'), { recursive: true });
      writeFileSync(join(root, '.git', 'info', 'exclude'), '# theirs\nscratch/');
      excludeFromGit(root);
      excludeFromGit(root);
      const out = readFileSync(join(root, '.git', 'info', 'exclude'), 'utf8');
      assert.match(out, /^# theirs\nscratch\/\n\.claude-remote\/\n$/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('does nothing outside a git checkout', () => {
    const root = project();
    try {
      excludeFromGit(root);
      assert.equal(existsSync(join(root, '.git')), false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe('composePrompt', () => {
  test('puts the paths after the words, on one line', () => {
    assert.equal(
      composePrompt('why is this wrong?', ['/p/.claude-remote/uploads/s/a-1.png']),
      'why is this wrong? /p/.claude-remote/uploads/s/a-1.png',
    );
  });

  test('an image with no words is just the path', () => {
    assert.equal(composePrompt('   ', ['/p/a-1.png']), '/p/a-1.png');
  });

  test('quotes a path with a space in it, because home directories have them', () => {
    assert.equal(composePrompt('look', ['/Users/a b/p/a-1.png']), 'look "/Users/a b/p/a-1.png"');
  });

  test('never sends a newline, which would submit half a prompt', () => {
    const out = composePrompt('one', ['/p/a-1.png', '/p/b-2.png']);
    assert.equal(out.includes('\n'), false);
    assert.equal(out, 'one /p/a-1.png /p/b-2.png');
  });
});
