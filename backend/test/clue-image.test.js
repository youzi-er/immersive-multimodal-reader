import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildLockedImageRequest,
  compactPlanToBudget,
  promptLimitsForStyle,
  validateAutomaticPlan
} from '../src/services/clueImage.js';

const style = {
  global_style_prompt: 'locked Victorian realism '.repeat(18).trim(),
  global_negative_prompt: 'text, watermark, modern objects, cartoon'
};

function validPlan() {
  return {
    decision: 'generate',
    scene_prompt_en: 'Close contextual view of a worn paper ticket resting inside a dark leather glove.',
    avoid_en: 'readable writing',
    aspect_ratio: '4:3',
    _meta: {
      clue_type: 'evidence',
      image_mode: 'evidence_contextual_closeup',
      subject: 'ticket',
      scene_anchor_cn: '深色皮手套',
      visual_focus_cn: '露出的旧车票',
      visual_facts_cn: ['旧纸票位于手套内'],
      ambiguity_notes_cn: ['不显示票面文字']
    }
  };
}

test('assembles locked prompts under the final hard limit', () => {
  const plan = validateAutomaticPlan(validPlan(), style);
  const request = buildLockedImageRequest(plan, style);
  assert.ok(request.prompt.length < 1400);
  assert.ok(request.prompt.includes(style.global_style_prompt));
  assert.ok(request.prompt.includes(style.global_negative_prompt));
  assert.equal(request.aspect_ratio, '4:3');
});

test('derives a scene budget that reserves avoid and locked strings', () => {
  const limits = promptLimitsForStyle(style);
  assert.ok(limits.scene_prompt_en_max <= 600);
  assert.equal(limits.avoid_en_max, 100);
  assert.equal(limits.final_prompt_max, 1400);

  const oversized = validPlan();
  oversized.scene_prompt_en = 'x'.repeat(601);
  assert.throws(() => validateAutomaticPlan(oversized, style), /scene_prompt_en 长度/);
});

test('automatically compacts an overlong assembled prompt without changing locked strings', () => {
  const longPlan = validPlan();
  longPlan.scene_prompt_en = 'detailed Victorian evidence closeup with contextual material and focused lighting '.repeat(9);
  longPlan.avoid_en = 'extra props, hands, labels, readable text, modern paper, bright studio background';
  const compacted = compactPlanToBudget(longPlan, style);
  const request = buildLockedImageRequest(compacted, style);
  assert.ok(compacted.scene_prompt_en.length <= 600);
  assert.ok(compacted.avoid_en.length <= 100);
  assert.ok(compacted.avoid_en.includes('readable text'));
  assert.ok(request.prompt.length < 1400);
  assert.ok(request.prompt.includes(style.global_style_prompt));
  assert.ok(request.prompt.includes(style.global_negative_prompt));
});

test('official clues cannot be skipped or reclassified by the planner', () => {
  const skippedPlan = {
    decision: 'skip',
    _meta: {
      clue_type: 'nonvisual',
      image_mode: 'skip',
      subject: '口哨声',
      reason_cn: '声音无法直接呈现'
    }
  };
  assert.throws(
    () => validateAutomaticPlan(skippedPlan, style, { requireGeneration: true, expectedClueType: 'evidence' }),
    /必须生成图像/
  );

  const reclassifiedPlan = validPlan();
  assert.throws(
    () => validateAutomaticPlan(reclassifiedPlan, style, { requireGeneration: true, expectedClueType: 'location' }),
    /目录类型应为 location/
  );
});
