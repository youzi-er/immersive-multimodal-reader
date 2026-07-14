import assert from 'node:assert/strict';
import test from 'node:test';
import { bookParagraphIndex, clues, getClueReaderContext } from '../src/data.js';

test('clue image context stops at the selected paragraph', () => {
  const clue = clues.find((item) => {
    const occurrence = item.occurrences[0];
    return occurrence && bookParagraphIndex[occurrence.globalParagraphIndex + 1]?.text.length > 20;
  });
  assert.ok(clue, 'fixture must contain a clue before the final paragraph');

  const occurrence = clue.occurrences[0];
  const context = getClueReaderContext({ clueId: clue.id, occurrenceId: occurrence.id, contextChars: 1200 });
  const nextParagraph = bookParagraphIndex[occurrence.globalParagraphIndex + 1].text;
  assert.ok(context);
  assert.equal(context.sourceContext, bookParagraphIndex[occurrence.globalParagraphIndex].text);
  assert.ok(context.readerContext.endsWith(context.sourceContext));
  assert.equal(context.readerContext.includes(nextParagraph), false);
});
