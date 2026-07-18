import test from 'node:test';
import assert from 'node:assert/strict';
import { buildCoverPrompt } from '../src/services/coverImage.js';

test('guided cover prompts preserve the creator direction and add the official poster system', () => {
  const bookStyle = {
    global_style_prompt: 'locked classical literary illustration, film still feeling',
    global_negative_prompt: 'locked modern objects, cartoon style, text overlay'
  };
  const result = buildCoverPrompt({
    mode: 'guided',
    prompt: '一条斑驳的丝带悬在阴影里，远处是维多利亚庄园',
    parameters: {
      cast: '三人群像',
      relationship: '同望画外',
      storyBeat: '危险前一秒',
      performance: '高度警觉',
      shotSize: '中景群像',
      cameraAngle: '门框窥视',
      lighting: '油灯侧光',
      colorGrade: '书籍默认',
      texture: '胶片颗粒'
    },
    bookTitle: '斑点带子案',
    bookAuthor: 'Arthur Conan Doyle',
    bookStyle
  });
  assert.equal(result.prompt, '一条斑驳的丝带悬在阴影里，远处是维多利亚庄园');
  assert.match(result.finalPrompt, /vertical 2:3 character-led cover/i);
  assert.ok(result.finalPrompt.includes(bookStyle.global_style_prompt));
  assert.ok(result.finalPrompt.includes(bookStyle.global_negative_prompt));
  assert.match(result.finalPrompt, /film still feeling/i);
  assert.match(result.finalPrompt, /three-person ensemble/i);
  assert.match(result.finalPrompt, /shared off-screen eyeline/i);
  assert.match(result.finalPrompt, /one second before danger/i);
  assert.match(result.finalPrompt, /doorway voyeur angle/i);
  assert.match(result.finalPrompt, /oil-lamp sidelight/i);
  assert.match(result.finalPrompt, /fine 35mm grain/i);
  assert.match(result.finalPrompt, /text overlay/i);
  assert.ok(result.finalPrompt.length <= 1500);
});

test('advanced cover prompts are passed through without the official style template', () => {
  const prompt = 'Minimalist black paper texture, one silver bell rope, brutalist composition';
  const result = buildCoverPrompt({ mode: 'advanced', prompt });
  assert.equal(result.finalPrompt, prompt);
});
