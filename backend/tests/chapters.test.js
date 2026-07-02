import test from 'node:test';
import assert from 'node:assert/strict';

const BASE_URL = process.env.TEST_BASE_URL || 'http://localhost:3001';

test('GET /api/chapters returns a non-empty chapter list', async () => {
  const response = await fetch(`${BASE_URL}/api/chapters`);
  const chapters = await response.json();

  assert.equal(response.status, 200);
  assert.equal(Array.isArray(chapters), true);
  assert.ok(chapters.length > 0);

  const firstChapter = chapters[0];
  assert.ok(firstChapter.id);
  assert.ok(firstChapter.title);
  assert.ok(firstChapter.content || firstChapter.paragraphs);
});

test('GET /api/chapters/:id returns chapter detail for valid id', async () => {
  const listResponse = await fetch(`${BASE_URL}/api/chapters`);
  const chapters = await listResponse.json();
  const firstChapter = chapters[0];

  const detailResponse = await fetch(`${BASE_URL}/api/chapters/${firstChapter.id}`);
  const chapter = await detailResponse.json();

  assert.equal(detailResponse.status, 200);
  assert.equal(chapter.id, firstChapter.id);
  assert.ok(chapter.title);
  assert.ok(chapter.content || chapter.paragraphs);
});

test('GET /api/chapters/:id returns 404 for missing chapter', async () => {
  const response = await fetch(`${BASE_URL}/api/chapters/not-exist-chapter`);
  const data = await response.json();

  assert.equal(response.status, 404);
  assert.equal(data.error, 'Chapter not found');
});
