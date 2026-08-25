import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { parseTranscript } from './transcript.js';

const user = (content: unknown, extra = {}) => ({
  type: 'user',
  uuid: `u${Math.random()}`,
  timestamp: '2026-08-25T06:00:00.000Z',
  message: { role: 'user', content },
  ...extra,
});

const assistant = (content: unknown, extra = {}) => ({
  type: 'assistant',
  uuid: `a${Math.random()}`,
  timestamp: '2026-08-25T06:00:01.000Z',
  message: { role: 'assistant', content },
  ...extra,
});

describe('parseTranscript', () => {
  test('a plain exchange becomes two messages', () => {
    const out = parseTranscript([user('ping'), assistant([{ type: 'text', text: 'pong' }])]);
    assert.equal(out.length, 2);
    assert.equal(out[0]?.role, 'user');
    assert.deepEqual(out[0]?.blocks, [{ kind: 'text', text: 'ping' }]);
    assert.equal(out[1]?.role, 'assistant');
  });

  test('a tool result is attached to the call that asked for it', () => {
    const out = parseTranscript([
      user('go'),
      assistant([{ type: 'tool_use', id: 't1', name: 'Read', input: { file_path: '/a/b.ts' } }]),
      user([{ type: 'tool_result', tool_use_id: 't1', content: 'file body' }]),
    ]);
    const tool = out[1]?.blocks[0];
    assert.equal(tool?.kind, 'tool');
    assert.ok(tool && tool.kind === 'tool');
    assert.equal(tool.name, 'Read');
    assert.equal(tool.summary, '/a/b.ts');
    assert.equal(tool.result, 'file body');
    assert.equal(tool.ok, true);
  });

  test('a tool_result line does not become a message of its own', () => {
    const out = parseTranscript([
      assistant([{ type: 'tool_use', id: 't1', name: 'Bash', input: { command: 'ls' } }]),
      user([{ type: 'tool_result', tool_use_id: 't1', content: 'a\nb' }]),
    ]);
    assert.equal(out.length, 1);
    assert.equal(out[0]?.role, 'assistant');
  });

  test('an unanswered call reads as still running', () => {
    const out = parseTranscript([
      assistant([{ type: 'tool_use', id: 't9', name: 'Bash', input: { command: 'sleep 60' } }]),
    ]);
    const tool = out[0]?.blocks[0];
    assert.ok(tool && tool.kind === 'tool');
    assert.equal(tool.result, null);
  });

  test('is_error marks the call failed', () => {
    const out = parseTranscript([
      assistant([{ type: 'tool_use', id: 't2', name: 'Bash', input: { command: 'false' } }]),
      user([{ type: 'tool_result', tool_use_id: 't2', content: 'nope', is_error: true }]),
    ]);
    const tool = out[0]?.blocks[0];
    assert.ok(tool && tool.kind === 'tool');
    assert.equal(tool.ok, false);
  });

  test('consecutive assistant lines are one turn', () => {
    // Claude Code writes a line per tool call; without merging, a single turn
    // shows as a dozen messages each captioned "Claude".
    const out = parseTranscript([
      user('go'),
      assistant([{ type: 'text', text: 'starting' }]),
      assistant([{ type: 'tool_use', id: 'x1', name: 'Bash', input: { command: 'ls' } }]),
      assistant([{ type: 'tool_use', id: 'x2', name: 'Bash', input: { command: 'pwd' } }]),
    ]);
    assert.equal(out.length, 2);
    assert.equal(out[1]?.blocks.length, 3);
  });

  test('a new user turn starts a new message', () => {
    const out = parseTranscript([
      user('one'),
      assistant([{ type: 'text', text: 'a' }]),
      user('two'),
      assistant([{ type: 'text', text: 'b' }]),
    ]);
    assert.deepEqual(
      out.map((m) => m.role),
      ['user', 'assistant', 'user', 'assistant'],
    );
  });

  test('a subagent conversation stays out of the main thread', () => {
    // Sidechain lines are a Task's own transcript. They belong to the Agents
    // tab; inlining them here would double every subagent's work.
    const out = parseTranscript([
      user('go'),
      assistant([{ type: 'text', text: 'mine' }]),
      assistant([{ type: 'text', text: 'the subagent thinking' }], { isSidechain: true }),
    ]);
    assert.equal(out.length, 2);
    assert.equal(out[1]?.blocks.length, 1);
  });

  test('thinking is kept, empty text is not', () => {
    const out = parseTranscript([
      assistant([
        { type: 'thinking', thinking: 'hmm' },
        { type: 'text', text: '   ' },
      ]),
    ]);
    assert.deepEqual(out[0]?.blocks, [{ kind: 'thinking', text: 'hmm' }]);
  });

  test('a long result is cut and says so', () => {
    const out = parseTranscript([
      assistant([{ type: 'tool_use', id: 't3', name: 'Read', input: { file_path: '/big' } }]),
      user([{ type: 'tool_result', tool_use_id: 't3', content: 'x'.repeat(9000) }]),
    ]);
    const tool = out[0]?.blocks[0];
    assert.ok(tool && tool.kind === 'tool');
    assert.equal(tool.truncated, true);
    assert.equal(tool.result?.length, 2000);
  });

  test('a result given as content blocks is read as text', () => {
    const out = parseTranscript([
      assistant([{ type: 'tool_use', id: 't4', name: 'Grep', input: { pattern: 'foo' } }]),
      user([
        {
          type: 'tool_result',
          tool_use_id: 't4',
          content: [{ type: 'text', text: 'line one' }],
        },
      ]),
    ]);
    const tool = out[0]?.blocks[0];
    assert.ok(tool && tool.kind === 'tool');
    assert.equal(tool.result, 'line one');
    assert.equal(tool.summary, 'foo');
  });
});
