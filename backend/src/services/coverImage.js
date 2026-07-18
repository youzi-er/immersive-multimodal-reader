const FALLBACK_ILLUSTRATION_STYLE = [
  'cinematic realistic novel illustration',
  'grounded atmosphere',
  'restrained elegant art direction',
  'natural human proportions',
  'real fabric texture',
  'atmospheric depth',
  'soft volumetric light',
  'muted color palette',
  'film still feeling',
  'high detail',
  'clean readable scene design'
].join(', ');

const FALLBACK_NEGATIVE = [
  'modern clothing',
  'anachronistic objects',
  'bright neon colors',
  'cartoon',
  'anime',
  'deformed anatomy',
  'extra fingers',
  'watermark',
  'text overlay'
].join(', ');

const COVER_ADAPTATION = [
  'vertical 2:3 character-led cover',
  'expressive readable faces and cinematic depth',
  'lower quarter dark and quiet for external title'
].join(', ');

const COVER_AVOID = [
  'empty scene',
  'abstract poster',
  'symbol-only composition',
  'celebrity likeness'
].join(', ');

const PARAMETER_DIRECTIONS = {
  cast: {
    '单主角': 'one lead',
    '双人主导': 'two leads',
    '三人群像': 'three-person ensemble',
    '主角与威胁': 'lead plus looming antagonist'
  },
  relationship: {
    '并肩侦查': 'allied, searching together',
    '前后守望': 'layered, guarding each other',
    '紧张对峙': 'face-to-face conflict',
    '同望画外': 'shared off-screen eyeline'
  },
  storyBeat: {
    '初见委托': 'first uneasy meeting',
    '发现线索': 'clue discovered',
    '危险前一秒': 'one second before danger',
    '真相揭开': 'revelation lands'
  },
  performance: {
    '克制不安': 'restrained unease',
    '冷静推理': 'focused deduction',
    '高度警觉': 'alert tension',
    '惊恐爆发': 'raw fear'
  },
  shotSize: {
    '面部特写': 'close-up faces',
    '半身近景': 'waist-up medium close',
    '中景群像': 'medium ensemble',
    '环境全景': 'wide environmental frame'
  },
  cameraAngle: {
    '平视在场': 'eye-level camera',
    '低机位压迫': 'low-angle pressure',
    '门框窥视': 'doorway voyeur angle',
    '轻微倾斜': 'subtle dutch angle'
  },
  lighting: {
    '油灯侧光': 'oil-lamp sidelight',
    '冷月逆光': 'cold moon backlight',
    '壁炉跳光': 'firelight flicker',
    '窗格切光': 'window-slat light'
  },
  colorGrade: {
    '书籍默认': 'locked book palette',
    '墨绿旧金': 'bottle green and old gold',
    '午夜蓝银': 'midnight blue and silver',
    '暗红象牙': 'oxblood and ivory'
  },
  texture: {
    '插图原貌': 'locked illustration finish',
    '更写实': 'more realistic texture',
    '油画笔触': 'restrained visible brushwork',
    '胶片颗粒': 'fine 35mm grain'
  }
};

function clean(value, maxLength) {
  return String(value || '').trim().replace(/\s+/g, ' ').slice(0, maxLength);
}

function bookStyleValue(bookStyle, key, fallback, maxLength) {
  const value = clean(bookStyle?.[key], maxLength);
  return value || fallback;
}

function parameterDirection(key, value) {
  const cleaned = clean(value, 64);
  return PARAMETER_DIRECTIONS[key]?.[cleaned] || cleaned;
}

export function buildCoverPrompt({
  mode,
  prompt,
  mood,
  palette,
  composition,
  parameters,
  bookStyle
}) {
  const safePrompt = clean(prompt, mode === 'guided' ? 180 : 1400);
  if (safePrompt.length < 5) throw new Error('封面描述至少需要 5 个字');
  if (mode === 'advanced') {
    return { prompt: safePrompt, finalPrompt: safePrompt };
  }
  if (mode !== 'guided') throw new Error('不支持的封面创作模式');

  const stylePrompt = bookStyleValue(
    bookStyle,
    'global_style_prompt',
    FALLBACK_ILLUSTRATION_STYLE,
    700
  );
  const negativePrompt = bookStyleValue(
    bookStyle,
    'global_negative_prompt',
    FALLBACK_NEGATIVE,
    450
  );
  const controls = {
    ...(parameters && typeof parameters === 'object' ? parameters : {}),
    performance: parameters?.performance || mood,
    colorGrade: parameters?.colorGrade || palette,
    shotSize: parameters?.shotSize || composition
  };
  const directorControls = Object.keys(PARAMETER_DIRECTIONS)
    .map((key) => parameterDirection(key, controls[key]))
    .filter(Boolean)
    .join('; ');
  const fixedPrompt = [
    COVER_ADAPTATION,
    directorControls ? `Director controls: ${directorControls}` : '',
    stylePrompt,
    `Avoid: ${negativePrompt}, ${COVER_AVOID}`
  ].filter(Boolean).join('. ');
  const scenePrefix = 'Scene direction: ';
  const availableSceneChars = 1499 - scenePrefix.length - fixedPrompt.length - 3;
  if (availableSceneChars < 5) {
    throw new Error('全书插图风格过长，无法在模型限制内组合封面提示词');
  }
  const sceneDirection = clean(safePrompt, availableSceneChars);
  const finalPrompt = `${scenePrefix}${sceneDirection}. ${fixedPrompt}.`;
  if (finalPrompt.length > 1500) throw new Error('组合后的封面提示词过长，请精简创意描述');
  return { prompt: safePrompt, finalPrompt };
}

export const officialCoverStyle = FALLBACK_ILLUSTRATION_STYLE;
