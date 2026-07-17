import test from 'node:test';
import assert from 'node:assert/strict';
import {
  applyMiniMaxRecipeToBody,
  compileMiniMaxAnnotatedText,
  createMiniMaxGenerationSettings,
  createMiniMaxSegmentRecipe,
  getMiniMaxSpeechCapabilities,
  validateMiniMaxSegmentRecipe
} from '../src/services/minimaxSpeechRecipe.js';

test('publishes MiniMax controls from a centralized capability definition', () => {
  const capabilities = getMiniMaxSpeechCapabilities();
  assert.equal(capabilities.provider, 'minimax');
  assert.deepEqual(capabilities.ranges.speed, { min: 0.5, max: 2, step: 0.05, default: 1 });
  assert.ok(capabilities.vocalTags.some((item) => item.value === 'inhale'));
  assert.ok(capabilities.soundEffects.some((item) => item.value === 'robotic'));
});

test('compiles structured pause and vocal annotations without changing source text', () => {
  const source = '那么，什么事？';
  const annotated = compileMiniMaxAnnotatedText(source, [
    { id: 'pause-1', type: 'pause', offset: 3, durationSeconds: 0.35 },
    { id: 'vocal-1', type: 'vocal', offset: 6, value: 'inhale' }
  ]);
  assert.equal(annotated, '那么，<#0.35#>什么事(inhale)？');
  assert.equal(source, '那么，什么事？');
});

test('maps the complete creator recipe to a MiniMax request body', () => {
  const settings = createMiniMaxGenerationSettings();
  const recipe = createMiniMaxSegmentRecipe({
    annotations: [{ id: 'pause-1', type: 'pause', offset: 2, durationSeconds: 0.6 }],
    pronunciation: ['处理/(chu3)(li3)'],
    voiceSource: {
      mode: 'blend',
      timbreWeights: [
        { voiceId: 'voice-a', weight: 70 },
        { voiceId: 'voice-b', weight: 30 }
      ]
    },
    voiceSetting: {
      speed: 0.95,
      volume: 1.2,
      pitch: 1,
      emotion: 'surprised',
      englishNormalization: true
    },
    voiceModify: {
      pitch: -10,
      intensity: -20,
      timbre: 15,
      soundEffects: 'spacious_echo'
    }
  });
  const body = applyMiniMaxRecipeToBody({
    body: { text: '处理问题' },
    recipeInput: recipe,
    generationSettingsInput: settings,
    defaultVoiceId: 'unused-default'
  });

  assert.equal(body.text, '处理<#0.6#>问题');
  assert.equal(body.voice_setting.voice_id, undefined);
  assert.equal(body.voice_setting.speed, 0.95);
  assert.equal(body.voice_setting.emotion, 'surprised');
  assert.deepEqual(body.timbre_weights, [
    { voice_id: 'voice-a', weight: 70 },
    { voice_id: 'voice-b', weight: 30 }
  ]);
  assert.deepEqual(body.pronunciation_dict.tone, ['处理/(chu3)(li3)']);
  assert.equal(body.voice_modify.sound_effects, 'spacious_echo');
  assert.equal(body.subtitle_type, 'word');
});

test('rejects invalid pauses, ranges and timbre blends before calling MiniMax', () => {
  assert.throws(
    () => validateMiniMaxSegmentRecipe(createMiniMaxSegmentRecipe({
      annotations: [{ id: 'pause', type: 'pause', offset: 0, durationSeconds: 0.3 }]
    }), '测试'),
    /停顿必须位于/
  );
  assert.throws(
    () => validateMiniMaxSegmentRecipe(createMiniMaxSegmentRecipe({
      voiceSetting: { speed: 2.5 }
    }), '测试'),
    /语速必须在/
  );
  assert.throws(
    () => validateMiniMaxSegmentRecipe(createMiniMaxSegmentRecipe({
      voiceSource: { mode: 'blend', timbreWeights: [{ voiceId: 'only-one', weight: 50 }] }
    }), '测试'),
    /2–4 个音色/
  );
});

test('enforces model-specific vocal tag support', () => {
  const recipe = createMiniMaxSegmentRecipe({
    annotations: [{ id: 'vocal', type: 'vocal', offset: 1, value: 'inhale' }]
  });
  assert.throws(
    () => applyMiniMaxRecipeToBody({
      body: { text: '测试' },
      recipeInput: recipe,
      generationSettingsInput: createMiniMaxGenerationSettings({ model: 'speech-02-hd' }),
      defaultVoiceId: 'voice-a'
    }),
    /不支持语气词标签/
  );
});
