import test from 'node:test';
import assert from 'node:assert/strict';
import { selectTargetBoundSegments } from '../src/services/paragraphSpeech.js';

test('keeps only dialogue segments that belong to the selected standard paragraph', () => {
  const target = '“不，是一位委托人。现在她正在起居室里等候。”';
  const segments = [
    { id: 'context-before', text: '那么，什么事——失火了吗？' },
    { id: 'target', text: '不，是一位委托人。现在她正在起居室里等候。' },
    { id: 'context-after', text: '我的老兄，那我是无论如何也不肯失掉这个机会的。' }
  ];

  assert.deepEqual(selectTargetBoundSegments(segments, target), [segments[1]]);
});

test('orders multiple selected dialogue segments by their position and rejects duplicates', () => {
  const first = { id: 'first', text: '第一句' };
  const second = { id: 'second', text: '第二句' };
  const duplicate = { id: 'duplicate', text: '第一句' };

  assert.deepEqual(
    selectTargetBoundSegments([second, duplicate, first], '“第一句”，“第二句”。'),
    [duplicate, second]
  );
});

test('matches harmless quotation-mark and whitespace differences without admitting adjacent context', () => {
  const target = '“不，是一位委托人。\n现在她正在起居室里等候。”';
  const matching = { id: 'target', text: '「不，是一位委托人。现在她正在起居室里等候。」' };
  const adjacent = { id: 'adjacent', text: '那么，什么事——失火了吗？' };

  assert.deepEqual(selectTargetBoundSegments([adjacent, matching], target), [matching]);
});
