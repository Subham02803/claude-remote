import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { type SessionStatus, isLive, isStoppable } from '@claude-remote/shared';

describe('isStoppable', () => {
  test('a working session can be stopped', () => {
    assert.equal(isStoppable({ status: 'working' }), true);
    assert.equal(isStoppable({ status: 'starting' }), true);
    assert.equal(isStoppable({ status: 'waiting' }), true);
  });

  test('a session idling at its prompt cannot', () => {
    // The bug this guards: `done` is live — you can still talk to it — so a
    // liveness check offered Stop on an idle session, and the interrupt then
    // cleared whatever was typed into Claude's input.
    assert.equal(isStoppable({ status: 'done' }), false);
    assert.equal(isStoppable({ status: 'failed' }), false);
    assert.equal(isStoppable({ status: 'ended' }), false);
  });

  test('stoppable is narrower than live, which is the point', () => {
    const idle: { status: SessionStatus } = { status: 'done' };
    assert.equal(isLive(idle), true);
    assert.equal(isStoppable(idle), false);
  });
});
