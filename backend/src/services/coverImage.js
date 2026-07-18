const MAX_COVER_PROMPT_LENGTH = 1500;

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
  'FORMAT=vertical 2:3 cinematic cover',
  'natural readable faces, film-still depth',
  'quiet dark lower quarter for external title'
].join('; ');

const COVER_AVOID = [
  'empty scene',
  'abstract or symbol-only poster',
  'celebrity likeness',
  'generated text'
].join(', ');

const FOCUS_DIRECTIONS = {
  '福尔摩斯': 'Sherlock Holmes',
  '华生': 'Dr. Watson',
  '女委托人（海伦）': 'Helen Stoner, the young female client',
  '罗伊洛特博士': 'Dr. Grimesby Roylott'
};

const CAST_DIRECTIONS = {
  '单主角': ({ focus }) =>
    `CAST=EXACTLY ONE visible human, ${focus}; exactly one face; no companion, silhouette, reflection, portrait, or background person`,
  '双人主导': ({ focus }) =>
    `CAST=EXACTLY TWO humans and two faces, led by ${focus}; no third person, crowd, portrait, or reflection`,
  '三人群像': ({ focus }) =>
    `CAST=EXACTLY THREE humans and three faces, ${focus} as visual anchor; no fourth person, crowd, portrait, or reflection`,
  '主角与威胁': ({ focus }) =>
    `CAST=EXACTLY TWO figures and two faces: ${focus} plus one threat; no bystander or crowd`
};

const SOLO_RELATIONSHIPS = new Set(['望向画外', '直视镜头', '侧身思考', '凝视线索']);

const RELATIONSHIP_DIRECTIONS = {
  '望向画外': 'BLOCKING=solo gaze toward an unseen off-frame person or sound; nobody else visible',
  '直视镜头': 'BLOCKING=solo controlled direct gaze into camera',
  '侧身思考': 'BLOCKING=solo three-quarter profile in private thought',
  '凝视线索': 'BLOCKING=solo subject studies one clue near the face; no other hands',
  '并肩侦查': 'BLOCKING=allies search side by side',
  '前后守望': 'BLOCKING=layered depth, others guarding behind the lead',
  '紧张对峙': 'BLOCKING=clear face-to-face confrontation',
  '同望画外': 'BLOCKING=all visible figures share one off-screen eyeline'
};

const STORY_BEAT_DIRECTIONS = {
  '初见委托': 'STORY=first consultation at 221B Baker Street, early morning; case just presented; NOT a manor investigation or imminent-danger climax',
  '发现线索': 'STORY=instant a decisive physical clue is noticed; NOT an attack or final revelation',
  '危险前一秒': 'STORY=one suspended second before an off-frame threat strikes; danger not yet resolved',
  '真相揭开': 'STORY=deduction lands and the hidden mechanism becomes clear; no active combat'
};

const PERFORMANCE_DIRECTIONS = {
  '克制不安': 'ACTING=restrained unease held behind the eyes',
  '冷静推理': 'ACTING=calm analytical focus',
  '高度警觉': 'ACTING=high alertness, no exaggerated pose',
  '惊恐爆发': 'ACTING=sudden readable shock, natural anatomy'
};

const SHOT_DIRECTIONS = {
  '面部特写': ({ faceCount }) => faceCount === 1
    ? 'CAMERA=tight facial close-up; single face fills 65-75% of frame; shoulder crop; no second face'
    : `CAMERA=tight close-up; exactly ${faceCount} readable faces dominate frame; no extra face`,
  '半身近景': ({ faceCount }) =>
    `CAMERA=waist-up close shot; exactly ${faceCount} face${faceCount === 1 ? '' : 's'}; environment secondary`,
  '中景群像': ({ faceCount }) =>
    `CAMERA=medium frame; exactly ${faceCount} face${faceCount === 1 ? '' : 's'}; clear body language`,
  '环境全景': ({ faceCount }) =>
    `CAMERA=wide environment; exactly ${faceCount} identifiable figure${faceCount === 1 ? '' : 's'}; no distant crowd`
};

const CAMERA_DIRECTIONS = {
  '平视在场': 'ANGLE=eye level, immediate',
  '低机位压迫': 'ANGLE=controlled low-angle pressure',
  '门框窥视': 'ANGLE=through doorway or architectural frame',
  '轻微倾斜': 'ANGLE=subtle dutch tilt, no distortion'
};

const LIGHTING_DIRECTIONS = {
  '油灯侧光': 'LIGHT=oil-lamp sidelight',
  '冷月逆光': 'LIGHT=cold moonlit rim light',
  '壁炉跳光': 'LIGHT=flickering firelight',
  '窗格切光': 'LIGHT=window-slat light across face'
};

const COLOR_DIRECTIONS = {
  '书籍默认': 'COLOR=locked book palette',
  '墨绿旧金': 'COLOR=bottle green, restrained old gold',
  '午夜蓝银': 'COLOR=midnight blue, restrained silver',
  '暗红象牙': 'COLOR=oxblood, aged ivory'
};

const TEXTURE_DIRECTIONS = {
  '插图原貌': 'FINISH=locked literary illustration',
  '更写实': 'FINISH=realistic face, skin, fabric and lens texture within locked illustration style',
  '油画笔触': 'FINISH=restrained oil-paint brushwork, no abstraction',
  '胶片颗粒': 'FINISH=fine 35mm film grain, realistic period texture'
};

const FACE_COUNTS = {
  '单主角': 1,
  '双人主导': 2,
  '三人群像': 3,
  '主角与威胁': 2
};

function clean(value, maxLength) {
  return String(value || '').trim().replace(/\s+/g, ' ').slice(0, maxLength);
}

