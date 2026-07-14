import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createRuntimeClueIndex,
  segmentParagraphWithClues,
  sourceSha256,
  validateClueManifest
} from '../src/clue-index.js';

function fixture() {
  const bookText = '福尔摩斯站在窗前。\n\n桌上放着一张车票。';
  const paragraphs = ['福尔摩斯站在窗前。', '桌上放着一张车票。'];
  const manifest = {
    version: 1,
    articleId: 'speckled-band',
    sourceSha256: sourceSha256(bookText),
    clues: [
      {
        id: 'clue-ticket',
        label: '车票',
        type: '物证',
        surfaceDescription: '桌上放着一张车票。',
        occurrences: [
          {
            id: 'occ-ticket',
            globalParagraphIndex: 1,
            chapterId: 'speckled-band-1',
            paragraphIndex: 1,
            selectedText: '一张车票',
            startOffset: 4,
            endOffset: 8
          }
        ]
      }
    ]
  };
  return { bookText, paragraphs, manifest };
}

test('validates exact source hash and occurrence offsets', () => {
  const { bookText, paragraphs, manifest } = fixture();
  const validated = validateClueManifest(manifest, { bookText, paragraphs });
  assert.equal(validated.clues[0].occurrences[0].selectedText, '一张车票');

  assert.throws(
    () => validateClueManifest({ ...manifest, sourceSha256: 'stale' }, { bookText, paragraphs }),
    /原文不一致/
  );
});

test('segments paragraphs using exact non-overlapping ranges', () => {
  const { bookText, paragraphs, manifest } = fixture();
  const runtime = createRuntimeClueIndex(validateClueManifest(manifest, { bookText, paragraphs }));
  const segments = segmentParagraphWithClues(paragraphs[1], 1, runtime);
  assert.deepEqual(
    segments.map((segment) => [segment.type, segment.text]),
    [
      ['narration', '桌上放着'],
      ['clue', '一张车票'],
      ['narration', '。']
    ]
  );
  assert.equal(segments[1].occurrenceId, 'occ-ticket');
});
