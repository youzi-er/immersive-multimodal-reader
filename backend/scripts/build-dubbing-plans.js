import 'dotenv/config';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { listContentUnits } from '../src/content-units.js';
import {
  createPreparedSegments,
  inferPreparedSpeaker,
  splitDialogueAndNarration
} from '../src/prepared-dubbing-plans.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const outputDir = path.resolve(__dirname, '../content/dubbing-plans');
const planPath = path.join(outputDir, 'speckled-band.v1.json');
const voiceSourcePath = path.resolve(__dirname, '../cache/speckled-band-voices.json');
const voiceTargetPath = path.join(outputDir, 'speckled-band.voices.v1.json');
const speakerReviewPath = path.join(outputDir, 'speckled-band-speakers.v1.json');

let reviewedSpeakers = {};
try {
  reviewedSpeakers = JSON.parse(await fs.readFile(speakerReviewPath, 'utf8')).assignments || {};
} catch {
  console.warn('No reviewed speaker assignments found; using deterministic attribution rules.');
}

const units = listContentUnits({ articleId: 'speckled-band' })
  .map((unit) => ({ unit, split: splitDialogueAndNarration(unit.sourceText) }))
  .filter((item) => item.split.dialogue.length > 0);

const explicit = units.map((item) => {
  const assignment = inferPreparedSpeaker({ narration: item.split.narration, dialogue: item.split.dialogue });
  const isFallback = !assignment.speakerCode && assignment.templateCode === 'tpl_male_middle';
  return isFallback ? null : assignment;
});

let previousSpeaker = null;
let previousChapterId = null;
let lastHolmesPartner = 'char_watson';
const entries = units.map((item, index) => {
  if (item.unit.chapterId !== previousChapterId) {
    previousSpeaker = null;
    previousChapterId = item.unit.chapterId;
  }
  const nextSpeaker = explicit.slice(index + 1).find((entry) => entry?.speakerCode)?.speakerCode || null;
  let assignment = reviewedSpeakers[item.unit.id] || explicit[index];
  if (!assignment && previousSpeaker === 'char_holmes') {
    assignment = { speakerCode: lastHolmesPartner, templateCode: null };
  } else if (!assignment && previousSpeaker && previousSpeaker !== 'char_holmes') {
    assignment = { speakerCode: 'char_holmes', templateCode: null };
  } else if (!assignment) {
    assignment = inferPreparedSpeaker({
    narration: item.split.narration,
    dialogue: item.split.dialogue,
    previousSpeaker,
    nextSpeaker
    });
  }
  if (assignment.speakerCode && assignment.speakerCode !== 'char_holmes') {
    lastHolmesPartner = assignment.speakerCode;
  }
  previousSpeaker = assignment.speakerCode || previousSpeaker;
  return {
    unitId: item.unit.id,
    chapterId: item.unit.chapterId,
    paragraphIndex: item.unit.paragraphIndex,
    sourceHash: item.unit.sourceHash,
    segments: createPreparedSegments({ sourceText: item.unit.sourceText, ...assignment })
  };
});

const contentVersion = crypto
  .createHash('sha256')
  .update(entries.map((entry) => `${entry.unitId}:${entry.sourceHash}`).join('\n'))
  .digest('hex');

const manifest = {
  schemaVersion: 1,
  articleId: 'speckled-band',
  contentVersion,
  preparationMode: 'deterministic-editorial-v1',
  entries
};

await fs.mkdir(outputDir, { recursive: true });
await fs.writeFile(planPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
await fs.copyFile(voiceSourcePath, voiceTargetPath);
console.log(`Prepared ${entries.length} dubbing units at ${planPath}`);
