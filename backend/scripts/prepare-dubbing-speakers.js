import dotenv from 'dotenv';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { listContentUnits } from '../src/content-units.js';
import { callMessagesApiForJsonWithRetry } from '../src/services/minimax.js';
import { splitDialogueAndNarration } from '../src/prepared-dubbing-plans.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../../.env') });
dotenv.config({ path: path.resolve(__dirname, '../.env') });
const outputPath = path.resolve(__dirname, '../content/dubbing-plans/speckled-band-speakers.v1.json');
const roleCodes = new Set(['char_holmes', 'char_watson', 'char_helen', 'char_royllott']);
const templateCodes = new Set(['tpl_male_young', 'tpl_male_middle', 'tpl_female_young', 'tpl_female_middle']);

const system = `你是《斑点带子案》有声书的编辑，只负责判断每个标准段落中的直接引语由谁说。
允许的主要角色：char_holmes（福尔摩斯）、char_watson（华生，也是第一人称叙述者）、char_helen（海伦·斯托纳）、char_royllott（罗伊洛特医生）。
无法对应主要角色时使用模板：tpl_male_young、tpl_male_middle、tpl_female_young、tpl_female_middle。
结合段落顺序、叙述性引导语、问答关系判断。注意“他安慰她说”中说话人是“他”，“她”是被安慰者；“我说/我问”通常是华生。
每个 unitId 必须且只能返回一项。speakerCode 与 templateCode 必须一项有值、另一项为 null。
只输出 JSON：{"assignments":[{"unitId":"...","speakerCode":"char_holmes","templateCode":null}]}`;

function validateAssignments(result, expectedIds) {
  if (!Array.isArray(result?.assignments) || result.assignments.length !== expectedIds.length) {
    throw new Error(`角色审核返回 ${result?.assignments?.length ?? 0} 项，预期 ${expectedIds.length} 项`);
  }
  const byId = new Map();
  for (const assignment of result.assignments) {
    if (!expectedIds.includes(assignment.unitId) || byId.has(assignment.unitId)) {
      throw new Error(`角色审核包含未知或重复 unitId：${assignment.unitId}`);
    }
    const roleValid = assignment.speakerCode && roleCodes.has(assignment.speakerCode) && !assignment.templateCode;
    const templateValid = assignment.templateCode && templateCodes.has(assignment.templateCode) && !assignment.speakerCode;
    if (!roleValid && !templateValid) throw new Error(`角色审核归属无效：${assignment.unitId}`);
    byId.set(assignment.unitId, {
      speakerCode: assignment.speakerCode || null,
      templateCode: assignment.templateCode || null
    });
  }
  return byId;
}

const units = listContentUnits({ articleId: 'speckled-band' })
  .map((unit) => ({ unit, split: splitDialogueAndNarration(unit.sourceText) }))
  .filter((item) => item.split.dialogue.length > 0);
const chapterIds = [...new Set(units.map((item) => item.unit.chapterId))];
const assignments = {};

for (const chapterId of chapterIds) {
  const chapterUnits = units.filter((item) => item.unit.chapterId === chapterId);
  const input = chapterUnits.map((item) => ({
    unitId: item.unit.id,
    paragraphIndex: item.unit.paragraphIndex,
    dialogue: item.split.dialogue,
    narrationAroundDialogue: item.split.narration
  }));
  let lastError;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const result = await callMessagesApiForJsonWithRetry({
        system,
        user: JSON.stringify({ chapterId, orderedParagraphs: input }),
        temperature: 0.1,
        maxTokens: 3200
      });
      const validated = validateAssignments(result, input.map((item) => item.unitId));
      for (const [unitId, assignment] of validated) assignments[unitId] = assignment;
      console.log(`Reviewed ${chapterId}: ${validated.size} units`);
      lastError = null;
      break;
    } catch (error) {
      lastError = error;
      console.warn(`Review attempt ${attempt} failed for ${chapterId}: ${error.message}`);
    }
  }
  if (lastError) throw lastError;
}

await fs.writeFile(
  outputPath,
  `${JSON.stringify({ schemaVersion: 1, articleId: 'speckled-band', assignments }, null, 2)}\n`,
  'utf8'
);
console.log(`Saved ${Object.keys(assignments).length} reviewed speaker assignments to ${outputPath}`);