function compactList(value, maxLength) {
  const cleaned = clean(value, maxLength * 3);
  if (cleaned.length <= maxLength) return cleaned;
  const parts = cleaned.split(/,\s*/).filter(Boolean);
  const kept = [];
  for (const part of parts) {
    const candidate = [...kept, part].join(', ');
    if (candidate.length > maxLength) break;
    kept.push(part);
  }
  return kept.length ? kept.join(', ') : cleaned.slice(0, maxLength);
}

function bookStyleValue(bookStyle, key, fallback, maxLength) {
  return compactList(bookStyle?.[key] || fallback, maxLength);
}

function knownDirection(map, value, label) {
  const direction = map[value];
  if (!direction) throw new Error(`不支持的${label}：${value || '未选择'}`);
  return direction;
}

function normalizeGuidedControls({ parameters, mood, palette, composition }) {
  const source = parameters && typeof parameters === 'object' ? parameters : {};
  const controls = {
    focus: clean(source.focus || '福尔摩斯', 64),
    cast: clean(source.cast || '单主角', 64),
    relationship: clean(source.relationship || '', 64),
    storyBeat: clean(source.storyBeat || '初见委托', 64),
    performance: clean(source.performance || mood || '克制不安', 64),
    shotSize: clean(source.shotSize || composition || '面部特写', 64),
    cameraAngle: clean(source.cameraAngle || '平视在场', 64),
    lighting: clean(source.lighting || '油灯侧光', 64),
    colorGrade: clean(source.colorGrade || palette || '书籍默认', 64),
    texture: clean(source.texture || '插图原貌', 64)
  };
  controls.relationship ||= controls.cast === '单主角' ? '望向画外' : '同望画外';

  if (!FOCUS_DIRECTIONS[controls.focus]) throw new Error(`不支持的主体角色：${controls.focus}`);
  if (!CAST_DIRECTIONS[controls.cast]) throw new Error(`不支持的人物阵容：${controls.cast}`);
  if (!RELATIONSHIP_DIRECTIONS[controls.relationship]) {
    throw new Error(`不支持的关系调度：${controls.relationship}`);
  }
  const isSoloRelationship = SOLO_RELATIONSHIPS.has(controls.relationship);
  if (controls.cast === '单主角' && !isSoloRelationship) {
    throw new Error('“单主角”不能搭配多人关系，请改用望向画外、直视镜头、侧身思考或凝视线索');
  }
  if (controls.cast !== '单主角' && isSoloRelationship) {
    throw new Error('多人阵容不能搭配单人调度，请重新选择人物关系');
  }
  return controls;
}

function castSpecificAvoid(controls) {
  if (controls.cast === '单主角') {
    return 'second person, extra person, multiple people or faces, group or crowd, background human, human reflection';
  }
  const allowedFaces = FACE_COUNTS[controls.cast];
  return `more than ${allowedFaces} people, extra face, background crowd, human portrait, human reflection`;
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

  const controls = normalizeGuidedControls({ parameters, mood, palette, composition });
  const focus = FOCUS_DIRECTIONS[controls.focus];
  const faceCount = FACE_COUNTS[controls.cast];
  const hardConstraints = [
    'HARD VISUAL CONSTRAINTS—override all conflicts below',
    CAST_DIRECTIONS[controls.cast]({ focus }),
    knownDirection(STORY_BEAT_DIRECTIONS, controls.storyBeat, '戏剧节点'),
    knownDirection(RELATIONSHIP_DIRECTIONS, controls.relationship, '关系调度'),
    knownDirection(PERFORMANCE_DIRECTIONS, controls.performance, '表演强度'),
    SHOT_DIRECTIONS[controls.shotSize]?.({ faceCount }),
    knownDirection(CAMERA_DIRECTIONS, controls.cameraAngle, '摄影机位'),
    knownDirection(LIGHTING_DIRECTIONS, controls.lighting, '叙事光源'),
    knownDirection(COLOR_DIRECTIONS, controls.colorGrade, '色彩方案'),
    knownDirection(TEXTURE_DIRECTIONS, controls.texture, '质感偏移')
  ].filter(Boolean).join('; ');
  if (!SHOT_DIRECTIONS[controls.shotSize]) throw new Error(`不支持的人物景别：${controls.shotSize}`);

  const stylePrompt = bookStyleValue(
    bookStyle,
    'global_style_prompt',
    FALLBACK_ILLUSTRATION_STYLE,
    140
  );
  const negativePrompt = bookStyleValue(
    bookStyle,
    'global_negative_prompt',
    FALLBACK_NEGATIVE,
    60
  );
  const scenePrefix = 'SCENE NOTES—compatible setting and props only; ignore conflicts in people, story, relationship, or framing=';
  const suffix = [
    COVER_ADAPTATION,
    `LOCKED BOOK STYLE=${stylePrompt}`,
    `NEGATIVE=${negativePrompt}, ${COVER_AVOID}, ${castSpecificAvoid(controls)}`
  ].join('. ');
  const fixedLength = hardConstraints.length + scenePrefix.length + suffix.length + 6;
  const availableSceneChars = MAX_COVER_PROMPT_LENGTH - fixedLength;
  if (availableSceneChars < 5) {
    throw new Error('全书插图风格与导演硬约束过长，无法在模型限制内组合封面提示词');
  }
  const sceneDirection = clean(safePrompt, availableSceneChars);
  const finalPrompt = `${hardConstraints}. ${scenePrefix}${sceneDirection}. ${suffix}.`;
  if (finalPrompt.length > MAX_COVER_PROMPT_LENGTH) {
    throw new Error('组合后的封面提示词过长，请精简创意描述');
  }
  return { prompt: safePrompt, finalPrompt };
}

export const officialCoverStyle = FALLBACK_ILLUSTRATION_STYLE;
