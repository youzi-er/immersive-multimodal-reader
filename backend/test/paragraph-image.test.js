import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildParagraphImageRequest,
  compactParagraphPlanToBudget,
  paragraphPromptLimitsForStyle,
  validateParagraphPlan
} from '../src/services/paragraphIllustration.js';

const style = {
  global_style_prompt: 'locked Victorian realism '.repeat(18).trim(),
  global_negative_prompt: 'text, watermark, modern objects, cartoon'
};

function validPlan() {
  return {
    scene_prompt_en:
      'Medium shot from eye level of a worried woman beside a dark wooden table, window light from the left, muted green and grey colors.',
    avoid_en: 'smiling expression, extra people',
    aspect_ratio: '16:9',
    _meta: {
      component_type: 'single_character_keyframe',
      scene_summary_cn: '一名忧虑的女子站在昏暗房间的木桌旁。'
    }
  };
}

test('programmatically assembles paragraph prompt with exact locked strings', () => {
  const plan = validateParagraphPlan(validPlan(), style);
  const request = buildParagraphImageRequest(plan, style);
  assert.ok(request.prompt.length < 1400);
  assert.ok(request.prompt.includes(style.global_style_prompt));
  assert.ok(request.prompt.includes(style.global_negative_prompt));
  assert.equal(request._meta.prompt_char_count, request.prompt.length);
  assert.equal(request.model, 'image-01');
});

test('reserves final prompt budget before asking the paragraph planner', () => {
  const limits = paragraphPromptLimitsForStyle(style);
  assert.ok(limits.scene_prompt_en_max <= 600);
  assert.equal(limits.avoid_en_max, 100);
  assert.equal(limits.final_prompt_max, 1400);
});

test('rejects a plan that repeats locked prompt material', () => {
  const plan = validPlan();
  plan.scene_prompt_en += ` ${style.global_style_prompt}`;
  assert.throws(() => validateParagraphPlan(plan, style), /不得重复锁定风格/);
});

test('automatically compacts an oversized paragraph plan without changing locked strings', () => {
  const plan = validPlan();
  plan.scene_prompt_en =
    'Detailed medium shot with a single visual focus, period room context, restrained posture and directional window lighting '.repeat(
      8
    );
  plan.avoid_en =
    'extra people, readable letters, modern furniture, bright studio background, exaggerated expression, clutter';
  const compacted = compactParagraphPlanToBudget(plan, style);
  const request = buildParagraphImageRequest(compacted, style);
  assert.ok(compacted.scene_prompt_en.length <= 600);
  assert.ok(compacted.avoid_en.length <= 100);
  assert.ok(request.prompt.length < 1400);
  assert.ok(request.prompt.includes(style.global_style_prompt));
  assert.ok(request.prompt.includes(style.global_negative_prompt));
});
