import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { chapters } from '../src/data.js';
import { createMediaAsset, listMediaAssets } from '../src/db.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../..');

dotenv.config({ path: path.resolve(repoRoot, '.env') });
dotenv.config({ path: path.resolve(repoRoot, 'backend/.env') });

const articleId = 'speckled-band';
const chapterId = 'speckled-band-1';
const paragraphIndex = 6;
const targetText = '“那么，什么事——失火了吗？”';
const mediaDir = path.resolve(repoRoot, 'backend/storage/media/audio/2026/07');

const existingAudio = [
  {
    filename: 'a0ffb4d8-2a25-4ce1-9a2c-aba3a11c5538.mp3',
    durationMs: 4248,
    traceId: '069e8f002258d42207b0e443be5d9f4f'
  },
  {
    filename: '64857705-8213-4f0f-a6ae-4d82ed158e1d.mp3',
    durationMs: 3240,
    traceId: '069e8f2ddba7914bbdee428cb10a4e8f'
  }
];

function findRange() {
  const chapter = chapters.find((item) => item.id === chapterId);
  if (!chapter) {
    throw new Error(`Chapter not found: ${chapterId}`);
  }

  const paragraph = chapter.paragraphs[paragraphIndex];
  if (!paragraph) {
    throw new Error(`Paragraph not found: ${chapterId}:${paragraphIndex}`);
  }

  const paragraphText = paragraph.map((segment) => segment.text).join('');
  const startOffset = paragraphText.indexOf(targetText);
  if (startOffset < 0) {
    throw new Error(`Target text not found in ${chapterId}:${paragraphIndex}`);
  }

  return {
    startParagraphIndex: paragraphIndex,
    startOffset,
    endParagraphIndex: paragraphIndex,
    endOffset: startOffset + targetText.length
  };
}

async function main() {
  const range = findRange();
  const currentAssets = await listMediaAssets({ articleId, chapterId, mediaType: 'audio' });
  const existingUrls = new Set(currentAssets.map((asset) => asset.url));
  const imported = [];
  const skipped = [];

  for (const item of existingAudio) {
    const filePath = path.resolve(mediaDir, item.filename);
    const url = `/media/audio/2026/07/${item.filename}`;

    if (!fs.existsSync(filePath)) {
      skipped.push({ filename: item.filename, reason: 'file missing' });
      continue;
    }

    if (existingUrls.has(url)) {
      skipped.push({ filename: item.filename, reason: 'already imported' });
      continue;
    }

    const asset = await createMediaAsset({
      id: crypto.randomUUID(),
      articleId,
      chapterId,
      paragraphIndex,
      range,
      mediaType: 'audio',
      url,
      filePath,
      prompt: targetText,
      sourceText: targetText,
      provider: 'minimax',
      model: process.env.MINIMAX_TTS_MODEL || 'speech-2.8-hd',
      userId: 'demo-user',
      metadata: {
        durationMs: item.durationMs,
        segmentCount: 1,
        script: [
          {
            segmentId: 's001',
            speakerCode: 'char_watson',
            templateCode: null,
            displayName: '华生医生',
            text: '那么，什么事——失火了吗？',
            durationMs: item.durationMs
          }
        ],
        voicesInitializedNow: false,
        traceId: item.traceId,
        importedFromExistingFile: true
      }
    });

    imported.push({ id: asset.id, url: asset.url });
  }

  console.log(JSON.stringify({ imported, skipped, range }, null, 2));
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
