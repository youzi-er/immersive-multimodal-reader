import test from 'node:test';
import assert from 'node:assert/strict';
import { buildCoverPrompt } from '../src/services/coverImage.js';

test('guided cover prompts compile director settings ahead of supporting scene notes', () => {
  const bookStyle = {
    global_style_prompt: 'locked classical literary illustration, film still feeling',
    global_negative_prompt: 'locked modern objects, cartoon style, text overlay'
  };
  const result = buildCoverPrompt({
    mode: 'guided',
    prompt: '一条斑驳的丝带悬在阴影里，远处是维多利亚庄园',
    parameters: {
      focus: '福尔摩斯',
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
  assert.match(result.finalPrompt, /^HARD VISUAL CONSTRAINTS/i);
  assert.match(result.finalPrompt, /FORMAT=vertical 2:3 cinematic cover/i);
  assert.ok(result.finalPrompt.includes(bookStyle.global_style_prompt));
  assert.ok(result.finalPrompt.includes(bookStyle.global_negative_prompt));
  assert.match(result.finalPrompt, /film still feeling/i);
  assert.match(result.finalPrompt, /EXACTLY THREE humans and three faces/i);
  assert.match(result.finalPrompt, /all visible figures share one off-screen eyeline/i);
  assert.match(result.finalPrompt, /one suspended second before an off-frame threat strikes/i);
  assert.match(result.finalPrompt, /through doorway or architectural frame/i);
  assert.match(result.finalPrompt, /oil-lamp sidelight/i);
  assert.match(result.finalPrompt, /fine 35mm film grain/i);
  assert.match(result.finalPrompt, /text overlay/i);
  assert.ok(result.finalPrompt.indexOf('HARD VISUAL CONSTRAINTS') < result.finalPrompt.indexOf('SCENE NOTES'));
  assert.ok(result.finalPrompt.length <= 1500);
});

test('single-character close-up overrides a conflicting three-person danger note', () => {
  const sceneNote = '雨夜庄园内，福尔摩斯检查铃绳，华生回头，女继承人在身后，三个人等待危险发生';
  const result = buildCoverPrompt({
    mode: 'guided',
    prompt: sceneNote,
    parameters: {
      focus: '福尔摩斯',
      cast: '单主角',
      relationship: '望向画外',
      storyBeat: '初见委托',
      performance: '高度警觉',
      shotSize: '面部特写',
      cameraAngle: '轻微倾斜',
      lighting: '窗格切光',
      colorGrade: '午夜蓝银',
      texture: '更写实'
    }
  });

  assert.equal(result.prompt, sceneNote);
  assert.match(result.finalPrompt, /EXACTLY ONE visible human[^.]+Sherlock Holmes/i);
  assert.match(result.finalPrompt, /exactly one face/i);
  assert.match(result.finalPrompt, /no companion, silhouette, reflection, portrait, or background person/i);
  assert.match(result.finalPrompt, /first consultation at 221B Baker Street/i);
  assert.match(result.finalPrompt, /NOT a manor investigation or imminent-danger climax/i);
  assert.match(result.finalPrompt, /face fills 65-75% of frame/i);
  assert.match(result.finalPrompt, /ignore conflicts in people, story, relationship, or framing/i);
  assert.match(result.finalPrompt, /second person, extra person, multiple people/i);
  assert.ok(result.finalPrompt.indexOf('EXACTLY ONE') < result.finalPrompt.indexOf(sceneNote));
  assert.ok(result.finalPrompt.length <= 1500);
});

test('single-character mode rejects a multi-person blocking instruction', () => {
  assert.throws(() => buildCoverPrompt({
    mode: 'guided',
    prompt: '福尔摩斯在清晨接待委托',
    parameters: {
      focus: '福尔摩斯',
      cast: '单主角',
      relationship: '并肩侦查',
      storyBeat: '初见委托',
      performance: '克制不安',
      shotSize: '面部特写',
      cameraAngle: '平视在场',
      lighting: '窗格切光',
      colorGrade: '书籍默认',
      texture: '插图原貌'
    }
  }), /单主角.*多人关系/);
});

test('advanced cover prompts are passed through without the official style template', () => {
  const prompt = 'Minimalist black paper texture, one silver bell rope, brutalist composition';
  const result = buildCoverPrompt({ mode: 'advanced', prompt });
  assert.equal(result.finalPrompt, prompt);
});
