import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { type TaskEvent, pairAgents } from './agents.js';

const task = (event: string, subagent_type: string, description: string, at = '12:00'): TaskEvent =>
  ({ at, event, detail: JSON.stringify({ input: { subagent_type, description } }) }) as TaskEvent;

describe('pairAgents', () => {
  test('an unfinished Task is an agent still working', () => {
    const [a] = pairAgents([task('PreToolUse', 'Explore', 'find the call sites')]);
    assert.ok(a);
    assert.equal(a.name, 'Explore');
    assert.equal(a.status, 'working');
    assert.equal(a.sub, true);
    assert.equal(a.endedAt, null);
    assert.equal(a.doing, 'find the call sites');
  });

  test('a matching PostToolUse closes it', () => {
    const agents = pairAgents([
      task('PreToolUse', 'Explore', 'find the call sites', '12:00'),
      task('PostToolUse', 'Explore', 'find the call sites', '12:02'),
    ]);
    const [only] = agents;
    assert.equal(agents.length, 1);
    assert.ok(only);
    assert.equal(only.status, 'done');
    assert.equal(only.endedAt, '12:02');
  });

  test('parallel subagents are kept apart by description', () => {
    const agents = pairAgents([
      task('PreToolUse', 'general-purpose', 'rewrite query.ts', '12:00'),
      task('PreToolUse', 'general-purpose', 'rewrite range.ts', '12:01'),
      task('PostToolUse', 'general-purpose', 'rewrite range.ts', '12:03'),
    ]);
    const [first, second] = agents;
    assert.equal(agents.length, 2);
    assert.ok(first);
    assert.ok(second);
    // Still-working first — the top of the list is what gets read on a phone.
    assert.equal(first.doing, 'rewrite query.ts');
    assert.equal(first.status, 'working');
    assert.equal(second.doing, 'rewrite range.ts');
    assert.equal(second.status, 'done');
  });

  test('two identical Tasks close oldest-first rather than being lost', () => {
    const agents = pairAgents([
      task('PreToolUse', 'Explore', 'look around', '12:00'),
      task('PreToolUse', 'Explore', 'look around', '12:01'),
      task('PostToolUse', 'Explore', 'look around', '12:05'),
    ]);
    assert.equal(agents.length, 2);
    assert.equal(agents.filter((a) => a.status === 'done').length, 1);
    assert.equal(agents.filter((a) => a.status === 'working').length, 1);
  });

  test('a finish with nothing open is ignored, not invented', () => {
    assert.deepEqual(pairAgents([task('PostToolUse', 'Explore', 'orphan')]), []);
  });

  test('survives a Task with no readable input', () => {
    const [a] = pairAgents([{ at: '12:00', event: 'PreToolUse', detail: 'not json' }]);
    assert.ok(a);
    assert.equal(a.name, 'subagent');
    assert.equal(a.doing, null);
  });
});
