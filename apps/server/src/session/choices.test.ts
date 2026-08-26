import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { parseChoice } from './choices.js';

/** The shape Claude Code actually sent, from the session that found this bug. */
const real = JSON.stringify({
  questions: [
    {
      question:
        'The NotificationSettingsPage test failure is a real bug, not a stale test. How should I handle it?',
      header: 'Toggle bug',
      multiSelect: false,
      options: [
        { label: 'Fix the code (Recommended)', description: 'One-line change in the page.' },
        { label: 'Show me the diff first', description: 'I write up the change and you approve.' },
        { label: 'Leave the code, skip the test', description: 'Mark it .skip with a TODO.' },
        { label: 'Leave it failing', description: 'An intentional red flag for the open bug.' },
      ],
    },
  ],
});

describe('parseChoice', () => {
  test('an AskUserQuestion becomes its options, numbered as the terminal numbers them', () => {
    const choice = parseChoice('AskUserQuestion', real);
    assert.ok(choice);
    assert.equal(choice.header, 'Toggle bug');
    assert.equal(choice.multiSelect, false);
    assert.equal(choice.more, 0);
    assert.deepEqual(
      choice.options.map((o) => [o.n, o.label]),
      [
        [1, 'Fix the code (Recommended)'],
        [2, 'Show me the diff first'],
        [3, 'Leave the code, skip the test'],
        [4, 'Leave it failing'],
      ],
    );
  });

  test('an ordinary approval is not a question', () => {
    assert.equal(parseChoice('Bash', 'rm -rf build'), null);
    assert.equal(parseChoice('Edit', '/a/b.ts'), null);
  });

  test('a payload we cannot read degrades to Approve/Deny rather than throwing', () => {
    // What older rows hold: the summarised, 500-char-truncated JSON.
    assert.equal(parseChoice('AskUserQuestion', '{"questions":[{"question":"How sh'), null);
    assert.equal(parseChoice('AskUserQuestion', '(no detail given)'), null);
    assert.equal(parseChoice('AskUserQuestion', '{}'), null);
    assert.equal(parseChoice('AskUserQuestion', '{"questions":[]}'), null);
    assert.equal(parseChoice('AskUserQuestion', '{"questions":[{"options":[]}]}'), null);
    assert.equal(parseChoice('AskUserQuestion', 'null'), null);
  });

  test('options with no label are dropped, and the rest keep the numbers they had', () => {
    const choice = parseChoice(
      'AskUserQuestion',
      JSON.stringify({
        questions: [{ question: 'q', options: [{ label: 'a' }, {}, { label: 'c' }] }],
      }),
    );
    // The blank one is still number 2 in the terminal, so 'c' must stay 3.
    assert.deepEqual(choice?.options, [
      { n: 1, label: 'a', description: '' },
      { n: 3, label: 'c', description: '' },
    ]);
  });

  test('multiSelect is carried through, because one keystroke cannot answer it', () => {
    const choice = parseChoice(
      'AskUserQuestion',
      JSON.stringify({
        questions: [{ question: 'q', multiSelect: true, options: [{ label: 'a' }] }],
      }),
    );
    assert.equal(choice?.multiSelect, true);
  });

  test('only the first question is offered, and the rest are counted', () => {
    const choice = parseChoice(
      'AskUserQuestion',
      JSON.stringify({
        questions: [
          { question: 'first', options: [{ label: 'a' }] },
          { question: 'second', options: [{ label: 'b' }] },
          { question: 'third', options: [{ label: 'c' }] },
        ],
      }),
    );
    assert.equal(choice?.question, 'first');
    assert.equal(choice?.more, 2);
  });
});
