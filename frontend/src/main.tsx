import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import {
  computeSelectionLayout,
  getCaretPointFromPointer,
  getTextFromRange,
  normalizeRange,
  rangeKey,
  type SelectionLayout,
  type TextRange
} from './readerTextSelection';
import './styles.css';

type Page = 'home' | 'bookshelf' | 'reader' | 'login' | 'register' | 'profile' | 'speech-debug';

type User = {
  id: string;
  username: string;
  displayName: string;
  bio: string;
};

type TextSegment =
  | {
      type: 'narration';
      text: string;
    }
  | {
      type: 'clue';
      clueId: string;
      occurrenceId?: string;
      startOffset: number;
      endOffset: number;
      text: string;
    };

type Chapter = {
  id: string;
  title: string;
  subtitle: string;
  progress: number;
  paragraphs: TextSegment[][];
  scene: {
    title: string;
    imagePrompt: string;
    mood: string;
    soundscape: string;
  };
};

type Clue = {
  id: string;
  label: string;
  type: '物证' | '人物' | '地点' | string;
  surfaceDescription?: string;
  occurrences?: Array<{
    id: string;
    chapterId: string;
    paragraphIndex: number;
    selectedText: string;
    startOffset: number;
    endOffset: number;
  }>;
};

type CollectedClueRecord = {
  clueId: string;
  occurrenceId: string;
};

type ClueImage = {
  clueId: string;
  occurrenceId: string;
  skipped: boolean;
  reason?: string;
  imageUrl?: string;
  imageMode?: string;
  clueType?: string;
  subject?: string;
  prompt?: string;
  promptCharCount?: number;
  mediaAssetId?: string | null;
  cacheHit: boolean;
  userOverride: boolean;
  createdAt?: string;
  loading?: boolean;
  error?: string;
};

type ChatMessage = {
  role: 'reader' | 'assistant';
  content: string;
};

type GeneratedSceneImage = {
  imageUrl: string;
  prompt: string;
  mediaAssetId?: string | null;
  cacheHit?: boolean;
};

type ParagraphImage = {
  imageUrl: string;
  prompt: string;
  sceneSummaryCn: string;
  componentType: string;
  promptCharCount: number;
  traceId: string | null;
  styleInitializedNow: boolean;
  mediaAssetId?: string | null;
  mediaPersistenceError?: string | null;
};

type ParagraphSpeechScriptLine = {
  segmentId: string;
  speakerCode: string | null;
  templateCode: string | null;
  displayName: string;
  text: string;
  durationMs: number | null;
};

type ParagraphSpeech = {
  audioUrl: string;
  durationMs: number | null;
  segmentCount: number;
  script: ParagraphSpeechScriptLine[];
  voicesInitializedNow: boolean;
  traceId: string | null;
  mediaAssetId?: string | null;
  mediaPersistenceError?: string | null;
};

type VoiceRecording = {
  id: string;
  mediaAssetId: string;
  articleId: string;
  chapterId: string;
  paragraphIndex: number;
  range: TextRange;
  sourceText: string;
  userId: string;
  username: string;
  displayName: string;
  visibility: 'private' | 'public';
  audioUrl: string;
  likeCount: number;
  likedByMe: boolean;
  createdAt: string;
};

type VoiceRecordingGroup = {
  myRecording: VoiceRecording | null;
  publicRecordings: VoiceRecording[];
};

type DubbingStatus = 'private' | 'public' | 'withdrawn' | 'moderated' | 'deleted';
type DubbingKind = 'ai' | 'human';

type ContentUnit = {
  id: string;
  kind: 'paragraph-dialogue';
  articleId: string;
  chapterId: string;
  chapterTitle: string;
  paragraphIndex: number;
  sourceText: string;
  sourceHash: string;
  hasDialogue: boolean;
  range: TextRange;
};

type DubbingPerformance = {
  语速: string;
  情绪: string;
  强度: number;
  停顿: string;
  节奏: string;
  重读词: string[];
  语气词标签: { 前: string[]; 后: string[]; 句内: unknown[] };
};

type MiniMaxRange = { min: number; max: number; step: number; default: number };
type MiniMaxAnnotation =
  | { id: string; type: 'pause'; offset: number; durationSeconds: number }
  | { id: string; type: 'vocal'; offset: number; value: string };

type MiniMaxSegmentRecipe = {
  schemaVersion: 1;
  provider: 'minimax';
  annotations: MiniMaxAnnotation[];
  pronunciation: string[];
  voiceSource: {
    mode: 'default' | 'voiceId' | 'blend';
    voiceId: string;
    timbreWeights: Array<{ voiceId: string; weight: number }>;
  };
  voiceSetting: {
    speed: number;
    volume: number;
    pitch: number;
    emotion: string;
    latexRead: boolean;
    englishNormalization: boolean;
  };
  voiceModify: {
    pitch: number;
    intensity: number;
    timbre: number;
    soundEffects: string;
  };
};

type MiniMaxGenerationSettings = {
  schemaVersion: 1;
  provider: 'minimax';
  model: string;
  stream: boolean;
  streamOptions: { excludeAggregatedAudio: boolean };
  languageBoost: string;
  audioSetting: { sampleRate: number; bitrate: number; format: string; channel: number };
  subtitle: { enabled: boolean; type: string };
  outputFormat: string;
  aigcWatermark: boolean;
};

type MiniMaxCapabilities = {
  provider: 'minimax';
  schemaVersion: 1;
  models: string[];
  emotions: Array<{ value: string; label: string }>;
  vocalTags: Array<{ value: string; label: string }>;
  vocalTagModels: string[];
  soundEffects: Array<{ value: string; label: string }>;
  languages: string[];
  ranges: {
    speed: MiniMaxRange;
    volume: MiniMaxRange;
    pitch: MiniMaxRange;
    pause: MiniMaxRange;
    effect: MiniMaxRange;
    weight: MiniMaxRange;
  };
  audio: { sampleRates: number[]; bitrates: number[]; formats: string[]; channels: number[] };
  subtitleTypes: string[];
  outputFormats: string[];
  maxTimbreWeights: number;
};

type DubbingPlanSegment = {
  segmentId: string;
  speakerCode: string | null;
  templateCode: string | null;
  text: string;
  director: Record<string, unknown>;
  performance: DubbingPerformance;
  pronunciation: string[];
  recipe?: MiniMaxSegmentRecipe;
};

type DubbingPlan = {
  segments: DubbingPlanSegment[];
  roles: Array<{ code: string; label: string; tier: string }>;
  templates: Array<{ code: string; label: string }>;
  capabilities: MiniMaxCapabilities;
  generationSettings: MiniMaxGenerationSettings;
  voicesInitializedNow: boolean;
};

type AiComposerBinding = {
  unitId: string;
  sourceHash: string;
  selectionKey: string;
};

type VoiceDesignVersion = {
  id: string;
  designId: string;
  articleId: string;
  characterCode: string;
  characterName: string;
  ownerUserId: string;
  versionNumber: number;
  prompt: string;
  previewText: string;
  previewAudioUrl: string | null;
  createdAt: string;
};

type DubbingVersion = {
  id: string;
  projectId: string;
  versionNumber: number;
  ownerUserId: string;
  username: string;
  displayName: string;
  unitId: string;
  articleId: string;
  chapterId: string;
  paragraphIndex: number;
  kind: DubbingKind;
  status: DubbingStatus;
  audioUrl: string;
  mediaAssetId: string | null;
  sourceText: string;
  sourceHash: string;
  durationMs: number | null;
  promptSnapshot: {
    voiceDesigns?: Record<string, {
      versionId: string;
      characterName: string;
      prompt: string;
      previewText: string;
      versionNumber: number;
    }>;
    performanceSegments?: DubbingPlanSegment[];
    generationSettings?: MiniMaxGenerationSettings;
    ttsRequests?: Array<Record<string, unknown>>;
  } | null;
  segments: DubbingPlanSegment[];
  likeCount: number;
  adoptionCount: number;
  likedByMe: boolean;
  adoptedByMe: boolean;
  ownedByMe: boolean;
  createdAt: string;
  withdrawnAt: string | null;
};

type DubbingUnitBundle = {
  unit: ContentUnit;
  versions: DubbingVersion[];
};

type SpeechDebugEvent = {
  timestamp: number | null;
  runId: string;
  location: string;
  message: string;
  hypothesisId: string;
  data: unknown;
};

type SpeechDebugRecord = {
  id: string;
  startedAt: number | null;
  targetSegment: string;
  chapterId: string;
  paragraphIndex: number | null;
  segmentCount: number;
  traceIds: string[];
  events: SpeechDebugEvent[];
};

type SpeechDebugInfo = {
  cache: {
    initialized: boolean;
    status: string;
    bookId: string;
    createdAt?: string;
    skipVoiceDesign?: boolean;
    atmosphere: Record<string, unknown> | null;
    roles: Array<{ code: string; label: string; tier: string; voiceId: string }>;
    templates: Array<{ code: string; label: string; voiceId: string }>;
    pronunciationToneCount: number;
  };
  prompts: {
    phase1System: string;
    phase3aSystem: string;
  };
  records: SpeechDebugRecord[];
  eventCount: number;
};

type ImageDebugRecord = {
  id: string;
  startedAt: number | null;
  targetSegment: string;
  chapterId: string;
  paragraphIndex: number | null;
  componentType: string;
  promptCharCount: number | null;
  traceId: string | null;
  events: SpeechDebugEvent[];
};

type ImageDebugInfo = {
  cache: {
    initialized: boolean;
    status: string;
    bookId: string;
    createdAt?: string;
    sourceNovel?: string;
    style: Record<string, unknown> | null;
  };
  prompts: {
    phase1System: string;
    phase2System: string;
  };
  records: ImageDebugRecord[];
  eventCount: number;
};

type RangeMedia<T> = T & {
  chapterId: string;
  range: TextRange;
  userId?: string;
  fromLibrary?: boolean;
  createdAt?: string;
};

type MediaLibraryAsset = {
  id: string;
  articleId: string;
  chapterId: string | null;
  paragraphIndex: number | null;
  mediaType: 'image' | 'audio';
  url: string;
  sourceUrl: string | null;
  filePath: string | null;
  prompt: string | null;
  sourceText: string | null;
  provider: string;
  model: string | null;
  userId: string;
  range: TextRange | null;
  metadata: Record<string, unknown> | null;
  createdAt: string;
};

type ParagraphComment = {
  id: string;
  articleId: string;
  chapterId: string;
  paragraphIndex: number;
  userId: string;
  username: string;
  displayName: string;
  content: string;
  createdAt: string;
};

type SelectedParagraph = {
  chapterId: string;
  paragraphIndex: number;
  draft: string;
  range: TextRange;
};

type ContextTab = 'scene' | 'ai' | 'bag';
type ReadingTheme = 'light' | 'paper' | 'night';
type ReadingWidth = 'narrow' | 'standard' | 'wide';
type SceneDiagram = 'layout' | 'positions' | 'clues';

const TOKEN_KEY = 'immersive-reader-token';
const USER_KEY = 'immersive-reader-user';
const COLLECTED_CLUES_KEY = 'immersive-reader-collected-clues';

function clueCollectionKey(userId?: string | null) {
  return `${COLLECTED_CLUES_KEY}:${userId || 'anonymous'}`;
}

function clueImageKey(clueId: string) {
  return clueId;
}

function clueOccurrences(clue?: Clue | null) {
  return Array.isArray(clue?.occurrences) ? clue.occurrences : [];
}

function resolveClueOccurrenceId(clue: Clue | undefined, occurrenceId?: string) {
  const occurrences = clueOccurrences(clue);
  if (occurrenceId && occurrences.some((item) => item.id === occurrenceId)) {
    return occurrenceId;
  }
  return occurrences[0]?.id || '';
}

function loadCollectedClues(userId?: string | null): CollectedClueRecord[] {
  const scopedKey = clueCollectionKey(userId);
  const scoped = window.localStorage.getItem(scopedKey);
  const legacy = scoped ? null : window.localStorage.getItem(COLLECTED_CLUES_KEY);
  try {
    const parsed = JSON.parse(scoped || legacy || '[]');
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((item) =>
        typeof item === 'string'
          ? { clueId: item, occurrenceId: '' }
          : { clueId: String(item?.clueId || ''), occurrenceId: String(item?.occurrenceId || '') }
      )
      .filter((item) => item.clueId);
  } catch {
    return [];
  }
}

async function requestJson<T>(url: string, options: RequestInit = {}): Promise<T> {
  const token = window.localStorage.getItem(TOKEN_KEY);
  const res = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options.headers
    }
  });
  const responseText = await res.text();
  let data: any;
  try {
    data = responseText ? JSON.parse(responseText) : {};
  } catch {
    const clueServiceHint = url.startsWith('/api/ai/clue-')
      ? '线索生图服务未正确部署，请稍后重试'
      : '服务器返回了无法识别的响应';
    throw new Error(`${clueServiceHint}（HTTP ${res.status}）`);
  }

  if (!res.ok) {
    throw new Error(data.error ?? '请求失败');
  }

  return data;
}

const api = {
  chapters: () => requestJson<Chapter[]>('/api/chapters'),
  clues: () => requestJson<Clue[]>('/api/clues'),
  paragraphComments: (articleId: string, chapterId: string) =>
    requestJson<{ comments: ParagraphComment[] }>(
      `/api/paragraph-comments?articleId=${encodeURIComponent(articleId)}&chapterId=${encodeURIComponent(chapterId)}`
    ),
  createParagraphComment: (payload: { articleId: string; chapterId: string; paragraphIndex: number; content: string }) =>
    requestJson<{ comment: ParagraphComment }>('/api/paragraph-comments', {
      method: 'POST',
      body: JSON.stringify(payload)
    }),
  deleteParagraphComment: (id: string) =>
    requestJson<{ ok: true }>(`/api/paragraph-comments/${encodeURIComponent(id)}`, {
      method: 'DELETE'
    }),
  chat: async (question: string, chapterId: string, collectedClueIds: string[]) => {
    const data = await requestJson<{ answer: string }>('/api/chat', {
      method: 'POST',
      body: JSON.stringify({ question, chapterId, collectedClueIds })
    });
    return data.answer;
  },
  aiChat: async (question: string, chapterId: string, collectedClueIds: string[]) => {
    const data = await requestJson<{ answer: string }>('/api/ai/chat', {
      method: 'POST',
      body: JSON.stringify({ question, chapterId, collectedClueIds })
    });
    return data.answer;
  },
  tts: async (payload: { text: string; speaker: string; speed: number; pitch: number }) =>
    requestJson<{ audioUrl: string; durationMs: number | null; traceId: string | null }>('/api/ai/tts', {
      method: 'POST',
      body: JSON.stringify(payload)
    }),
  image: async (chapterId: string) =>
    requestJson<GeneratedSceneImage>('/api/ai/image', {
      method: 'POST',
      body: JSON.stringify({ chapterId })
    }),
  paragraphImage: async (payload: {
    chapterId: string;
    paragraphIndex: number;
    targetSegment: string;
    range: TextRange;
  }) =>
    requestJson<ParagraphImage>('/api/ai/paragraph-image', {
      method: 'POST',
      body: JSON.stringify(payload)
    }),
  clueImage: (payload: { clueId: string; occurrenceId: string; force?: boolean }) =>
    requestJson<ClueImage>('/api/ai/clue-image', {
      method: 'POST',
      body: JSON.stringify(payload)
    }),
  clueImages: (occurrenceIds: string[], articleId = 'speckled-band') =>
    requestJson<{ images: ClueImage[] }>(
      `/api/ai/clue-images?articleId=${encodeURIComponent(articleId)}&occurrenceIds=${encodeURIComponent(
        occurrenceIds.join(',')
      )}`
    ),
  paragraphSpeech: async (payload: {
    chapterId: string;
    paragraphIndex: number;
    targetSegment: string;
    range: TextRange;
  }) =>
    requestJson<ParagraphSpeech>('/api/ai/paragraph-speech', {
      method: 'POST',
      body: JSON.stringify(payload)
    }),
  dubbingUnitAtPosition: (articleId: string, chapterId: string, paragraphIndex: number) =>
    requestJson<DubbingUnitBundle>(
      `/api/dubbing/unit-at-position?articleId=${encodeURIComponent(articleId)}&chapterId=${encodeURIComponent(
        chapterId
      )}&paragraphIndex=${paragraphIndex}`
    ),
  adoptedDubbingVersions: (articleId: string, chapterId: string) =>
    requestJson<{ versions: DubbingVersion[] }>(
      `/api/dubbing/adoptions?articleId=${encodeURIComponent(articleId)}&chapterId=${encodeURIComponent(chapterId)}`
    ),
  planAiDubbing: (unitId: string) =>
    requestJson<{ unit: ContentUnit; plan: DubbingPlan }>(
      `/api/dubbing/units/${encodeURIComponent(unitId)}/ai-plan`,
      { method: 'POST' }
    ),
  createVoiceDesign: (payload: {
    articleId: string;
    characterCode: string;
    characterName: string;
    prompt: string;
    previewText: string;
  }) =>
    requestJson<{ version: VoiceDesignVersion }>('/api/dubbing/voice-designs', {
      method: 'POST',
      body: JSON.stringify(payload)
    }),
  createAiDubbingVersion: (
    unitId: string,
    payload: {
      segments: DubbingPlanSegment[];
      voiceDesignVersionIdsBySpeaker: Record<string, string>;
      generationSettings: MiniMaxGenerationSettings;
      visibility: 'private' | 'public';
    }
  ) =>
    requestJson<{ unit: ContentUnit; version: DubbingVersion }>(
      `/api/dubbing/units/${encodeURIComponent(unitId)}/ai-versions`,
      { method: 'POST', body: JSON.stringify(payload) }
    ),
  createHumanDubbingVersion: (
    unitId: string,
    payload: { audioDataUrl: string; visibility: 'private' | 'public' }
  ) =>
    requestJson<{ unit: ContentUnit; version: DubbingVersion }>(
      `/api/dubbing/units/${encodeURIComponent(unitId)}/human-versions`,
      { method: 'POST', body: JSON.stringify(payload) }
    ),
  setDubbingStatus: (versionId: string, status: 'public' | 'withdrawn' | 'deleted') =>
    requestJson<{ version: DubbingVersion }>(
      `/api/dubbing/versions/${encodeURIComponent(versionId)}/status`,
      { method: 'PATCH', body: JSON.stringify({ status }) }
    ),
  likeDubbingVersion: (versionId: string, liked: boolean) =>
    requestJson<{ version: DubbingVersion }>(
      `/api/dubbing/versions/${encodeURIComponent(versionId)}/like`,
      { method: liked ? 'POST' : 'DELETE' }
    ),
  adoptDubbingVersion: (unitId: string, versionId: string) =>
    requestJson<{ version: DubbingVersion }>(
      `/api/dubbing/units/${encodeURIComponent(unitId)}/adoption`,
      { method: 'PUT', body: JSON.stringify({ versionId }) }
    ),
  cancelDubbingAdoption: (unitId: string) =>
    requestJson<{ ok: true; removed: boolean }>(
      `/api/dubbing/units/${encodeURIComponent(unitId)}/adoption`,
      { method: 'DELETE' }
    ),
  reportDubbingVersion: (versionId: string, reason: string) =>
    requestJson<{ report: { status: 'open' } }>(
      `/api/dubbing/versions/${encodeURIComponent(versionId)}/reports`,
      { method: 'POST', body: JSON.stringify({ reason }) }
    ),
  mediaAssets: (articleId: string, chapterId: string) =>
    requestJson<{ assets: MediaLibraryAsset[] }>(
      `/api/media/assets?articleId=${encodeURIComponent(articleId)}&chapterId=${encodeURIComponent(chapterId)}`
    ),
  voiceRecordings: (articleId: string, chapterId: string, range: TextRange) =>
    requestJson<{ myRecording: VoiceRecording | null; publicRecordings: VoiceRecording[] }>(
      `/api/voice-recordings?articleId=${encodeURIComponent(articleId)}&chapterId=${encodeURIComponent(
        chapterId
      )}&startParagraphIndex=${range.startParagraphIndex}&startOffset=${range.startOffset}&endParagraphIndex=${
        range.endParagraphIndex
      }&endOffset=${range.endOffset}`
    ),
  createVoiceRecording: (payload: {
    articleId: string;
    chapterId: string;
    paragraphIndex: number;
    range: TextRange;
    sourceText: string;
    audioDataUrl: string;
    visibility: 'private' | 'public';
  }) =>
    requestJson<{ recording: VoiceRecording }>('/api/voice-recordings', {
      method: 'POST',
      body: JSON.stringify(payload)
    }),
  updateVoiceRecording: (id: string, visibility: 'private' | 'public') =>
    requestJson<{ recording: VoiceRecording }>(`/api/voice-recordings/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: JSON.stringify({ visibility })
    }),
  deleteVoiceRecording: (id: string) =>
    requestJson<{ ok: true; recording: VoiceRecording }>(`/api/voice-recordings/${encodeURIComponent(id)}`, {
      method: 'DELETE'
    }),
  likeVoiceRecording: (id: string, liked: boolean) =>
    requestJson<{ recording: VoiceRecording }>(`/api/voice-recordings/${encodeURIComponent(id)}/like`, {
      method: liked ? 'POST' : 'DELETE'
    }),
  speechDebug: (limit = 20) => requestJson<SpeechDebugInfo>(`/api/ai/speech-debug?limit=${limit}`),
  imageDebug: (limit = 20) => requestJson<ImageDebugInfo>(`/api/ai/image-debug?limit=${limit}`),
  deleteMediaAsset: (id: string) =>
    requestJson<{ ok: true; asset: MediaLibraryAsset }>(`/api/media/assets/${encodeURIComponent(id)}`, {
      method: 'DELETE'
    }),
  regenerateSpeechVoices: () =>
    requestJson('/api/ai/speech-debug/regenerate-voices', {
      method: 'POST'
    }),
  regenerateImageStyle: () =>
    requestJson('/api/ai/image-debug/regenerate-style', {
      method: 'POST'
    }),
  register: (form: { username: string; password: string; displayName: string }) =>
    requestJson<{ token: string; user: User }>('/api/auth/register', {
      method: 'POST',
      body: JSON.stringify(form)
    }),
  login: (form: { username: string; password: string }) =>
    requestJson<{ token: string; user: User }>('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify(form)
    }),
  logout: () =>
    requestJson<{ ok: true }>('/api/auth/logout', {
      method: 'POST'
    })
};

function App() {
  const [page, setPage] = useState<Page>('home');
  const [user, setUser] = useState<User | null>(() => {
    const saved = window.localStorage.getItem(USER_KEY);
    return saved ? JSON.parse(saved) : null;
  });
  const [chapters, setChapters] = useState<Chapter[]>([]);
  const [clues, setClues] = useState<Clue[]>([]);
  const [collectedClues, setCollectedClues] = useState<CollectedClueRecord[]>(() => {
    const savedUser = window.localStorage.getItem(USER_KEY);
    const savedUserId = savedUser ? JSON.parse(savedUser)?.id : null;
    return loadCollectedClues(savedUserId);
  });
  const [clueImages, setClueImages] = useState<Record<string, ClueImage>>({});
  const [chapterId, setChapterId] = useState('speckled-band-1');
  const [notice, setNotice] = useState('');
  const [question, setQuestion] = useState('');
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      role: 'assistant',
      content: '我是你的案情助手。你可以问我：目前有哪些证物？谁最可疑？这一段发生在哪里？'
    }
  ]);

  useEffect(() => {
    api.chapters().then(setChapters);
    api.clues().then((nextClues) => {
      setClues(nextClues);
      setCollectedClues((previous) =>
        previous.flatMap((record) => {
          const clue = nextClues.find((item) => item.id === record.clueId);
          if (!clue) return [];
          const occurrenceId = resolveClueOccurrenceId(clue, record.occurrenceId);
          return [{ clueId: clue.id, occurrenceId }];
        })
      );
    });
  }, []);

  useEffect(() => {
    window.localStorage.setItem(clueCollectionKey(user?.id), JSON.stringify(collectedClues));
    window.localStorage.removeItem(COLLECTED_CLUES_KEY);
  }, [collectedClues, user?.id]);

  useEffect(() => {
    let cancelled = false;
    api
      .clueImages(collectedClues.map((record) => record.occurrenceId).filter(Boolean))
      .then(({ images }) => {
        if (cancelled) return;
        setClueImages((previous) => ({
          ...previous,
          ...Object.fromEntries(images.map((image) => [clueImageKey(image.clueId), image]))
        }));
      })
      .catch(() => {
        // 数据库未配置时，仍允许本次会话继续使用刚生成的远程图。
      });
    return () => {
      cancelled = true;
    };
  }, [user?.id, collectedClues]);

  function saveSession(token: string, nextUser: User) {
    window.localStorage.setItem(TOKEN_KEY, token);
    window.localStorage.setItem(USER_KEY, JSON.stringify(nextUser));
    setUser(nextUser);
    setCollectedClues(loadCollectedClues(nextUser.id));
    setClueImages({});
    setPage('bookshelf');
  }

  async function logout() {
    try {
      await api.logout();
    } catch {
      // 本地原型里即使后端 session 失效，也允许前端退出。
    }
    window.localStorage.removeItem(TOKEN_KEY);
    window.localStorage.removeItem(USER_KEY);
    setUser(null);
    setCollectedClues([]);
    setClueImages({});
    setPage('home');
  }

  return (
    <main>
      <TopNav page={page} user={user} setPage={setPage} logout={logout} />

      {page === 'home' && <HomePage user={user} setPage={setPage} />}
      {page === 'login' && <AuthPage mode="login" saveSession={saveSession} setPage={setPage} />}
      {page === 'register' && <AuthPage mode="register" saveSession={saveSession} setPage={setPage} />}
      {page === 'bookshelf' &&
        (user ? (
          <BookshelfPage
            user={user}
            chapters={chapters}
            collectedClueCount={collectedClues.length}
            setChapterId={setChapterId}
            setPage={setPage}
          />
        ) : (
          <AuthPage mode="login" saveSession={saveSession} setPage={setPage} />
        ))}
      {page === 'profile' &&
        (user ? (
          <ProfilePage
            user={user}
            setPage={setPage}
            collectedClues={collectedClues}
            clues={clues}
            clueImages={clueImages}
          />
        ) : (
          <AuthPage mode="login" saveSession={saveSession} setPage={setPage} />
        ))}
      {page === 'speech-debug' &&
        (user ? <SpeechDebugPage /> : <AuthPage mode="login" saveSession={saveSession} setPage={setPage} />)}
      {page === 'reader' &&
        (user ? (
          <ReaderPage
            user={user}
            chapters={chapters}
            clues={clues}
            collectedClueRecords={collectedClues}
            setCollectedClues={setCollectedClues}
            clueImages={clueImages}
            setClueImages={setClueImages}
            chapterId={chapterId}
            setChapterId={setChapterId}
            notice={notice}
            setNotice={setNotice}
            question={question}
            setQuestion={setQuestion}
            messages={messages}
            setMessages={setMessages}
            setPage={setPage}
          />
        ) : (
          <AuthPage mode="login" saveSession={saveSession} setPage={setPage} />
        ))}
    </main>
  );
}

function TopNav({
  page,
  user,
  setPage,
  logout
}: {
  page: Page;
  user: User | null;
  setPage: (page: Page) => void;
  logout: () => void;
}) {
  return (
    <header className="top-nav">
      <button className="nav-brand" onClick={() => setPage('home')}>
        <span>CR</span>
        <strong>CaseReader</strong>
      </button>
      <nav>
        <button className={page === 'home' ? 'active' : ''} onClick={() => setPage('home')}>
          首页
        </button>
        {user ? (
          <>
            <button
              className={page === 'bookshelf' || page === 'reader' ? 'active' : ''}
              onClick={() => setPage('bookshelf')}
            >
              我的书架
            </button>
            <button className={page === 'profile' ? 'active' : ''} onClick={() => setPage('profile')}>
              阅读档案
            </button>
            <button className={page === 'speech-debug' ? 'active' : ''} onClick={() => setPage('speech-debug')}>
              生成调试
            </button>
            <button onClick={logout}>退出</button>
          </>
        ) : (
          <>
            <button className={page === 'login' ? 'active' : ''} onClick={() => setPage('login')}>
              登录
            </button>
            <button className="primary-nav" onClick={() => setPage('register')}>
              注册
            </button>
          </>
        )}
      </nav>
    </header>
  );
}

function HomePage({ user, setPage }: { user: User | null; setPage: (page: Page) => void }) {
  return (
    <section className="home-page">
      <section className="home-hero">
        <div className="home-hero-copy">
          <p className="eyebrow">AI Assisted Reading System</p>
          <h1>探案小说的专注阅读空间</h1>
          <p>
            系统围绕小说正文展开，只在对白、空间关系和证物整理这些关键时刻提供辅助。
          </p>
          <div className="home-actions">
            <button onClick={() => setPage(user ? 'bookshelf' : 'login')}>
              {user ? '进入书架' : '登录后阅读'}
            </button>
            <button className="secondary" onClick={() => setPage(user ? 'profile' : 'register')}>
              {user ? '阅读档案' : '建立档案'}
            </button>
          </div>
        </div>
        <div className="home-reading-card">
          <div className="book-cover">
            <span>Arthur Conan Doyle</span>
            <h2>斑点带子案</h2>
            <p>The Speckled Band</p>
          </div>
          <div className="reading-card-meta">
            <span>当前章节</span>
            <strong>贝克街的求助</strong>
            <div className="progress">
              <span style={{ width: '18%' }} />
            </div>
            <p>已读 18% · 3 个开放章节</p>
          </div>
        </div>
      </section>

      <section className="home-overview">
        <div className="home-book-preview">
          <div className="preview-page">
            <span>阅读摘录</span>
            <h2>福尔摩斯探案集</h2>
            <p>“案件里最危险的部分，往往藏在最普通的物件后面。”</p>
          </div>
          <div className="preview-context">
            <span>系统状态</span>
            <h2>正文优先，辅助按需出现</h2>
            <p>对白配音、现场图和证物袋都隐藏在阅读流程中，读者主动需要时才展开。</p>
          </div>
        </div>
      </section>

      <div className="feature-grid">
        <article>
          <span>Voice</span>
          <h2>对白配音</h2>
          <p>点击人物对白后出现播放控件，声音不会主动打断阅读。</p>
        </article>
        <article>
          <span>Scene</span>
          <h2>现场图</h2>
          <p>按需生成房间布局、人物站位和证物位置，帮助理解推理空间。</p>
        </article>
        <article>
          <span>Evidence</span>
          <h2>证物整理</h2>
          <p>收集关键物件、地点和人物信息，为后续非剧透推理提供上下文。</p>
        </article>
      </div>
    </section>
  );
}

function BookshelfPage({
  user,
  chapters,
  collectedClueCount,
  setChapterId,
  setPage
}: {
  user: User;
  chapters: Chapter[];
  collectedClueCount: number;
  setChapterId: (id: string) => void;
  setPage: (page: Page) => void;
}) {
  const currentChapter = chapters[0];
  const lastChapter = chapters.length
    ? chapters.reduce((best, chapter) => (chapter.progress > best.progress ? chapter : best))
    : null;
  const shelfProgress = lastChapter?.progress ?? 18;
  const lastRead = lastChapter?.subtitle ?? '贝克街的求助';
  const books = [
    {
      id: 'speckled-band',
      title: '斑点带子案',
      author: 'Arthur Conan Doyle',
      category: '福尔摩斯探案集',
      progress: shelfProgress,
      lastRead,
      totalChapters: chapters.length || 3,
      clueCount: collectedClueCount,
      status: '继续阅读'
    },
    {
      id: 'red-headed-league',
      title: '红发会',
      author: 'Arthur Conan Doyle',
      category: '即将开放',
      progress: 0,
      lastRead: '尚未开始',
      totalChapters: 0,
      clueCount: 0,
      status: '待解锁'
    },
    {
      id: 'blue-carbuncle',
      title: '蓝宝石案',
      author: 'Arthur Conan Doyle',
      category: '即将开放',
      progress: 0,
      lastRead: '尚未开始',
      totalChapters: 0,
      clueCount: 0,
      status: '待解锁'
    }
  ];

  function openBook(bookId: string) {
    if (bookId !== 'speckled-band') return;
    setChapterId(currentChapter?.id ?? 'speckled-band-1');
    setPage('reader');
  }

  return (
    <section className="bookshelf-page">
      <header className="shelf-hero">
        <div>
          <p className="eyebrow">My Library</p>
          <h1>{user.displayName} 的书架</h1>
          <p>这里保存你读过和正在阅读的作品。进入某本书后，系统才会打开对应阅读器。</p>
        </div>
        <div className="shelf-summary">
          <span>{books.length}</span>
          <p>书架藏书</p>
          <span>{collectedClueCount}</span>
          <p>已收集证物</p>
        </div>
      </header>

      <section className="continue-card">
        <div className="mini-cover">
          <span>Case</span>
          <strong>斑点带子案</strong>
        </div>
        <div>
          <p className="eyebrow">最近阅读</p>
          <h2>《斑点带子案》</h2>
          <p>上次读到：{lastRead}</p>
          <div className="progress">
            <span style={{ width: `${shelfProgress}%` }} />
          </div>
        </div>
        <button onClick={() => openBook('speckled-band')}>继续</button>
      </section>

      <section className="book-grid" aria-label="我的书架">
        {books.map((book) => {
          const available = book.id === 'speckled-band';

          return (
            <button
              key={book.id}
              className={available ? 'shelf-book' : 'shelf-book locked'}
              onClick={() => openBook(book.id)}
              type="button"
            >
              <span className="book-spine">{book.category}</span>
              <span className="book-cover-tile">
                <small>{book.author}</small>
                <strong>{book.title}</strong>
              </span>
              <span className="book-info">
                <strong>{book.title}</strong>
                <small>{book.lastRead}</small>
                <span className="book-progress">
                  <span style={{ width: `${book.progress}%` }} />
                </span>
                <small>
                  {book.totalChapters ? `${book.totalChapters} 章 · ${book.clueCount} 件证物` : '内容准备中'}
                </small>
              </span>
              <span className="book-status">{book.status}</span>
            </button>
          );
        })}
      </section>
    </section>
  );
}

function AuthPage({
  mode,
  saveSession,
  setPage
}: {
  mode: 'login' | 'register';
  saveSession: (token: string, user: User) => void;
  setPage: (page: Page) => void;
}) {
  const [username, setUsername] = useState(mode === 'login' ? 'demo' : '');
  const [password, setPassword] = useState(mode === 'login' ? '123456' : '');
  const [displayName, setDisplayName] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const isLogin = mode === 'login';

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError('');
    setLoading(true);

    try {
      const result = isLogin
        ? await api.login({ username, password })
        : await api.register({ username, password, displayName });
      saveSession(result.token, result.user);
    } catch (err) {
      setError(err instanceof Error ? err.message : '提交失败');
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className="auth-page">
      <form className="auth-card" onSubmit={submit}>
        <p className="eyebrow">{isLogin ? 'Welcome back' : 'Create account'}</p>
        <h1>{isLogin ? '登录账号' : '注册账号'}</h1>
        <p className="form-tip">
          账号与社区数据保存在 MySQL；本地与部署环境使用各自配置的数据库。
        </p>

        {!isLogin && (
          <label>
            昵称
            <input value={displayName} onChange={(event) => setDisplayName(event.target.value)} />
          </label>
        )}

        <label>
          用户名
          <input value={username} onChange={(event) => setUsername(event.target.value)} required />
        </label>

        <label>
          密码
          <input
            value={password}
            type="password"
            onChange={(event) => setPassword(event.target.value)}
            required
          />
        </label>

        {error && <p className="form-error">{error}</p>}

        <button type="submit" disabled={loading}>
          {loading ? '提交中...' : isLogin ? '登录' : '注册并进入'}
        </button>

        <button
          type="button"
          className="link-button"
          onClick={() => setPage(isLogin ? 'register' : 'login')}
        >
          {isLogin ? '还没有账号？去注册' : '已有账号？去登录'}
        </button>
      </form>
    </section>
  );
}

function ProfilePage({
  user,
  setPage,
  collectedClues,
  clues,
  clueImages
}: {
  user: User | null;
  setPage: (page: Page) => void;
  collectedClues: CollectedClueRecord[];
  clues: Clue[];
  clueImages: Record<string, ClueImage>;
}) {
  const collectedEntries = collectedClues.flatMap((record) => {
    const clue = clues.find((item) => item.id === record.clueId);
    return clue ? [{ clue, record }] : [];
  });

  if (!user) {
    return (
      <section className="profile-page">
        <div className="profile-card">
          <h1>请先登录</h1>
          <p>登录后可以查看你的阅读进度、证物袋和阅读档案。</p>
          <button onClick={() => setPage('login')}>去登录</button>
        </div>
      </section>
    );
  }

  return (
    <section className="profile-page">
      <div className="profile-card">
        <div className="avatar">{user.displayName.slice(0, 1).toUpperCase()}</div>
        <h1>{user.displayName}</h1>
        <p>@{user.username}</p>
        <p>{user.bio}</p>
      </div>

      <div className="profile-stats">
        <article>
          <span>{collectedEntries.length}</span>
          <p>已收集证物</p>
        </article>
        <article>
          <span>3</span>
          <p>开放章节</p>
        </article>
        <article>
          <span>76%</span>
          <p>最高阅读进度</p>
        </article>
      </div>

      <div className="profile-card">
        <h2>我的证物袋</h2>
        {collectedEntries.length === 0 ? (
          <p>还没有收集证物。进入书架中的作品，点击正文里的可疑细节即可加入证物袋。</p>
        ) : (
          <div className="profile-clues">
            {collectedEntries.map(({ clue, record }) => {
              const image = clueImages[clueImageKey(clue.id)];
              return (
                <article key={clue.id} className="clue-card profile-clue-card">
                  {image?.imageUrl ? (
                    <img className="clue-card-image" src={image.imageUrl} alt={clue.label} />
                  ) : (
                    <div className="clue-image-placeholder">尚未生成图像</div>
                  )}
                  <span>{clue.type}</span>
                  <h3>{clue.label}</h3>
                  <p>{clue.surfaceDescription}</p>
                </article>
              );
            })}
          </div>
        )}
      </div>
    </section>
  );
}

function formatDebugTime(timestamp: number | null) {
  if (!timestamp) {
    return '未知时间';
  }
  return new Date(timestamp).toLocaleString();
}

function JsonBlock({ value }: { value: unknown }) {
  return <pre className="debug-json">{JSON.stringify(value, null, 2)}</pre>;
}

function SpeechDebugPage() {
  const [speechDebugInfo, setSpeechDebugInfo] = useState<SpeechDebugInfo | null>(null);
  const [imageDebugInfo, setImageDebugInfo] = useState<ImageDebugInfo | null>(null);
  const [activeDomain, setActiveDomain] = useState<'speech' | 'image'>('speech');
  const [activePrompt, setActivePrompt] = useState<'speechPhase1' | 'speechPhase3a' | 'imagePhase1' | 'imagePhase2'>(
    'speechPhase3a'
  );
  const [loading, setLoading] = useState(false);
  const [regenerating, setRegenerating] = useState<'' | 'speech' | 'image'>('');
  const [error, setError] = useState('');
  const [copied, setCopied] = useState('');

  const loadDebugInfo = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [speechResult, imageResult] = await Promise.all([api.speechDebug(20), api.imageDebug(20)]);
      setSpeechDebugInfo(speechResult);
      setImageDebugInfo(imageResult);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : '调试信息加载失败');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadDebugInfo();
  }, [loadDebugInfo]);

  async function copyPrompt() {
    const prompt = getActivePromptText();
    if (!prompt) return;
    await navigator.clipboard.writeText(prompt);
    setCopied('提示词已复制');
    window.setTimeout(() => setCopied(''), 1800);
  }

  async function regenerateGlobalProduct(kind: 'speech' | 'image') {
    const label = kind === 'speech' ? '语音音色缓存' : '图像全局风格缓存';
    const confirmed = window.confirm(`确定要重新生成${label}吗？这会覆盖当前本地全局产物，并可能调用 MiniMax API。`);
    if (!confirmed) return;

    setRegenerating(kind);
    setError('');
    try {
      if (kind === 'speech') {
        await api.regenerateSpeechVoices();
      } else {
        await api.regenerateImageStyle();
      }
      await loadDebugInfo();
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : `${label}重新生成失败`);
    } finally {
      setRegenerating('');
    }
  }

  function getActivePromptText() {
    if (activePrompt === 'speechPhase1') return speechDebugInfo?.prompts.phase1System ?? '';
    if (activePrompt === 'speechPhase3a') return speechDebugInfo?.prompts.phase3aSystem ?? '';
    if (activePrompt === 'imagePhase1') return imageDebugInfo?.prompts.phase1System ?? '';
    return imageDebugInfo?.prompts.phase2System ?? '';
  }

  const activePromptText = getActivePromptText();
  const promptLabelMap = {
    speechPhase1: '语音阶段一 system prompt',
    speechPhase3a: '语音阶段三 3a system prompt',
    imagePhase1: '图像阶段一 system prompt',
    imagePhase2: '图像阶段二 system prompt'
  };

  return (
    <section className="speech-debug-page">
      <div className="debug-header">
        <div>
          <p className="eyebrow">Generation Debug</p>
          <h1>生成调试</h1>
          <p>查看语音与文生图的全局缓存、提示词模板，以及最近生成链路。</p>
        </div>
        <div className="debug-actions">
          <button type="button" onClick={loadDebugInfo} disabled={loading || Boolean(regenerating)}>
            {loading ? '刷新中...' : '刷新'}
          </button>
          <button type="button" onClick={() => regenerateGlobalProduct('speech')} disabled={Boolean(regenerating)}>
            {regenerating === 'speech' ? '生成中...' : '重生成音色'}
          </button>
          <button type="button" onClick={() => regenerateGlobalProduct('image')} disabled={Boolean(regenerating)}>
            {regenerating === 'image' ? '生成中...' : '重生成图像风格'}
          </button>
        </div>
      </div>

      {error && <p className="form-error">{error}</p>}

      {speechDebugInfo && imageDebugInfo && (
        <>
          <div className="debug-domain-tabs">
            <button
              type="button"
              className={activeDomain === 'speech' ? 'active' : ''}
              onClick={() => setActiveDomain('speech')}
            >
              配音
            </button>
            <button
              type="button"
              className={activeDomain === 'image' ? 'active' : ''}
              onClick={() => setActiveDomain('image')}
            >
              文生图
            </button>
          </div>

          <section className="debug-section">
            <div className="debug-section-heading">
              <h2>{activeDomain === 'speech' ? '配音缓存状态' : '图像风格缓存状态'}</h2>
              <span>
                {(activeDomain === 'speech' ? speechDebugInfo.cache.initialized : imageDebugInfo.cache.initialized)
                  ? '已初始化'
                  : '未初始化'}
              </span>
            </div>
            {activeDomain === 'speech' ? (
              <>
                <div className="debug-metrics">
                  <article>
                    <span>Book</span>
                    <strong>{speechDebugInfo.cache.bookId}</strong>
                  </article>
                  <article>
                    <span>Roles</span>
                    <strong>{speechDebugInfo.cache.roles.length}</strong>
                  </article>
                  <article>
                    <span>Templates</span>
                    <strong>{speechDebugInfo.cache.templates.length}</strong>
                  </article>
                  <article>
                    <span>Tones</span>
                    <strong>{speechDebugInfo.cache.pronunciationToneCount}</strong>
                  </article>
                </div>
                <div className="debug-grid">
                  <div>
                    <h3>角色音色</h3>
                    <JsonBlock value={speechDebugInfo.cache.roles} />
                  </div>
                  <div>
                    <h3>模板声音池</h3>
                    <JsonBlock value={speechDebugInfo.cache.templates} />
                  </div>
                </div>
                <details className="debug-details">
                  <summary>氛围配置与局部表演弹性</summary>
                  <JsonBlock value={speechDebugInfo.cache.atmosphere} />
                </details>
              </>
            ) : (
              <>
                <div className="debug-metrics">
                  <article>
                    <span>Book</span>
                    <strong>{imageDebugInfo.cache.bookId}</strong>
                  </article>
                  <article>
                    <span>Status</span>
                    <strong>{imageDebugInfo.cache.status}</strong>
                  </article>
                  <article>
                    <span>Records</span>
                    <strong>{imageDebugInfo.records.length}</strong>
                  </article>
                  <article>
                    <span>Events</span>
                    <strong>{imageDebugInfo.eventCount}</strong>
                  </article>
                </div>
                <details className="debug-details" open>
                  <summary>全局风格产物</summary>
                  <JsonBlock value={imageDebugInfo.cache.style} />
                </details>
              </>
            )}
          </section>

          <section className="debug-section">
            <div className="debug-section-heading">
              <h2>当前提示词</h2>
              <button type="button" onClick={copyPrompt}>
                复制
              </button>
            </div>
            <div className="debug-tabs">
              <button
                type="button"
                className={activePrompt === 'speechPhase1' ? 'active' : ''}
                onClick={() => setActivePrompt('speechPhase1')}
              >
                语音阶段一
              </button>
              <button
                type="button"
                className={activePrompt === 'speechPhase3a' ? 'active' : ''}
                onClick={() => setActivePrompt('speechPhase3a')}
              >
                语音阶段三
              </button>
              <button
                type="button"
                className={activePrompt === 'imagePhase1' ? 'active' : ''}
                onClick={() => setActivePrompt('imagePhase1')}
              >
                图像阶段一
              </button>
              <button
                type="button"
                className={activePrompt === 'imagePhase2' ? 'active' : ''}
                onClick={() => setActivePrompt('imagePhase2')}
              >
                图像阶段二
              </button>
              <span>{copied || promptLabelMap[activePrompt]}</span>
            </div>
            <pre className="debug-prompt">{activePromptText}</pre>
          </section>

          <section className="debug-section">
            <div className="debug-section-heading">
              <h2>{activeDomain === 'speech' ? '最近配音记录' : '最近文生图记录'}</h2>
              <span>
                {activeDomain === 'speech'
                  ? `${speechDebugInfo.records.length} 批次 / ${speechDebugInfo.eventCount} 条事件`
                  : `${imageDebugInfo.records.length} 批次 / ${imageDebugInfo.eventCount} 条事件`}
              </span>
            </div>
            {(activeDomain === 'speech' ? speechDebugInfo.records : imageDebugInfo.records).length === 0 ? (
              <p className="debug-empty">
                {activeDomain === 'speech' ? '还没有配音记录。生成一次配音后刷新这里。' : '还没有文生图记录。生成一次插图后刷新这里。'}
              </p>
            ) : (
              <div className="debug-records">
                {(activeDomain === 'speech' ? speechDebugInfo.records : imageDebugInfo.records).map((record) => (
                  <details key={record.id} className="debug-record">
                    <summary>
                      <strong>{record.targetSegment || '未记录目标片段'}</strong>
                      <span>
                        {formatDebugTime(record.startedAt)} ·{' '}
                        {'segmentCount' in record
                          ? `${record.segmentCount} 段 · ${record.traceIds[0] ?? '无 trace'}`
                          : `${record.componentType || '未分类'} · ${record.traceId ?? '无 trace'}`}
                      </span>
                    </summary>
                    <div className="debug-record-body">
                      {record.events.map((event, index) => (
                        <details key={`${record.id}-${event.message}-${index}`} className="debug-event">
                          <summary>
                            <span>{event.message}</span>
                            <small>{event.location}</small>
                          </summary>
                          <JsonBlock value={event} />
                        </details>
                      ))}
                    </div>
                  </details>
                ))}
              </div>
            )}
          </section>
        </>
      )}
    </section>
  );
}

function ReaderPage({
  user,
  chapters,
  clues,
  collectedClueRecords,
  setCollectedClues,
  clueImages,
  setClueImages,
  chapterId,
  setChapterId,
  notice,
  setNotice,
  question,
  setQuestion,
  messages,
  setMessages,
  setPage
}: {
  user: User | null;
  chapters: Chapter[];
  clues: Clue[];
  collectedClueRecords: CollectedClueRecord[];
  setCollectedClues: React.Dispatch<React.SetStateAction<CollectedClueRecord[]>>;
  clueImages: Record<string, ClueImage>;
  setClueImages: React.Dispatch<React.SetStateAction<Record<string, ClueImage>>>;
  chapterId: string;
  setChapterId: (id: string) => void;
  notice: string;
  setNotice: (notice: string) => void;
  question: string;
  setQuestion: (question: string) => void;
  messages: ChatMessage[];
  setMessages: React.Dispatch<React.SetStateAction<ChatMessage[]>>;
  setPage: (page: Page) => void;
}) {
  const chapter = useMemo(
    () => chapters.find((item) => item.id === chapterId) ?? chapters[0],
    [chapters, chapterId]
  );
  const chapterIndex = useMemo(
    () => chapters.findIndex((item) => item.id === chapter?.id),
    [chapters, chapter]
  );
  const previousChapter = chapterIndex > 0 ? chapters[chapterIndex - 1] : null;
  const nextChapter =
    chapterIndex >= 0 && chapterIndex < chapters.length - 1 ? chapters[chapterIndex + 1] : null;

  const collectedClues = useMemo(
    () =>
      collectedClueRecords.flatMap((record) => {
        const clue = clues.find((item) => item.id === record.clueId);
        return clue ? [{ clue, record }] : [];
      }),
    [clues, collectedClueRecords]
  );
  const collectedClueIds = useMemo(
    () => collectedClueRecords.map((record) => record.clueId),
    [collectedClueRecords]
  );
  const chapterClues = useMemo(() => {
    if (!chapter) return [];

    const clueIds = new Set<string>();
    chapter.paragraphs.forEach((paragraph) => {
      paragraph.forEach((segment) => {
        if (segment.type === 'clue') {
          clueIds.add(segment.clueId);
        }
      });
    });
    return clues.filter((clue) => clueIds.has(clue.id));
  }, [chapter, clues]);
  const [contextTab, setContextTab] = useState<ContextTab>('scene');
  const [contextOpen, setContextOpen] = useState(false);
  const [readingTheme, setReadingTheme] = useState<ReadingTheme>('light');
  const [readingWidth, setReadingWidth] = useState<ReadingWidth>('standard');
  const [fontSize, setFontSize] = useState(19);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [sceneGenerated, setSceneGenerated] = useState(false);
  const [sceneLoading, setSceneLoading] = useState(false);
  const [generatedSceneImage, setGeneratedSceneImage] = useState<GeneratedSceneImage | null>(null);
  const [sceneDiagram, setSceneDiagram] = useState<SceneDiagram>('layout');
  const [bagPulse, setBagPulse] = useState(false);
  const [activeClueId, setActiveClueId] = useState<string | null>(null);
  const clueGenerationRunningRef = useRef(false);
  const queuedClueGenerationRef = useRef<{
    clueId: string;
    occurrenceId: string;
    force: boolean;
  } | null>(null);
  const [selectedParagraph, setSelectedParagraph] = useState<SelectedParagraph | null>(null);
  const [selectionLayout, setSelectionLayout] = useState<SelectionLayout | null>(null);
  const [draggingHandle, setDraggingHandle] = useState<'start' | 'end' | null>(null);
  const bookPageRef = useRef<HTMLElement | null>(null);
  const [paragraphImageLoadingKey, setParagraphImageLoadingKey] = useState<string | null>(null);
  const [paragraphImages, setParagraphImages] = useState<Record<string, RangeMedia<ParagraphImage>>>({});
  const toggleContextPanel = useCallback(
    (tab: ContextTab) => {
      setContextOpen((open) => (open && contextTab === tab ? false : true));
      setContextTab(tab);
    },
    [contextTab]
  );
  const [paragraphAudios, setParagraphAudios] = useState<Record<string, RangeMedia<ParagraphSpeech>>>({});
  const [platformParagraphAudios, setPlatformParagraphAudios] = useState<
    Record<string, RangeMedia<ParagraphSpeech>>
  >({});
  const [playingAudioKey, setPlayingAudioKey] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [paragraphSpeechLoadingKey, setParagraphSpeechLoadingKey] = useState<string | null>(null);
  const [voicePanelOpen, setVoicePanelOpen] = useState(false);
  const [voicePanelTab, setVoicePanelTab] = useState<'all' | 'ai' | 'human' | 'mine'>('all');
  const [dubbingBundles, setDubbingBundles] = useState<Record<string, DubbingUnitBundle>>({});
  const [voiceLoadingKey, setVoiceLoadingKey] = useState<string | null>(null);
  const [voiceSaving, setVoiceSaving] = useState(false);
  const [aiComposerOpen, setAiComposerOpen] = useState(false);
  const [aiPlan, setAiPlan] = useState<DubbingPlan | null>(null);
  const [aiComposerBinding, setAiComposerBinding] = useState<AiComposerBinding | null>(null);
  const [aiPlanning, setAiPlanning] = useState(false);
  const aiComposerRequestRef = useRef(0);
  const selectedDubbingKeyRef = useRef<string | null>(null);
  const [selectedVoiceSpeaker, setSelectedVoiceSpeaker] = useState('');
  const [voicePrompt, setVoicePrompt] = useState('');
  const [voicePreviewText, setVoicePreviewText] = useState('');
  const [voiceDesignsBySpeaker, setVoiceDesignsBySpeaker] = useState<Record<string, VoiceDesignVersion>>({});
  const [voiceDesignSaving, setVoiceDesignSaving] = useState(false);
  const [annotationCursorBySegment, setAnnotationCursorBySegment] = useState<Record<string, number>>({});
  const [pauseSecondsBySegment, setPauseSecondsBySegment] = useState<Record<string, number>>({});
  const [vocalTagBySegment, setVocalTagBySegment] = useState<Record<string, string>>({});
  const [paragraphComments, setParagraphComments] = useState<ParagraphComment[]>([]);
  const [commentsLoading, setCommentsLoading] = useState(false);
  const [activeCommentParagraph, setActiveCommentParagraph] = useState<number | null>(null);
  const [commentDraft, setCommentDraft] = useState('');
  const [commentSaving, setCommentSaving] = useState(false);
  const [deletingCommentId, setDeletingCommentId] = useState<string | null>(null);
  const [commentError, setCommentError] = useState('');
  const [recordingState, setRecordingState] = useState<'idle' | 'recording' | 'ready'>('idle');
  const [recordingPreviewUrl, setRecordingPreviewUrl] = useState<string | null>(null);
  const [recordingBlob, setRecordingBlob] = useState<Blob | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recordingChunksRef = useRef<Blob[]>([]);
  const recordingStreamRef = useRef<MediaStream | null>(null);
  const longPressTimer = useRef<number | null>(null);
  const sceneVariant =
    chapter?.id === 'speckled-band-2' ? 'manor' : chapter?.id === 'speckled-band-3' ? 'night' : 'baker';

  useEffect(() => {
    if (!chapter) return;
    let cancelled = false;
    setCommentsLoading(true);
    setParagraphComments([]);
    setActiveCommentParagraph(null);
    api.paragraphComments('speckled-band', chapter.id)
      .then(({ comments }) => { if (!cancelled) setParagraphComments(comments); })
      .catch((error) => { if (!cancelled) setCommentError(error.message || '评论加载失败'); })
      .finally(() => { if (!cancelled) setCommentsLoading(false); });
    return () => { cancelled = true; };
  }, [chapter?.id, user?.id]);

  async function submitParagraphComment(paragraphIndex: number) {
    const content = commentDraft.trim();
    if (!user) { setPage('login'); return; }
    if (!content || !chapter) return;
    setCommentSaving(true);
    setCommentError('');
    try {
      const { comment } = await api.createParagraphComment({
        articleId: 'speckled-band', chapterId: chapter.id, paragraphIndex, content
      });
      setParagraphComments((current) => [...current, comment]);
      setCommentDraft('');
    } catch (error) {
      setCommentError(error instanceof Error ? error.message : '评论发布失败');
    } finally {
      setCommentSaving(false);
    }
  }

  async function removeParagraphComment(comment: ParagraphComment) {
    if (!window.confirm('确定删除这条评论吗？')) return;
    setDeletingCommentId(comment.id);
    setCommentError('');
    try {
      await api.deleteParagraphComment(comment.id);
      setParagraphComments((current) => current.filter((item) => item.id !== comment.id));
    } catch (error) {
      setCommentError(error instanceof Error ? error.message : '评论删除失败');
    } finally {
      setDeletingCommentId(null);
    }
  }

  function metadataString(metadata: Record<string, unknown> | null, key: string) {
    const value = metadata?.[key];
    return typeof value === 'string' ? value : '';
  }

  function metadataNumber(metadata: Record<string, unknown> | null, key: string) {
    const value = metadata?.[key];
    return typeof value === 'number' ? value : null;
  }

  function mediaAssetPositionKey(asset: MediaLibraryAsset) {
    if (!asset.chapterId || !asset.range) {
      return null;
    }

    return rangeKey(asset.chapterId, asset.range);
  }

  function imageFromAsset(asset: MediaLibraryAsset): RangeMedia<ParagraphImage> | null {
    const key = mediaAssetPositionKey(asset);
    if (
      !key ||
      asset.mediaType !== 'image' ||
      !asset.chapterId ||
      !asset.range ||
      asset.metadata?.generationType !== 'paragraph-image'
    ) {
      return null;
    }

    return {
      chapterId: asset.chapterId,
      range: asset.range,
      imageUrl: asset.url,
      prompt: asset.prompt || '',
      sceneSummaryCn: metadataString(asset.metadata, 'sceneSummaryCn'),
      componentType: metadataString(asset.metadata, 'componentType'),
      promptCharCount: metadataNumber(asset.metadata, 'promptCharCount') ?? 0,
      traceId: metadataString(asset.metadata, 'traceId') || null,
      styleInitializedNow: Boolean(asset.metadata?.styleInitializedNow),
      mediaAssetId: asset.id,
      userId: asset.userId,
      fromLibrary: true,
      createdAt: asset.createdAt
    };
  }

  function sceneImageFromAsset(asset: MediaLibraryAsset): GeneratedSceneImage | null {
    if (asset.mediaType !== 'image' || asset.range) {
      return null;
    }

    if (asset.metadata?.generationType !== 'scene') {
      return null;
    }

    return {
      imageUrl: asset.url,
      prompt: asset.prompt || '',
      mediaAssetId: asset.id,
      cacheHit: true
    };
  }

  function audioFromAsset(asset: MediaLibraryAsset): RangeMedia<ParagraphSpeech> | null {
    const key = mediaAssetPositionKey(asset);
    if (!key || asset.mediaType !== 'audio' || !asset.chapterId || !asset.range) {
      return null;
    }

    if (asset.provider === 'user_recording' || asset.metadata?.generationType === 'user-recording') {
      return null;
    }

    const script = Array.isArray(asset.metadata?.script)
      ? (asset.metadata.script as ParagraphSpeechScriptLine[])
      : [];

    return {
      chapterId: asset.chapterId,
      range: asset.range,
      audioUrl: asset.url,
      durationMs: metadataNumber(asset.metadata, 'durationMs'),
      segmentCount: metadataNumber(asset.metadata, 'segmentCount') ?? script.length,
      script,
      voicesInitializedNow: Boolean(asset.metadata?.voicesInitializedNow),
      traceId: metadataString(asset.metadata, 'traceId') || null,
      mediaAssetId: asset.id,
      userId: asset.userId,
      fromLibrary: true,
      createdAt: asset.createdAt
    };
  }

  function audioFromDubbingVersion(version: DubbingVersion): RangeMedia<ParagraphSpeech> {
    const range: TextRange = {
      startParagraphIndex: version.paragraphIndex,
      startOffset: 0,
      endParagraphIndex: version.paragraphIndex,
      endOffset: version.sourceText.length
    };
    return {
      chapterId: version.chapterId,
      range,
      audioUrl: version.audioUrl,
      durationMs: version.durationMs,
      segmentCount: version.segments.length,
      script: version.segments.map((segment) => ({
        segmentId: segment.segmentId,
        speakerCode: segment.speakerCode,
        templateCode: segment.templateCode,
        displayName: segment.speakerCode || segment.templateCode || '角色',
        text: segment.text,
        durationMs: null
      })),
      voicesInitializedNow: false,
      traceId: null,
      mediaAssetId: version.mediaAssetId,
      userId: version.ownerUserId,
      fromLibrary: true,
      createdAt: version.createdAt
    };
  }

  useEffect(() => {
    setSceneGenerated(false);
    setGeneratedSceneImage(null);
    setSceneDiagram('layout');
    setSelectedParagraph(null);
    stopParagraphAudio();
  }, [chapterId]);

  useEffect(() => {
    if (!chapter?.id) {
      return;
    }

    let cancelled = false;

    Promise.all([
      api.mediaAssets('speckled-band', chapter.id),
      api.adoptedDubbingVersions('speckled-band', chapter.id)
    ])
      .then(([{ assets }, { versions: adoptedVersions }]) => {
        if (cancelled) {
          return;
        }

        const nextImages: Record<string, RangeMedia<ParagraphImage>> = {};
        const nextAudios: Record<string, RangeMedia<ParagraphSpeech>> = {};
        let nextSceneImage: GeneratedSceneImage | null = null;

        assets.forEach((asset) => {
          if (!nextSceneImage) {
            nextSceneImage = sceneImageFromAsset(asset);
          }

          const key = mediaAssetPositionKey(asset);
          if (!key) {
            return;
          }

          const image = imageFromAsset(asset);
          if (image && !nextImages[key]) {
            nextImages[key] = image;
            return;
          }

          const audio = audioFromAsset(asset);
          if (audio && !nextAudios[key]) {
            nextAudios[key] = audio;
          }
        });

        const resolvedAudios = { ...nextAudios };
        adoptedVersions.forEach((version) => {
          const audio = audioFromDubbingVersion(version);
          resolvedAudios[rangeKey(audio.chapterId, audio.range)] = audio;
        });

        setParagraphImages(nextImages);
        setPlatformParagraphAudios(nextAudios);
        setParagraphAudios(resolvedAudios);
        if (nextSceneImage) {
          setGeneratedSceneImage(nextSceneImage);
          setSceneGenerated(true);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setParagraphImages({});
          setPlatformParagraphAudios({});
          setParagraphAudios({});
        }
      });

    return () => {
      cancelled = true;
    };
  }, [chapter?.id, user?.id]);

  function stopParagraphAudio() {
    const audio = audioRef.current;
    if (audio) {
      audio.pause();
      audio.currentTime = 0;
      audio.removeAttribute('src');
      audio.load();
    }
    setPlayingAudioKey(null);
    window.speechSynthesis.cancel();
  }

  function playParagraphAudio(key: string, audioUrl: string) {
    stopParagraphAudio();

    const audio = new Audio(audioUrl);
    audioRef.current = audio;
    setPlayingAudioKey(key);

    audio.addEventListener('ended', () => {
      setPlayingAudioKey((current) => (current === key ? null : current));
    });

    void audio.play().catch(() => {
      setNotice('音频播放失败');
      window.setTimeout(() => setNotice(''), 1800);
      setPlayingAudioKey(null);
    });
  }

  function toggleParagraphAudio(key: string, audioUrl: string) {
    const audio = audioRef.current;
    if (playingAudioKey === key && audio && !audio.paused) {
      audio.pause();
      setPlayingAudioKey(null);
      return;
    }

    if (playingAudioKey === key && audio?.paused) {
      void audio.play().catch(() => {
        setNotice('音频播放失败');
        window.setTimeout(() => setNotice(''), 1800);
      });
      setPlayingAudioKey(key);
      return;
    }

    playParagraphAudio(key, audioUrl);
  }

  function resetRecordingDraft() {
    if (recordingPreviewUrl) {
      URL.revokeObjectURL(recordingPreviewUrl);
    }
    setRecordingPreviewUrl(null);
    setRecordingBlob(null);
    setRecordingState('idle');
    recordingChunksRef.current = [];
  }

  function stopRecordingStream() {
    recordingStreamRef.current?.getTracks().forEach((track) => track.stop());
    recordingStreamRef.current = null;
  }

  function blobToDataUrl(blob: Blob) {
    return new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(reader.error || new Error('Failed to read recording'));
      reader.readAsDataURL(blob);
    });
  }

  function dubbingBundleKey(selection: Pick<SelectedParagraph, 'chapterId' | 'paragraphIndex'>) {
    return `${selection.chapterId}-${selection.paragraphIndex}`;
  }

  function aiComposerMatchesUnit(binding: AiComposerBinding | null, unit: ContentUnit) {
    return Boolean(
      binding &&
        binding.unitId === unit.id &&
        binding.sourceHash === unit.sourceHash &&
        binding.selectionKey === `${unit.chapterId}-${unit.paragraphIndex}`
    );
  }

  function resetAiComposerState(invalidateRequest = true) {
    if (invalidateRequest) {
      aiComposerRequestRef.current += 1;
    }
    setAiPlanning(false);
    setVoiceSaving(false);
    setVoiceDesignSaving(false);
    setAiComposerOpen(false);
    setAiPlan(null);
    setAiComposerBinding(null);
    setSelectedVoiceSpeaker('');
    setVoicePrompt('');
    setVoicePreviewText('');
    setVoiceDesignsBySpeaker({});
    setAnnotationCursorBySegment({});
    setPauseSecondsBySegment({});
    setVocalTagBySegment({});
  }

  function closeAiComposer() {
    resetAiComposerState();
  }

  function closeAiDesignMenu() {
    closeAiComposer();
    setVoicePanelOpen(false);
  }

  async function loadDubbingBundle(selection = selectedParagraph) {
    if (!selection) {
      return null;
    }

    const key = dubbingBundleKey(selection);
    setVoiceLoadingKey(key);

    try {
      const bundle = await api.dubbingUnitAtPosition(
        'speckled-band',
        selection.chapterId,
        selection.paragraphIndex
      );
      setDubbingBundles((prev) => ({ ...prev, [key]: bundle }));
      setSelectedParagraph((current) =>
        current && current.chapterId === bundle.unit.chapterId && current.paragraphIndex === bundle.unit.paragraphIndex
          ? { ...current, draft: bundle.unit.sourceText, range: bundle.unit.range }
          : current
      );
      return bundle;
    } catch (error) {
      setNotice(error instanceof Error ? error.message : '配音版本加载失败');
      window.setTimeout(() => setNotice(''), 2400);
      return null;
    } finally {
      setVoiceLoadingKey(null);
    }
  }

  async function startAiDubbingCreation() {
    if (!user) {
      setPage('login');
      return;
    }
    if (!selectedParagraph || aiPlanning || voiceSaving) {
      return;
    }

    const requestedSelection = selectedParagraph;
    const requestedSelectionKey = dubbingBundleKey(requestedSelection);
    const requestId = aiComposerRequestRef.current + 1;
    aiComposerRequestRef.current = requestId;

    resetAiComposerState(false);
    setAiPlanning(true);
    setAiComposerOpen(true);
    setVoicePanelOpen(true);
    try {
      const bundle =
        dubbingBundles[requestedSelectionKey] || (await loadDubbingBundle(requestedSelection));
      if (!bundle) {
        throw new Error('暂时无法读取这个段落的配音');
      }
      if (!bundle.unit.hasDialogue) {
        throw new Error('这个段落没有角色对白，不需要创建配音');
      }
      const { unit, plan } = await api.planAiDubbing(bundle.unit.id);
      if (
        aiComposerRequestRef.current !== requestId ||
        selectedDubbingKeyRef.current !== requestedSelectionKey
      ) {
        return;
      }
      if (unit.id !== bundle.unit.id || unit.sourceHash !== bundle.unit.sourceHash) {
        throw new Error('标准段落已更新，请重新打开 AI 配音编辑器');
      }
      if (!plan.segments.length) {
        throw new Error('没有从这个段落识别出可配音的角色对白');
      }
      const firstSpeaker = plan.segments.find((segment) => segment.speakerCode)?.speakerCode || '';
      setAiComposerBinding({
        unitId: unit.id,
        sourceHash: unit.sourceHash,
        selectionKey: requestedSelectionKey
      });
      setAiPlan(plan);
      setAnnotationCursorBySegment(Object.fromEntries(plan.segments.map((segment) => {
        const punctuationOffset = Math.max(segment.text.indexOf('，'), segment.text.indexOf(','));
        const offset = punctuationOffset >= 0 ? punctuationOffset + 1 : Math.min(1, segment.text.length);
        return [segment.segmentId, offset];
      })));
      setPauseSecondsBySegment(Object.fromEntries(plan.segments.map((segment) => [
        segment.segmentId,
        plan.capabilities.ranges.pause.default
      ])));
      setVocalTagBySegment(Object.fromEntries(plan.segments.map((segment) => [
        segment.segmentId,
        plan.capabilities.vocalTags[0]?.value || 'breath'
      ])));
      setSelectedVoiceSpeaker(firstSpeaker);
      setVoicePreviewText(
        plan.segments.find((segment) => segment.speakerCode === firstSpeaker)?.text || plan.segments[0].text
      );
      setVoicePrompt('');
      setVoiceDesignsBySpeaker({});
      setVoicePanelTab('mine');
    } catch (error) {
      if (aiComposerRequestRef.current !== requestId) {
        return;
      }
      resetAiComposerState(false);
      setVoicePanelOpen(false);
      setNotice(error instanceof Error ? error.message : 'AI 配音规划失败');
      window.setTimeout(() => setNotice(''), 2800);
    } finally {
      if (aiComposerRequestRef.current === requestId) {
        setAiPlanning(false);
      }
    }
  }

  function updateAiPlanSegment(
    segmentId: string,
    key: 'speakerCode' | keyof DubbingPerformance,
    value: string | number | string[]
  ) {
    setAiPlan((current) => {
      if (!current) return current;
      return {
        ...current,
        segments: current.segments.map((segment) => {
          if (segment.segmentId !== segmentId) return segment;
          if (key === 'speakerCode') {
            return { ...segment, speakerCode: String(value), templateCode: null };
          }
          return {
            ...segment,
            performance: { ...segment.performance, [key]: value }
          };
        })
      };
    });
  }

  function updateAiSegmentRecipe(
    segmentId: string,
    updater: (recipe: MiniMaxSegmentRecipe) => MiniMaxSegmentRecipe
  ) {
    setAiPlan((current) => {
      if (!current) return current;
      return {
        ...current,
        segments: current.segments.map((segment) =>
          segment.segmentId === segmentId && segment.recipe
            ? { ...segment, recipe: updater(segment.recipe) }
            : segment
        )
      };
    });
  }

  function updateRecipeSection<Section extends 'voiceSetting' | 'voiceModify' | 'voiceSource'>(
    segmentId: string,
    section: Section,
    patch: Partial<MiniMaxSegmentRecipe[Section]>
  ) {
    updateAiSegmentRecipe(segmentId, (recipe) => ({
      ...recipe,
      [section]: { ...recipe[section], ...patch }
    }));
  }

  function updateGenerationSettings(
    updater: (settings: MiniMaxGenerationSettings) => MiniMaxGenerationSettings
  ) {
    setAiPlan((current) => current ? { ...current, generationSettings: updater(current.generationSettings) } : current);
  }

  function setRecipeVoiceSourceMode(segmentId: string, mode: MiniMaxSegmentRecipe['voiceSource']['mode']) {
    updateAiSegmentRecipe(segmentId, (recipe) => ({
      ...recipe,
      voiceSource: {
        ...recipe.voiceSource,
        mode,
        timbreWeights: mode === 'blend' && recipe.voiceSource.timbreWeights.length < 2
          ? [{ voiceId: '', weight: 50 }, { voiceId: '', weight: 50 }]
          : recipe.voiceSource.timbreWeights
      }
    }));
  }

  function updateTimbreWeight(
    segmentId: string,
    index: number,
    patch: Partial<{ voiceId: string; weight: number }>
  ) {
    updateAiSegmentRecipe(segmentId, (recipe) => ({
      ...recipe,
      voiceSource: {
        ...recipe.voiceSource,
        timbreWeights: recipe.voiceSource.timbreWeights.map((item, itemIndex) =>
          itemIndex === index ? { ...item, ...patch } : item
        )
      }
    }));
  }

  function addTimbreWeight(segmentId: string) {
    if (!aiPlan) return;
    updateAiSegmentRecipe(segmentId, (recipe) => ({
      ...recipe,
      voiceSource: {
        ...recipe.voiceSource,
        timbreWeights: recipe.voiceSource.timbreWeights.length >= aiPlan.capabilities.maxTimbreWeights
          ? recipe.voiceSource.timbreWeights
          : [...recipe.voiceSource.timbreWeights, { voiceId: '', weight: 50 }]
      }
    }));
  }

  function removeTimbreWeight(segmentId: string, index: number) {
    updateAiSegmentRecipe(segmentId, (recipe) => ({
      ...recipe,
      voiceSource: {
        ...recipe.voiceSource,
        timbreWeights: recipe.voiceSource.timbreWeights.filter((_, itemIndex) => itemIndex !== index)
      }
    }));
  }

  function addSegmentAnnotation(segment: DubbingPlanSegment, type: MiniMaxAnnotation['type']) {
    if (!aiPlan || !segment.recipe) return;
    const offset = annotationCursorBySegment[segment.segmentId];
    if (!Number.isInteger(offset)) {
      setNotice('请先点击台词中的一个字，标记会插入在该字之后');
      return;
    }
    if (type === 'pause' && (offset <= 0 || offset >= segment.text.length)) {
      setNotice('停顿必须插入在两个可发音文字之间');
      return;
    }
    if (type === 'pause' && segment.recipe.annotations.some((item) => item.type === 'pause' && item.offset === offset)) {
      setNotice('这个位置已经有停顿标记');
      return;
    }
    const id = typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : `annotation-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const annotation: MiniMaxAnnotation = type === 'pause'
      ? {
          id,
          type,
          offset,
          durationSeconds: pauseSecondsBySegment[segment.segmentId] ?? aiPlan.capabilities.ranges.pause.default
        }
      : {
          id,
          type,
          offset,
          value: vocalTagBySegment[segment.segmentId] || aiPlan.capabilities.vocalTags[0]?.value || 'breath'
        };
    updateAiSegmentRecipe(segment.segmentId, (recipe) => ({
      ...recipe,
      annotations: [...recipe.annotations, annotation].sort((left, right) => left.offset - right.offset)
    }));
  }

  function removeSegmentAnnotation(segmentId: string, annotationId: string) {
    updateAiSegmentRecipe(segmentId, (recipe) => ({
      ...recipe,
      annotations: recipe.annotations.filter((item) => item.id !== annotationId)
    }));
  }

  async function saveCharacterVoiceDesign() {
    if (!aiPlan || !aiComposerBinding || !selectedVoiceSpeaker || voiceDesignSaving) return;
    if (selectedDubbingKeyRef.current !== aiComposerBinding.selectionKey) return;
    const requestId = aiComposerRequestRef.current;
    const prompt = voicePrompt.trim();
    const previewText = voicePreviewText.trim();
    if (prompt.length < 5 || previewText.length < 5) {
      setNotice('请填写至少 5 个字的音色提示词和试听文本');
      window.setTimeout(() => setNotice(''), 2200);
      return;
    }
    const role = aiPlan.roles.find((item) => item.code === selectedVoiceSpeaker);
    setVoiceDesignSaving(true);
    try {
      const { version } = await api.createVoiceDesign({
        articleId: 'speckled-band',
        characterCode: selectedVoiceSpeaker,
        characterName: role?.label || selectedVoiceSpeaker,
        prompt,
        previewText
      });
      if (aiComposerRequestRef.current !== requestId) {
        return;
      }
      setVoiceDesignsBySpeaker((current) => ({ ...current, [selectedVoiceSpeaker]: version }));
      setNotice(`${version.characterName}声线 V${version.versionNumber} 已保存`);
      window.setTimeout(() => setNotice(''), 1800);
    } catch (error) {
      if (aiComposerRequestRef.current !== requestId) {
        return;
      }
      setNotice(error instanceof Error ? error.message : '角色声线生成失败');
      window.setTimeout(() => setNotice(''), 2600);
    } finally {
      if (aiComposerRequestRef.current === requestId) {
        setVoiceDesignSaving(false);
      }
    }
  }

  async function saveAiDubbingVersion(visibility: 'private' | 'public') {
    if (!selectedParagraph || !aiPlan || voiceSaving) return;
    const selectionKey = dubbingBundleKey(selectedParagraph);
    const bundle = dubbingBundles[selectionKey];
    if (!bundle) return;
    if (!aiComposerMatchesUnit(aiComposerBinding, bundle.unit)) {
      closeAiComposer();
      setNotice('段落已经切换，请重新打开 AI 配音编辑器');
      window.setTimeout(() => setNotice(''), 2600);
      return;
    }

    const requestId = aiComposerRequestRef.current;
    const requestedSelection = selectedParagraph;
    setVoiceSaving(true);
    try {
      const voiceDesignVersionIdsBySpeaker = Object.fromEntries(
        Object.entries(voiceDesignsBySpeaker).map(([speakerCode, version]) => [speakerCode, version.id])
      );
      await api.createAiDubbingVersion(bundle.unit.id, {
        segments: aiPlan.segments,
        voiceDesignVersionIdsBySpeaker,
        generationSettings: aiPlan.generationSettings,
        visibility
      });
      await loadDubbingBundle(requestedSelection);
      if (
        aiComposerRequestRef.current === requestId &&
        selectedDubbingKeyRef.current === selectionKey
      ) {
        closeAiComposer();
      }
      setNotice(visibility === 'public' ? 'AI 配音新版本已公开' : 'AI 配音已私密保存');
      window.setTimeout(() => setNotice(''), 1800);
    } catch (error) {
      if (aiComposerRequestRef.current !== requestId) {
        return;
      }
      setNotice(error instanceof Error ? error.message : 'AI 配音生成失败');
      window.setTimeout(() => setNotice(''), 3000);
    } finally {
      if (aiComposerRequestRef.current === requestId) {
        setVoiceSaving(false);
      }
    }
  }

  async function startUserRecording() {
    if (!user) {
      setPage('login');
      return;
    }
    try {
      if (selectedParagraph) {
        await loadDubbingBundle(selectedParagraph);
      }
      resetRecordingDraft();
      const isLocalhost = ['localhost', '127.0.0.1', '::1'].includes(window.location.hostname);
      if (!window.isSecureContext && !isLocalhost) {
        throw new Error('浏览器要求 HTTPS 才能使用麦克风录音');
      }

      if (!navigator.mediaDevices?.getUserMedia) {
        throw new Error('当前浏览器或访问方式不支持麦克风录音');
      }

      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      recordingStreamRef.current = stream;
      const recorderOptions =
        typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
          ? { mimeType: 'audio/webm;codecs=opus' }
          : undefined;
      const recorder = new MediaRecorder(stream, recorderOptions);
      mediaRecorderRef.current = recorder;
      recordingChunksRef.current = [];

      recorder.addEventListener('dataavailable', (event) => {
        if (event.data.size > 0) {
          recordingChunksRef.current.push(event.data);
        }
      });

      recorder.addEventListener('stop', () => {
        const mimeType = recorder.mimeType || 'audio/webm';
        const blob = new Blob(recordingChunksRef.current, { type: mimeType });
        setRecordingBlob(blob);
        setRecordingPreviewUrl(URL.createObjectURL(blob));
        setRecordingState('ready');
        stopRecordingStream();
      });

      recorder.start();
      setRecordingState('recording');
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Microphone permission failed');
      window.setTimeout(() => setNotice(''), 2400);
    }
  }

  function stopUserRecording() {
    if (mediaRecorderRef.current?.state === 'recording') {
      mediaRecorderRef.current.stop();
    }
  }

  async function saveUserRecording(visibility: 'private' | 'public') {
    if (!selectedParagraph || !recordingBlob || voiceSaving) {
      return;
    }
    if (!user) {
      setPage('login');
      return;
    }
    setVoiceSaving(true);

    try {
      const bundle =
        dubbingBundles[dubbingBundleKey(selectedParagraph)] || (await loadDubbingBundle(selectedParagraph));
      if (!bundle) return;
      const audioDataUrl = await blobToDataUrl(recordingBlob);
      await api.createHumanDubbingVersion(bundle.unit.id, { audioDataUrl, visibility });
      await loadDubbingBundle(selectedParagraph);
      resetRecordingDraft();
      setNotice(visibility === 'public' ? '真人配音新版本已公开' : '真人配音已私密保存');
      window.setTimeout(() => setNotice(''), 1800);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : '真人配音保存失败');
      window.setTimeout(() => setNotice(''), 2600);
    } finally {
      setVoiceSaving(false);
    }
  }

  async function updateDubbingStatus(version: DubbingVersion, status: 'public' | 'withdrawn' | 'deleted') {
    try {
      await api.setDubbingStatus(version.id, status);
      if (selectedParagraph) await loadDubbingBundle(selectedParagraph);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : '配音状态更新失败');
      window.setTimeout(() => setNotice(''), 2400);
    }
  }

  async function deleteDubbingVersion(version: DubbingVersion) {
    const confirmed = window.confirm(
      version.status === 'public'
        ? '公开版本将被撤回，新用户无法再查看或采用。已有采用者仍可继续播放。'
        : '确定删除这个私密版本吗？'
    );
    if (!confirmed) {
      return;
    }
    await updateDubbingStatus(version, version.status === 'public' ? 'withdrawn' : 'deleted');
  }

  async function toggleDubbingLike(version: DubbingVersion) {
    if (!user) {
      setPage('login');
      return;
    }
    try {
      await api.likeDubbingVersion(version.id, !version.likedByMe);
      if (selectedParagraph) await loadDubbingBundle(selectedParagraph);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : '点赞更新失败');
      window.setTimeout(() => setNotice(''), 2200);
    }
  }

  async function adoptDubbingVersion(version: DubbingVersion, unit: ContentUnit) {
    if (!user) {
      setPage('login');
      return;
    }
    try {
      await api.adoptDubbingVersion(unit.id, version.id);
      await loadDubbingBundle(selectedParagraph);
      const audio = audioFromDubbingVersion({ ...version, adoptedByMe: true });
      setParagraphAudios((current) => ({
        ...current,
        [rangeKey(audio.chapterId, audio.range)]: audio
      }));
      setNotice('已用于我的阅读');
      window.setTimeout(() => setNotice(''), 1600);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : '采用配音失败');
      window.setTimeout(() => setNotice(''), 2200);
    }
  }

  async function cancelDubbingAdoption(unit: ContentUnit) {
    if (!user) return;
    try {
      await api.cancelDubbingAdoption(unit.id);
      await loadDubbingBundle(selectedParagraph);
      const key = rangeKey(unit.chapterId, unit.range);
      setParagraphAudios((current) => {
        const next = { ...current };
        const platformAudio = platformParagraphAudios[key];
        if (platformAudio) next[key] = platformAudio;
        else delete next[key];
        return next;
      });
      setNotice('已恢复平台默认配音');
      window.setTimeout(() => setNotice(''), 1600);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : '取消采用失败');
      window.setTimeout(() => setNotice(''), 2200);
    }
  }

  async function reportDubbingVersion(version: DubbingVersion) {
    if (!user) {
      setPage('login');
      return;
    }
    const reason = window.prompt('请简要说明举报原因（3-500 字）')?.trim() || '';
    if (!reason) return;
    try {
      await api.reportDubbingVersion(version.id, reason);
      setNotice('举报已提交，等待平台处理');
      window.setTimeout(() => setNotice(''), 1800);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : '举报提交失败');
      window.setTimeout(() => setNotice(''), 2200);
    }
  }

  useEffect(() => {
    return () => {
      if (longPressTimer.current !== null) {
        window.clearTimeout(longPressTimer.current);
      }
      const audio = audioRef.current;
      if (audio) {
        audio.pause();
        audio.removeAttribute('src');
      }
      stopRecordingStream();
      if (recordingPreviewUrl) {
        URL.revokeObjectURL(recordingPreviewUrl);
      }
    };
  }, [recordingPreviewUrl]);

  function paragraphKey(paragraphIndex: number) {
    return `${chapter.id}-${paragraphIndex}`;
  }

  function paragraphToText(paragraph: TextSegment[]) {
    return paragraph.map((segment) => segment.text).join('');
  }

  function clearLongPressTimer() {
    if (longPressTimer.current !== null) {
      window.clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
  }

  const refreshSelectionLayout = useCallback(() => {
    if (!selectedParagraph || !bookPageRef.current) {
      setSelectionLayout(null);
      return;
    }

    setSelectionLayout(computeSelectionLayout(bookPageRef.current, selectedParagraph.range));
  }, [selectedParagraph]);

  useEffect(() => {
    if (!selectedParagraph) {
      setSelectionLayout(null);
      return;
    }

    const frame = window.requestAnimationFrame(() => refreshSelectionLayout());
    return () => window.cancelAnimationFrame(frame);
  }, [selectedParagraph, refreshSelectionLayout, fontSize, readingWidth, chapter.id]);

  useEffect(() => {
    if (!selectedParagraph) {
      return;
    }

    const handleViewportChange = () => refreshSelectionLayout();
    window.addEventListener('scroll', handleViewportChange, true);
    window.addEventListener('resize', handleViewportChange);

    return () => {
      window.removeEventListener('scroll', handleViewportChange, true);
      window.removeEventListener('resize', handleViewportChange);
    };
  }, [selectedParagraph, refreshSelectionLayout]);

  useEffect(() => {
    if (!draggingHandle || !selectedParagraph || !bookPageRef.current) {
      return;
    }

    const handlePointerMove = (event: PointerEvent) => {
      const point = getCaretPointFromPointer(
        bookPageRef.current!,
        event.clientX,
        event.clientY,
        chapter.paragraphs.length
      );

      if (!point) {
        return;
      }

      setSelectedParagraph((current) => {
        if (!current) {
          return current;
        }

        const nextRange =
          draggingHandle === 'start'
            ? {
                ...current.range,
                startParagraphIndex: point.paragraphIndex,
                startOffset: point.offset
              }
            : {
                ...current.range,
                endParagraphIndex: point.paragraphIndex,
                endOffset: point.offset
              };
        const normalizedRange = normalizeRange(nextRange);
        const draft = getTextFromRange(chapter.paragraphs, normalizedRange);

        return {
          ...current,
          paragraphIndex: normalizedRange.startParagraphIndex,
          range: normalizedRange,
          draft
        };
      });
    };

    const handlePointerUp = () => setDraggingHandle(null);

    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp);

    return () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
    };
  }, [chapter.paragraphs, draggingHandle, selectedParagraph]);

  useEffect(() => {
    if (!selectedParagraph) {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setSelectedParagraph(null);
      }
    };

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as HTMLElement;
      if (
        target.closest('.text-selection-layer') ||
        target.closest('.reader-paragraph') ||
        target.closest('.inline-audio-play')
      ) {
        return;
      }
      setSelectedParagraph(null);
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('pointerdown', handlePointerDown, true);

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('pointerdown', handlePointerDown, true);
    };
  }, [selectedParagraph]);

  useEffect(() => {
    const selectionKey = selectedParagraph ? dubbingBundleKey(selectedParagraph) : null;
    if (selectedDubbingKeyRef.current === selectionKey) {
      return;
    }

    selectedDubbingKeyRef.current = selectionKey;
    resetAiComposerState();
    setVoicePanelOpen(false);
  }, [selectedParagraph?.chapterId, selectedParagraph?.paragraphIndex]);

  useEffect(() => {
    if (!selectedParagraph) {
      setVoicePanelOpen(false);
      return;
    }

    if (voicePanelOpen) {
      void loadDubbingBundle(selectedParagraph);
    }
  }, [selectedParagraph?.chapterId, selectedParagraph?.paragraphIndex, voicePanelOpen]);

  function selectParagraph(paragraph: TextSegment[], paragraphIndex: number) {
    clearLongPressTimer();
    const draft = paragraphToText(paragraph);
    const range: TextRange = {
      startParagraphIndex: paragraphIndex,
      startOffset: 0,
      endParagraphIndex: paragraphIndex,
      endOffset: draft.length
    };

    setSelectedParagraph({
      chapterId: chapter.id,
      paragraphIndex,
      draft,
      range
    });
  }

  function handleParagraphContextMenu(event: React.MouseEvent, paragraph: TextSegment[], paragraphIndex: number) {
    event.preventDefault();
    selectParagraph(paragraph, paragraphIndex);
  }

  function handleParagraphPointerDown(
    event: React.PointerEvent,
    paragraph: TextSegment[],
    paragraphIndex: number
  ) {
    if (event.button !== 0 || (event.target as HTMLElement).closest('button')) {
      return;
    }

    clearLongPressTimer();
    longPressTimer.current = window.setTimeout(() => {
      selectParagraph(paragraph, paragraphIndex);
    }, 560);
  }

  async function generateParagraphSpeech() {
    if (!selectedParagraph || paragraphSpeechLoadingKey) return;

    const targetSegment = selectedParagraph.draft.trim();
    if (!targetSegment) {
      setNotice('目标段落不能为空');
      window.setTimeout(() => setNotice(''), 1800);
      return;
    }

    const key = rangeKey(selectedParagraph.chapterId, selectedParagraph.range);
    const savedRange = selectedParagraph.range;
    const savedChapterId = selectedParagraph.chapterId;
    const savedParagraphIndex = selectedParagraph.paragraphIndex;

    setParagraphSpeechLoadingKey(key);
    setNotice('正在一键生成 AI 配音...');
    try {
      const result = await api.paragraphSpeech({
        chapterId: savedChapterId,
        paragraphIndex: savedParagraphIndex,
        targetSegment,
        range: savedRange
      });
      const audio = { ...result, chapterId: savedChapterId, range: savedRange, fromLibrary: false };
      setParagraphAudios((prev) => ({ ...prev, [key]: audio }));
      setPlatformParagraphAudios((prev) => ({ ...prev, [key]: audio }));
      setSelectedParagraph(null);
      setNotice('AI 配音已生成');
      window.setTimeout(() => setNotice(''), 1800);
      playParagraphAudio(key, result.audioUrl);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'AI 配音生成失败');
      window.setTimeout(() => setNotice(''), 2600);
    } finally {
      setParagraphSpeechLoadingKey(null);
    }
  }

  function openHumanDubbingPlaceholder() {
    setNotice('“我来配音”下级菜单将在下一阶段实现');
    window.setTimeout(() => setNotice(''), 2200);
  }

  async function generateParagraphImage() {
    if (!selectedParagraph || paragraphImageLoadingKey) return;

    const targetSegment = selectedParagraph.draft.trim();
    if (!targetSegment) {
      setNotice('目标段落不能为空');
      window.setTimeout(() => setNotice(''), 1800);
      return;
    }

    const key = rangeKey(selectedParagraph.chapterId, selectedParagraph.range);
    const savedRange = selectedParagraph.range;
    const savedChapterId = selectedParagraph.chapterId;
    const savedParagraphIndex = selectedParagraph.paragraphIndex;
    const existingImage = paragraphImages[key];

    if (existingImage) {
      setSelectedParagraph(null);
      setNotice('已调用媒体库插图');
      window.setTimeout(() => setNotice(''), 1800);
      return;
    }

    setParagraphImageLoadingKey(key);
    setNotice('正在生成段落插图，首次使用会先初始化全书风格，可能较慢');
    try {
      const result = await api.paragraphImage({
        chapterId: savedChapterId,
        paragraphIndex: savedParagraphIndex,
        targetSegment,
        range: savedRange
      });
      setParagraphImages((prev) => ({
        ...prev,
        [key]: { ...result, chapterId: savedChapterId, range: savedRange, fromLibrary: false }
      }));
      setSelectedParagraph(null);
      setNotice('段落插图已生成');
      window.setTimeout(() => setNotice(''), 1800);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : '段落插图生成失败');
      window.setTimeout(() => setNotice(''), 2600);
    } finally {
      setParagraphImageLoadingKey(null);
    }
  }

  function hideParagraphImage(key: string) {
    setParagraphImages((prev) => {
      const next = { ...prev };
      delete next[key];
      return next;
    });
    setNotice('插图已收起');
    window.setTimeout(() => setNotice(''), 1600);
  }

  async function deleteParagraphImage(key: string, image: RangeMedia<ParagraphImage>) {
    const confirmed = window.confirm('删除这张插图后，同一片段可以重新生成。确认删除？');
    if (!confirmed) {
      return;
    }

    try {
      if (image.mediaAssetId) {
        await api.deleteMediaAsset(image.mediaAssetId);
      }

      setParagraphImages((prev) => {
        const next = { ...prev };
        delete next[key];
        return next;
      });
      setNotice('插图已删除');
      window.setTimeout(() => setNotice(''), 1600);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : '插图删除失败');
      window.setTimeout(() => setNotice(''), 2400);
    }
  }

  async function askAssistant() {
    if (!question.trim() || !chapter) return;
    const currentQuestion = question.trim();
    setQuestion('');
    setMessages((prev) => [...prev, { role: 'reader', content: currentQuestion }]);
    let answer: string;
    try {
      answer = await api.aiChat(currentQuestion, chapter.id, collectedClueIds);
    } catch (error) {
      answer = await api.chat(currentQuestion, chapter.id, collectedClueIds);
    }
    setMessages((prev) => [...prev, { role: 'assistant', content: answer }]);
  }

  async function generateSceneImage() {
    if (!chapter) return;
    if (generatedSceneImage) {
      setSceneGenerated(true);
      setNotice('已调用媒体库现场图');
      window.setTimeout(() => setNotice(''), 1800);
      return;
    }

    setSceneLoading(true);
    try {
      const result = await api.image(chapter.id);
      setGeneratedSceneImage(result);
      setSceneGenerated(true);
    } catch (error) {
      setSceneGenerated(true);
      setNotice('MiniMax 生图失败，已显示本地示意图兜底');
      window.setTimeout(() => setNotice(''), 2200);
    } finally {
      setSceneLoading(false);
    }
  }

  async function generateQueuedClueImages(initial: {
    clueId: string;
    occurrenceId: string;
    force: boolean;
  }) {
    if (clueGenerationRunningRef.current) {
      queuedClueGenerationRef.current = initial;
      return;
    }

    clueGenerationRunningRef.current = true;
    let current: typeof initial | null = initial;
    while (current) {
      const request = current;
      const key = clueImageKey(request.clueId);
      setClueImages((previous) => ({
        ...previous,
        [key]: {
          ...(previous[key] || {
            clueId: request.clueId,
            occurrenceId: request.occurrenceId,
            skipped: false,
            cacheHit: false,
            userOverride: request.force
          }),
          loading: true,
          error: undefined
        }
      }));

      try {
        const result = await api.clueImage(request);
        setClueImages((previous) => ({ ...previous, [key]: { ...result, loading: false } }));
      } catch (error) {
        const message = error instanceof Error ? error.message : '线索图生成失败';
        setClueImages((previous) => ({
          ...previous,
          [key]: {
            ...(previous[key] || {
              clueId: request.clueId,
              occurrenceId: request.occurrenceId,
              skipped: false,
              cacheHit: false,
              userOverride: request.force
            }),
            loading: false,
            error: message
          }
        }));
      }

      current = queuedClueGenerationRef.current;
      queuedClueGenerationRef.current = null;
    }
    clueGenerationRunningRef.current = false;
  }

  function collectClue(clueId: string, requestedOccurrenceId?: string) {
    const clue = clues.find((item) => item.id === clueId);
    if (!clue) return;
    const occurrenceId = resolveClueOccurrenceId(clue, requestedOccurrenceId);

    setCollectedClues((previous) => {
      const existing = previous.find((item) => item.clueId === clueId);
      if (existing) {
        setNotice(
          existing.occurrenceId === occurrenceId
            ? `已打开：“${clue.label}”`
            : `已更新“${clue.label}”的阅读位置`
        );
        return previous.map((item) => (item.clueId === clueId ? { clueId, occurrenceId } : item));
      }
      setNotice(`已收入证物袋：“${clue.label}”`);
      return [...previous, { clueId, occurrenceId }];
    });

    setActiveClueId(clueId);
    setContextTab('bag');
    setContextOpen(true);
    setBagPulse(true);
    window.setTimeout(() => setBagPulse(false), 620);
    const existingImage = clueImages[clueImageKey(clueId)];
    if (occurrenceId && !existingImage?.imageUrl && !existingImage?.skipped && !existingImage?.loading) {
      void generateQueuedClueImages({ clueId, occurrenceId, force: false });
    }

    window.setTimeout(() => setNotice(''), 1800);
  }

  function removeClue(clueId: string) {
    const clue = clues.find((item) => item.id === clueId);

    setCollectedClues((previous) => previous.filter((item) => item.clueId !== clueId));
    setActiveClueId((current) => (current === clueId ? null : current));
    setNotice(clue ? `已从证物袋取出：“${clue.label}”` : '已从证物袋取出');
    window.setTimeout(() => setNotice(''), 1800);
  }

  function regenerateClue(clueId: string, occurrenceId: string) {
    if (!occurrenceId) {
      setNotice('线索服务版本未更新，请稍后刷新页面');
      window.setTimeout(() => setNotice(''), 2200);
      return;
    }
    setActiveClueId(clueId);
    void generateQueuedClueImages({ clueId, occurrenceId, force: true });
  }

  function renderSegmentSlice(segment: TextSegment, segmentIndex: number, text: string) {
    if (!text) {
      return null;
    }

    if (segment.type === 'clue') {
      if (text.length !== segment.text.length) {
        return <span key={`${segmentIndex}-${text}`}>{text}</span>;
      }

      return (
        <button
          key={segmentIndex}
          className={collectedClueIds.includes(segment.clueId) ? 'clue-segment collected' : 'clue-segment'}
          onClick={() => collectClue(segment.clueId, segment.occurrenceId)}
          title={collectedClueIds.includes(segment.clueId) ? '打开证物袋' : '点击收入证物袋并生成图像'}
          type="button"
        >
          {text}
        </button>
      );
    }

    return <span key={`${segmentIndex}-${text}`}>{text}</span>;
  }

  function renderTextRange(paragraph: TextSegment[], start: number, end: number) {
    if (start >= end) {
      return [];
    }

    const nodes: React.ReactNode[] = [];
    let offset = 0;

    paragraph.forEach((segment, segmentIndex) => {
      const segmentStart = offset;
      const segmentEnd = offset + segment.text.length;
      offset = segmentEnd;

      if (segmentEnd <= start || segmentStart >= end) {
        return;
      }

      const sliceStart = Math.max(0, start - segmentStart);
      const sliceEnd = Math.min(segment.text.length, end - segmentStart);
      const slice = segment.text.slice(sliceStart, sliceEnd);
      const node = renderSegmentSlice(segment, segmentIndex, slice);

      if (node) {
        nodes.push(node);
      }
    });

    return nodes;
  }

  function renderInlinePlayButton(mediaKey: string, audio: RangeMedia<ParagraphSpeech>) {
    const isPlaying = playingAudioKey === mediaKey;

    return (
      <button
        key={`play-${mediaKey}`}
        type="button"
        className={`inline-audio-play${isPlaying ? ' playing' : ''}${audio.fromLibrary ? ' library-media' : ''}`}
        onClick={(event) => {
          event.stopPropagation();
          toggleParagraphAudio(mediaKey, audio.audioUrl);
        }}
        aria-label={isPlaying ? '暂停配音' : '播放配音'}
        title={isPlaying ? '暂停' : '播放配音'}
      />
    );
  }

  function renderDubbingVersionCard(version: DubbingVersion, unit: ContentUnit) {
    const audioKey = `dubbing-${version.id}`;
    const isPlaying = playingAudioKey === audioKey;
    const isMine = version.ownerUserId === user?.id;
    const kindLabel = version.kind === 'ai' ? 'AI 配音' : '真人演绎';
    const statusLabels: Record<DubbingStatus, string> = {
      private: '私密',
      public: '公开',
      withdrawn: '已停止公开',
      moderated: '已下架',
      deleted: '已删除'
    };

    return (
      <article key={version.id} className={`voice-recording-row dubbing-version-card${version.adoptedByMe ? ' adopted' : ''}`}>
        <div className="dubbing-version-summary">
          <strong>{isMine ? '我的配音' : version.displayName || version.username}</strong>
          <small>
            {kindLabel} · V{version.versionNumber} · {statusLabels[version.status]}
          </small>
          <span>点赞 {version.likeCount} · 采用 {version.adoptionCount}</span>
        </div>
        <div className="voice-recording-actions">
          <button type="button" onClick={() => toggleParagraphAudio(audioKey, version.audioUrl)}>
            {isPlaying ? '暂停' : '播放'}
          </button>
          {version.adoptedByMe ? (
            <button type="button" onClick={() => void cancelDubbingAdoption(unit)}>
              取消采用
            </button>
          ) : version.status === 'public' ? (
            <button type="button" onClick={() => void adoptDubbingVersion(version, unit)}>
              用于我的阅读
            </button>
          ) : null}
          {!isMine && version.status === 'public' && (
            <>
              <button type="button" onClick={() => void toggleDubbingLike(version)}>
                {version.likedByMe ? '已赞' : '点赞'}
              </button>
              <button type="button" onClick={() => void reportDubbingVersion(version)}>举报</button>
            </>
          )}
          {isMine ? (
            <>
              {version.status === 'private' && (
                <button type="button" onClick={() => void updateDubbingStatus(version, 'public')}>公开</button>
              )}
              {(version.status === 'private' || version.status === 'public') && (
                <button type="button" onClick={() => void deleteDubbingVersion(version)}>
                  {version.status === 'public' ? '撤回' : '删除'}
                </button>
              )}
            </>
          ) : null}
        </div>
        {version.kind === 'ai' && version.promptSnapshot && (
          <details className="dubbing-prompt-details">
            <summary>展开设计</summary>
            {Object.entries(version.promptSnapshot.voiceDesigns || {}).map(([speakerCode, design]) => (
              <div key={speakerCode} className="dubbing-prompt-block">
                <strong>{design.characterName}声线 V{design.versionNumber}</strong>
                <p>{design.prompt}</p>
                <small>试听文本：{design.previewText}</small>
              </div>
            ))}
            {(version.promptSnapshot.performanceSegments || []).map((segment) => {
              const recipe = segment.recipe;
              return (
                <div key={segment.segmentId} className="dubbing-prompt-block">
                  <strong>{segment.text}</strong>
                  {recipe ? (
                    <>
                      <p>
                        MiniMax：{recipe.voiceSetting.emotion || '自动情绪'} · 语速 {recipe.voiceSetting.speed} ·
                        音量 {recipe.voiceSetting.volume} · 音调 {recipe.voiceSetting.pitch}
                      </p>
                      <p>
                        标记 {recipe.annotations.length} 个 · 效果器（音高 {recipe.voiceModify.pitch} / 力度{' '}
                        {recipe.voiceModify.intensity} / 音色 {recipe.voiceModify.timbre}）
                      </p>
                    </>
                  ) : (
                    <p>
                      {segment.performance.情绪} · {segment.performance.语速} · 强度 {segment.performance.强度} ·{' '}
                      {segment.performance.节奏} · {segment.performance.停顿}
                    </p>
                  )}
                </div>
              );
            })}
            {(version.promptSnapshot.generationSettings || version.promptSnapshot.ttsRequests) && (
              <details className="raw-minimax-recipe">
                <summary>查看完整 MiniMax 参数</summary>
                <pre>{JSON.stringify({
                  generationSettings: version.promptSnapshot.generationSettings,
                  requests: version.promptSnapshot.ttsRequests
                }, null, 2)}</pre>
              </details>
            )}
          </details>
        )}
      </article>
    );
  }

  function renderAnnotatedSegmentText(segment: DubbingPlanSegment) {
    if (!segment.recipe || !aiPlan) return <p>{segment.text}</p>;
    const units: Array<{ char: string; start: number; end: number }> = [];
    let utf16Offset = 0;
    for (const char of segment.text) {
      units.push({ char, start: utf16Offset, end: utf16Offset + char.length });
      utf16Offset += char.length;
    }
    const annotationsAt = (offset: number) => segment.recipe?.annotations.filter((item) => item.offset === offset) || [];
    const renderAnnotations = (offset: number) => annotationsAt(offset).map((annotation) => {
      const label = annotation.type === 'pause'
        ? `停顿 ${annotation.durationSeconds}s`
        : aiPlan.capabilities.vocalTags.find((item) => item.value === annotation.value)?.label || annotation.value;
      return (
        <button
          key={annotation.id}
          type="button"
          className={`speech-annotation-chip ${annotation.type}`}
          title="点击删除标记"
          onClick={() => removeSegmentAnnotation(segment.segmentId, annotation.id)}
        >
          {label}<span aria-hidden="true">×</span>
        </button>
      );
    });

    return (
      <div className="annotated-script" aria-label="可插入 MiniMax 台词标记的原文">
        {renderAnnotations(0)}
        {units.map((unit) => (
          <React.Fragment key={`${segment.segmentId}-${unit.start}`}>
            <button
              type="button"
              className={annotationCursorBySegment[segment.segmentId] === unit.end ? 'script-character active' : 'script-character'}
              title={`点击后在“${unit.char}”之后插入标记`}
              onClick={() => setAnnotationCursorBySegment((current) => ({
                ...current,
                [segment.segmentId]: unit.end
              }))}
            >
              {unit.char}
            </button>
            {renderAnnotations(unit.end)}
          </React.Fragment>
        ))}
      </div>
    );
  }

  function renderAiComposer(bundle: DubbingUnitBundle) {
    if (!aiComposerOpen) return null;
    if (aiPlanning) {
      return <p className="voice-panel-empty">正在识别角色和表演方式...</p>;
    }
    if (!aiPlan || !aiComposerMatchesUnit(aiComposerBinding, bundle.unit)) return null;
    const capabilities = aiPlan.capabilities;

    return (
      <section className="ai-dubbing-composer">
        <div className="ai-voice-lock">
          <div>
            <span className="ai-voice-lock-dot" aria-hidden="true" />
            <strong>角色音色已锁定</strong>
          </div>
          <small>这里只调整台词的停顿、情绪与节奏，不创建或更换角色声线。</small>
        </div>

        <details className="minimax-global-settings">
          <summary>MiniMax 生成与音频设置</summary>
          <div className="ai-segment-fields">
            <label>
              模型
              <select
                value={aiPlan.generationSettings.model}
                onChange={(event) => updateGenerationSettings((settings) => ({
                  ...settings,
                  model: event.target.value
                }))}
              >
                {capabilities.models.map((model) => <option key={model} value={model}>{model}</option>)}
              </select>
            </label>
            <label>
              语言增强
              <select
                value={aiPlan.generationSettings.languageBoost}
                onChange={(event) => updateGenerationSettings((settings) => ({
                  ...settings,
                  languageBoost: event.target.value
                }))}
              >
                {capabilities.languages.map((language) => <option key={language} value={language}>{language}</option>)}
              </select>
            </label>
            <label>
              采样率
              <select
                value={aiPlan.generationSettings.audioSetting.sampleRate}
                onChange={(event) => updateGenerationSettings((settings) => ({
                  ...settings,
                  audioSetting: { ...settings.audioSetting, sampleRate: Number(event.target.value) }
                }))}
              >
                {capabilities.audio.sampleRates.map((value) => <option key={value} value={value}>{value} Hz</option>)}
              </select>
            </label>
            <label>
              MP3 比特率
              <select
                value={aiPlan.generationSettings.audioSetting.bitrate}
                onChange={(event) => updateGenerationSettings((settings) => ({
                  ...settings,
                  audioSetting: { ...settings.audioSetting, bitrate: Number(event.target.value) }
                }))}
              >
                {capabilities.audio.bitrates.map((value) => <option key={value} value={value}>{value / 1000} kbps</option>)}
              </select>
            </label>
            <label>
              声道
              <select
                value={aiPlan.generationSettings.audioSetting.channel}
                onChange={(event) => updateGenerationSettings((settings) => ({
                  ...settings,
                  audioSetting: { ...settings.audioSetting, channel: Number(event.target.value) }
                }))}
              >
                {capabilities.audio.channels.map((value) => (
                  <option key={value} value={value}>{value === 1 ? '单声道' : '双声道'}</option>
                ))}
              </select>
            </label>
            <label>
              字幕粒度
              <select
                value={aiPlan.generationSettings.subtitle.type}
                disabled={!aiPlan.generationSettings.subtitle.enabled}
                onChange={(event) => updateGenerationSettings((settings) => ({
                  ...settings,
                  subtitle: { ...settings.subtitle, type: event.target.value }
                }))}
              >
                {capabilities.subtitleTypes.filter((value) => value !== 'word_streaming').map((value) => (
                  <option key={value} value={value}>{value === 'word' ? '词级' : '句级'}</option>
                ))}
              </select>
            </label>
            <label className="toggle-field">
              <input
                type="checkbox"
                checked={aiPlan.generationSettings.subtitle.enabled}
                onChange={(event) => updateGenerationSettings((settings) => ({
                  ...settings,
                  subtitle: { ...settings.subtitle, enabled: event.target.checked }
                }))}
              />
              生成时间戳字幕
            </label>
            <label className="toggle-field">
              <input
                type="checkbox"
                checked={aiPlan.generationSettings.aigcWatermark}
                onChange={(event) => updateGenerationSettings((settings) => ({
                  ...settings,
                  aigcWatermark: event.target.checked
                }))}
              />
              MiniMax AIGC 音频标识
            </label>
          </div>
          <p className="platform-output-note">正式版本固定使用非流式、MP3、HEX 持久化输出；这些传输参数由平台管理。</p>
        </details>

        <div className="ai-segment-list">
          {aiPlan.segments.map((segment) => {
            const recipe = segment.recipe;
            if (!recipe) return null;
            return (
              <article key={segment.segmentId} className="ai-segment-editor">
                <div className="segment-editor-heading">
                  <label>
                    角色
                    <select
                      value={segment.speakerCode || ''}
                      onChange={(event) => updateAiPlanSegment(segment.segmentId, 'speakerCode', event.target.value)}
                    >
                      {aiPlan.roles.map((role) => <option key={role.code} value={role.code}>{role.label}</option>)}
                    </select>
                  </label>
                  <small>点击台词中的字，标记会插入在该字之后；点击标记可删除。</small>
                </div>

                {renderAnnotatedSegmentText(segment)}

                <div className="annotation-toolbar">
                  <label>
                    停顿秒数
                    <input
                      type="number"
                      min={capabilities.ranges.pause.min}
                      max={capabilities.ranges.pause.max}
                      step={capabilities.ranges.pause.step}
                      value={pauseSecondsBySegment[segment.segmentId] ?? capabilities.ranges.pause.default}
                      onChange={(event) => setPauseSecondsBySegment((current) => ({
                        ...current,
                        [segment.segmentId]: Number(event.target.value)
                      }))}
                    />
                  </label>
                  <button type="button" onClick={() => addSegmentAnnotation(segment, 'pause')}>插入停顿</button>
                  <label>
                    语气词
                    <select
                      value={vocalTagBySegment[segment.segmentId] || capabilities.vocalTags[0]?.value}
                      onChange={(event) => setVocalTagBySegment((current) => ({
                        ...current,
                        [segment.segmentId]: event.target.value
                      }))}
                    >
                      {capabilities.vocalTags.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
                    </select>
                  </label>
                  <button
                    type="button"
                    disabled={!capabilities.vocalTagModels.includes(aiPlan.generationSettings.model)}
                    title={capabilities.vocalTagModels.includes(aiPlan.generationSettings.model) ? '' : '当前模型不支持语气词标签'}
                    onClick={() => addSegmentAnnotation(segment, 'vocal')}
                  >
                    插入语气词
                  </button>
                </div>

                <div className="ai-segment-fields primary-settings">
                  <label>
                    情绪
                    <select
                      value={recipe.voiceSetting.emotion}
                      onChange={(event) => updateRecipeSection(segment.segmentId, 'voiceSetting', { emotion: event.target.value })}
                    >
                      {capabilities.emotions.map((item) => <option key={item.value || 'auto'} value={item.value}>{item.label}</option>)}
                    </select>
                  </label>
                  <label>
                    语速 {recipe.voiceSetting.speed.toFixed(2)}
                    <input
                      type="range"
                      min={capabilities.ranges.speed.min}
                      max={capabilities.ranges.speed.max}
                      step={capabilities.ranges.speed.step}
                      value={recipe.voiceSetting.speed}
                      onChange={(event) => updateRecipeSection(segment.segmentId, 'voiceSetting', { speed: Number(event.target.value) })}
                    />
                  </label>
                  <label>
                    音量 {recipe.voiceSetting.volume.toFixed(1)}
                    <input
                      type="range"
                      min={capabilities.ranges.volume.min}
                      max={capabilities.ranges.volume.max}
                      step={capabilities.ranges.volume.step}
                      value={recipe.voiceSetting.volume}
                      onChange={(event) => updateRecipeSection(segment.segmentId, 'voiceSetting', { volume: Number(event.target.value) })}
                    />
                  </label>
                  <div className="locked-setting">
                    <span>角色音色与基础音调</span>
                    <strong>平台锁定</strong>
                  </div>
                </div>

                <details className="segment-advanced-settings">
                  <summary>发音与文本选项</summary>
                  <div className="ai-segment-fields">
                    <label className="toggle-field">
                      <input type="checkbox" checked={recipe.voiceSetting.englishNormalization} onChange={(event) => updateRecipeSection(segment.segmentId, 'voiceSetting', { englishNormalization: event.target.checked })} />
                      英文数字规范化
                    </label>
                    <label className="toggle-field">
                      <input type="checkbox" checked={recipe.voiceSetting.latexRead} onChange={(event) => updateRecipeSection(segment.segmentId, 'voiceSetting', { latexRead: event.target.checked })} />
                      朗读 LaTeX
                    </label>
                    <label className="wide">
                      发音修正（每行一项：文字/读法）
                      <textarea
                        rows={2}
                        value={recipe.pronunciation.join('\n')}
                        placeholder={'处理/(chu3)(li3)\nHolmes/(hoʊmz)'}
                        onChange={(event) => updateAiSegmentRecipe(segment.segmentId, (currentRecipe) => ({
                          ...currentRecipe,
                          pronunciation: event.target.value.split(/\r?\n/).map((item) => item.trim()).filter(Boolean)
                        }))}
                      />
                    </label>
                  </div>
                </details>
              </article>
            );
          })}
        </div>
        <div className="ai-composer-actions">
          <button className="ai-secondary-action" type="button" onClick={() => void saveAiDubbingVersion('private')} disabled={voiceSaving}>保存私密</button>
          <button className="ai-primary-action" type="button" onClick={() => void saveAiDubbingVersion('public')} disabled={voiceSaving}>
            {voiceSaving ? '生成中...' : '生成并公开新版本'}
          </button>
        </div>
        <small>角色声线由平台统一锁定。当前单元：{bundle.unit.sourceText.slice(0, 46)}...</small>
      </section>
    );
  }

  function renderVoicePanel() {
    if (!selectedParagraph) {
      return null;
    }

    const key = dubbingBundleKey(selectedParagraph);
    const bundle = dubbingBundles[key];
    const loading = voiceLoadingKey === key;
    const versions = (bundle?.versions || []).filter((version) => {
      if (voicePanelTab === 'ai') return version.kind === 'ai';
      if (voicePanelTab === 'human') return version.kind === 'human';
      if (voicePanelTab === 'mine') return version.ownerUserId === user?.id;
      return true;
    });

    return (
      <div
        className="selection-voice-panel ai-design-panel"
        onPointerDown={(event) => event.stopPropagation()}
        onClick={(event) => event.stopPropagation()}
      >
        <header className="ai-design-panel-header">
          <div>
            <span>AI DUBBING DESIGN</span>
            <strong>我来设计 AI 配音</strong>
            <p>按句调整表演方式，角色音色始终保持不变。</p>
          </div>
          <button type="button" className="ai-design-close" onClick={closeAiDesignMenu} aria-label="关闭 AI 配音设计">
            ×
          </button>
        </header>

        {loading ? (
          <div className="ai-design-loading">
            <span aria-hidden="true" />
            <p>正在准备这段台词...</p>
          </div>
        ) : !bundle ? (
          <p className="voice-panel-empty">暂时无法读取这个段落的配音。</p>
        ) : (
          <div className="ai-design-panel-body">
            <div className="ai-design-source">
              <span>当前段落</span>
              <p>{bundle.unit.sourceText}</p>
            </div>

            {renderAiComposer(bundle)}

            <details className="ai-design-library">
              <summary>
                <div>
                  <strong>已有配音版本</strong>
                  <small>{bundle.versions.length} 个社区版本</small>
                </div>
                <span>查看</span>
              </summary>
              <div className="ai-design-library-content">
                <div className="voice-panel-tabs">
                  {([['all', '全部'], ['ai', 'AI 配音'], ['human', '真人配音'], ['mine', '我的作品']] as const).map(([value, label]) => (
                    <button key={value} type="button" className={voicePanelTab === value ? 'active' : ''} onClick={() => setVoicePanelTab(value)}>{label}</button>
                  ))}
                </div>
                <div className="voice-panel-section">
                  {platformParagraphAudios[rangeKey(bundle.unit.chapterId, bundle.unit.range)] && (
                    <article className={`voice-recording-row dubbing-version-card${bundle.versions.some((version) => version.adoptedByMe) ? '' : ' adopted'}`}>
                      <div className="dubbing-version-summary">
                        <strong>平台默认配音</strong>
                        <small>{bundle.versions.some((version) => version.adoptedByMe) ? '可恢复' : '当前使用'}</small>
                        <span>平台统一选角与表演导演</span>
                      </div>
                      <div className="voice-recording-actions">
                        <button
                          type="button"
                          onClick={() =>
                            toggleParagraphAudio(
                              `platform-${bundle.unit.id}`,
                              platformParagraphAudios[rangeKey(bundle.unit.chapterId, bundle.unit.range)].audioUrl
                            )
                          }
                        >
                          播放
                        </button>
                        {bundle.versions.some((version) => version.adoptedByMe) && (
                          <button type="button" onClick={() => void cancelDubbingAdoption(bundle.unit)}>
                            恢复平台默认
                          </button>
                        )}
                      </div>
                    </article>
                  )}
                  {versions.length ? (
                    versions.map((version) => renderDubbingVersionCard(version, bundle.unit))
                  ) : (
                    <p className="voice-panel-empty">这个分类下还没有配音版本。</p>
                  )}
                </div>
              </div>
            </details>
          </div>
        )}
      </div>
    );
  }

  function renderParagraphWithMedia(paragraph: TextSegment[], paragraphIndex: number) {
    type ParagraphInjection =
      | { kind: 'audio'; offset: number; key: string; audio: RangeMedia<ParagraphSpeech> }
      | { kind: 'image'; offset: number; key: string; image: RangeMedia<ParagraphImage> };

    const injections: ParagraphInjection[] = [];

    Object.entries(paragraphAudios).forEach(([key, entry]) => {
      if (entry.chapterId === chapter.id && entry.range.startParagraphIndex === paragraphIndex) {
        injections.push({ kind: 'audio', offset: entry.range.startOffset, key, audio: entry });
      }
    });

    Object.entries(paragraphImages).forEach(([key, entry]) => {
      if (entry.chapterId === chapter.id && entry.range.endParagraphIndex === paragraphIndex) {
        injections.push({ kind: 'image', offset: entry.range.endOffset, key, image: entry });
      }
    });

    injections.sort((left, right) => {
      if (left.offset !== right.offset) {
        return left.offset - right.offset;
      }
      return left.kind === 'audio' ? -1 : 1;
    });

    const nodes: React.ReactNode[] = [];
    let position = 0;
    const paragraphLength = paragraphToText(paragraph).length;

    injections.forEach((injection) => {
      nodes.push(...renderTextRange(paragraph, position, injection.offset));

      if (injection.kind === 'audio') {
        nodes.push(renderInlinePlayButton(injection.key, injection.audio));
        position = injection.offset;
        return;
      }

      nodes.push(
        <span
          key={`image-${injection.key}`}
          className={`inline-image-frame${injection.image.fromLibrary ? ' library-media' : ''}`}
        >
          <span className="inline-image-actions">
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                hideParagraphImage(injection.key);
              }}
            >
              收起
            </button>
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                void deleteParagraphImage(injection.key, injection.image);
              }}
            >
              删除
            </button>
          </span>
          <img
            className="inline-selection-image"
            src={injection.image.imageUrl}
            alt=""
            title={injection.image.fromLibrary ? `Media library: ${injection.image.userId || 'unknown'}` : undefined}
          />
        </span>
      );
      position = injection.offset;
    });

    nodes.push(...renderTextRange(paragraph, position, paragraphLength));
    return nodes;
  }

  if (!chapter) {
    return <main className="loading">正在加载阅读桌...</main>;
  }

  const currentRangeKey = selectedParagraph
    ? rangeKey(selectedParagraph.chapterId, selectedParagraph.range)
    : null;
  const imageGenerating = Boolean(currentRangeKey && paragraphImageLoadingKey === currentRangeKey);
  const oneClickSpeechGenerating = Boolean(
    currentRangeKey && paragraphSpeechLoadingKey === currentRangeKey
  );
  const speechGenerating = oneClickSpeechGenerating || aiPlanning || voiceSaving;

  return (
    <section className="app-shell">
      <aside className="sidebar">
        <button className="shelf-back" onClick={() => setPage('bookshelf')} type="button">
          <span>←</span>
          <strong>返回书架</strong>
        </button>

        <section className="panel">
          <div className="toc-header">
            <span>当前作品</span>
            <h2>《斑点带子案》</h2>
            <p>{chapter.progress}% 已读</p>
            <div className="progress">
              <span style={{ width: `${chapter.progress}%` }} />
            </div>
          </div>
          <div className="chapter-list">
            {chapters.map((item, index) => {
              const readState =
                item.id === chapter.id ? 'current' : item.progress < chapter.progress ? 'read' : 'unread';

              return (
                <button
                  key={item.id}
                  className={`chapter ${readState}`}
                  onClick={() => setChapterId(item.id)}
                >
                  <span className="chapter-index">{String(index + 1).padStart(2, '0')}</span>
                  <span className="chapter-text">
                    <strong>{item.title}</strong>
                    <small>{item.subtitle}</small>
                  </span>
                </button>
              );
            })}
          </div>
        </section>
      </aside>

      <section className={`reader theme-${readingTheme} width-${readingWidth}`}>
        <div className="reader-toolbar">
          <div>
            <p className="eyebrow">福尔摩斯探案集</p>
            <h2>{chapter.title}</h2>
            <div className="reader-meta">
              <span>{chapter.subtitle}</span>
              <span>{chapter.paragraphs.length} 段</span>
              <span>{collectedClues.length} 件证物</span>
            </div>
          </div>
          <div className="toolbar-actions">
            <button
              className={settingsOpen ? 'settings-trigger active' : 'settings-trigger'}
              onClick={() => setSettingsOpen((open) => !open)}
            >
              阅读设置
            </button>
            <button onClick={stopParagraphAudio}>停止语音</button>
          </div>
        </div>

        {settingsOpen && (
          <div className="reading-settings" aria-label="阅读设置">
            <div className="setting-group">
              <span>版心</span>
              <div className="segmented-control">
                {[
                  ['narrow', '窄'],
                  ['standard', '标准'],
                  ['wide', '宽']
                ].map(([value, label]) => (
                  <button
                    key={value}
                    type="button"
                    className={readingWidth === value ? 'active' : ''}
                    onClick={() => setReadingWidth(value as ReadingWidth)}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
            <div className="setting-group">
              <span>主题</span>
              <div className="segmented-control">
                {[
                  ['light', '浅色'],
                  ['paper', '纸张'],
                  ['night', '夜间']
                ].map(([value, label]) => (
                  <button
                    key={value}
                    type="button"
                    className={readingTheme === value ? 'active' : ''}
                    onClick={() => setReadingTheme(value as ReadingTheme)}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
            <div className="setting-group">
              <span>字号</span>
              <div className="stepper-control">
                <button type="button" onClick={() => setFontSize((size) => Math.max(16, size - 1))}>
                  -
                </button>
                <strong>{fontSize}</strong>
                <button type="button" onClick={() => setFontSize((size) => Math.min(24, size + 1))}>
                  +
                </button>
              </div>
            </div>
          </div>
        )}

        <div className="reader-progress-strip" aria-hidden="true">
          <span style={{ width: `${chapter.progress}%` }} />
        </div>

        <article
          key={chapter.id}
          ref={bookPageRef}
          className={selectedParagraph ? 'book-page selecting' : 'book-page'}
          style={{ '--reader-font-size': `${fontSize}px` } as React.CSSProperties}
        >
          {chapter.paragraphs.map((paragraph, paragraphIndex) => {
            const key = paragraphKey(paragraphIndex);
            const comments = paragraphComments.filter((comment) => comment.paragraphIndex === paragraphIndex);
            const commentsOpen = activeCommentParagraph === paragraphIndex;

            return (
              <div className="reader-paragraph-block" key={key}>
              <p
                className="reader-paragraph"
                data-paragraph-index={paragraphIndex}
                onContextMenu={(event) => handleParagraphContextMenu(event, paragraph, paragraphIndex)}
                onPointerDown={(event) => handleParagraphPointerDown(event, paragraph, paragraphIndex)}
                onPointerUp={clearLongPressTimer}
                onPointerCancel={clearLongPressTimer}
                onPointerLeave={clearLongPressTimer}
                title="长按或右键选取段落，拖动两端符号调整范围"
              >
                {renderParagraphWithMedia(paragraph, paragraphIndex)}
              </p>
              <button
                type="button"
                className={commentsOpen ? 'paragraph-comment-trigger active' : 'paragraph-comment-trigger'}
                onClick={() => {
                  setActiveCommentParagraph(commentsOpen ? null : paragraphIndex);
                  setCommentDraft('');
                  setCommentError('');
                }}
                aria-expanded={commentsOpen}
              >
                评论{comments.length ? ` ${comments.length}` : ''}
              </button>
              {commentsOpen && (
                <section className="paragraph-comments" aria-label={`第 ${paragraphIndex + 1} 段评论`}>
                  {commentsLoading && <p className="comment-status">正在加载评论…</p>}
                  {!commentsLoading && comments.length === 0 && (
                    <p className="comment-status">还没有评论，来留下第一条想法吧。</p>
                  )}
                  {comments.map((comment) => (
                    <article className="paragraph-comment" key={comment.id}>
                      <div>
                        <strong>{comment.displayName || comment.username}</strong>
                        <span className="paragraph-comment-meta">
                          <time dateTime={comment.createdAt}>{new Date(comment.createdAt).toLocaleString('zh-CN')}</time>
                          {user?.id === comment.userId && (
                            <button
                              type="button"
                              className="comment-delete"
                              disabled={deletingCommentId === comment.id}
                              onClick={() => removeParagraphComment(comment)}
                            >
                              {deletingCommentId === comment.id ? '删除中…' : '删除'}
                            </button>
                          )}
                        </span>
                      </div>
                      <p>{comment.content}</p>
                    </article>
                  ))}
                  {user ? (
                    <form
                      className="paragraph-comment-form"
                      onSubmit={(event) => { event.preventDefault(); submitParagraphComment(paragraphIndex); }}
                    >
                      <textarea
                        value={commentDraft}
                        onChange={(event) => setCommentDraft(event.target.value)}
                        maxLength={1000}
                        rows={3}
                        placeholder="写下你对这一段的看法…"
                      />
                      <div>
                        <span>{commentDraft.trim().length}/1000</span>
                        <button type="submit" disabled={commentSaving || !commentDraft.trim()}>
                          {commentSaving ? '发布中…' : '发布评论'}
                        </button>
                      </div>
                    </form>
                  ) : (
                    <button type="button" className="comment-login" onClick={() => setPage('login')}>
                      登录后参与评论
                    </button>
                  )}
                  {commentError && <p className="comment-error">{commentError}</p>}
                </section>
              )}
              </div>
            );
          })}

          {selectedParagraph && selectionLayout && (
            <div className="text-selection-layer" aria-hidden="true">
              {selectionLayout.rects.map((rect, index) => (
                <span
                  key={`${rect.top}-${rect.left}-${index}`}
                  className="selection-highlight"
                  style={{
                    top: `${rect.top}px`,
                    left: `${rect.left}px`,
                    width: `${rect.width}px`,
                    height: `${rect.height}px`
                  }}
                />
              ))}
              <button
                type="button"
                className="selection-handle selection-handle-start"
                style={{
                  top: `${selectionLayout.startHandle.y}px`,
                  left: `${selectionLayout.startHandle.x}px`,
                  height: `${selectionLayout.startHandle.height}px`
                }}
                onPointerDown={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  event.currentTarget.setPointerCapture(event.pointerId);
                  setDraggingHandle('start');
                }}
                aria-label="拖动调整选取起点"
              />
              <button
                type="button"
                className="selection-handle selection-handle-end"
                style={{
                  top: `${selectionLayout.endHandle.y}px`,
                  left: `${selectionLayout.endHandle.x}px`,
                  height: `${selectionLayout.endHandle.height}px`
                }}
                onPointerDown={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  event.currentTarget.setPointerCapture(event.pointerId);
                  setDraggingHandle('end');
                }}
                aria-label="拖动调整选取终点"
              />
              {!draggingHandle && (
                <div
                  className="selection-toolbar"
                  style={{
                    top: `${selectionLayout.toolbar.top}px`,
                    left: `${selectionLayout.toolbar.left}px`,
                    width: `${selectionLayout.toolbar.width}px`
                  }}
                >
                  <button
                    type="button"
                    onClick={generateParagraphImage}
                    disabled={imageGenerating || speechGenerating}
                  >
                    {imageGenerating ? '生成中...' : '生成插图'}
                  </button>
                  <button
                    type="button"
                    onClick={generateParagraphSpeech}
                    disabled={imageGenerating || speechGenerating}
                  >
                    {oneClickSpeechGenerating ? '生成中...' : '一键生成 AI 配音'}
                  </button>
                  <button
                    type="button"
                    className="selection-menu-button"
                    onClick={openHumanDubbingPlaceholder}
                    disabled={imageGenerating || speechGenerating}
                  >
                    <span>我来配音</span>
                    <span className="selection-menu-chevron" aria-hidden="true">›</span>
                  </button>
                  <button
                    type="button"
                    className={voicePanelOpen ? 'selection-menu-button active' : 'selection-menu-button'}
                    aria-expanded={voicePanelOpen}
                    onClick={() => {
                      if (voicePanelOpen) {
                        closeAiDesignMenu();
                        return;
                      }
                      void startAiDubbingCreation();
                    }}
                    disabled={imageGenerating || speechGenerating}
                  >
                    <span>我来设计 AI 配音</span>
                    <span className="selection-menu-chevron" aria-hidden="true">›</span>
                  </button>
                  {voicePanelOpen && renderVoicePanel()}
                </div>
              )}
            </div>
          )}
        </article>

        <footer className="page-turner">
          <button
            type="button"
            disabled={!previousChapter}
            onClick={() => previousChapter && setChapterId(previousChapter.id)}
          >
            上一章
            <span>{previousChapter?.subtitle ?? '已经是开头'}</span>
          </button>
          <button
            type="button"
            disabled={!nextChapter}
            onClick={() => nextChapter && setChapterId(nextChapter.id)}
          >
            下一章
            <span>{nextChapter?.subtitle ?? '已经是结尾'}</span>
          </button>
        </footer>
      </section>

      <aside className={contextOpen ? 'right-rail open' : 'right-rail'} aria-label="阅读辅助浮窗">
        <div className="context-tabs" role="tablist" aria-label="阅读辅助">
          <button
            type="button"
            role="tab"
            className={contextOpen && contextTab === 'scene' ? 'active' : ''}
            aria-expanded={contextOpen && contextTab === 'scene'}
            onClick={() => toggleContextPanel('scene')}
          >
            现场
          </button>
          <button
            type="button"
            role="tab"
            className={contextOpen && contextTab === 'ai' ? 'active' : ''}
            aria-expanded={contextOpen && contextTab === 'ai'}
            onClick={() => toggleContextPanel('ai')}
          >
            助手
          </button>          <button
            type="button"
            role="tab"
            className={`${contextOpen && contextTab === 'bag' ? 'active' : ''}${bagPulse ? ' pulse' : ''}`}
            aria-expanded={contextOpen && contextTab === 'bag'}
            onClick={() => toggleContextPanel('bag')}
          >
            证物袋
            <span>{collectedClues.length}</span>
          </button>
        </div>

        {contextOpen && (
          <div className="context-popover">
            <div className="context-popover-header">
              <strong>{contextTab === 'scene' ? '现场' : contextTab === 'ai' ? '助手' : '证物袋'}</strong>
              <button type="button" onClick={() => setContextOpen(false)} aria-label="关闭阅读辅助浮窗">
                关闭
              </button>
            </div>

            {contextTab === 'scene' && (
          <section className="scene-card context-card">
            <div className="context-heading">
              <h2>现场图</h2>
              <span>{sceneGenerated ? '已生成' : '按需生成'}</span>
            </div>

            {!sceneGenerated ? (
              <div className="scene-generator-empty">
                <p>根据当前章节生成一张帮助理解空间关系的现场示意图。</p>
                <button type="button" onClick={generateSceneImage} disabled={sceneLoading}>
                  {sceneLoading ? '生成中...' : '生成场景图'}
                </button>
              </div>
            ) : (
              <>
                <div className="scene-mode-tabs">
                  {[
                    ['layout', '房间布局'],
                    ['positions', '人物站位'],
                    ['clues', '证物位置']
                  ].map(([value, label]) => (
                    <button
                      key={value}
                      type="button"
                      className={sceneDiagram === value ? 'active' : ''}
                      onClick={() => setSceneDiagram(value as SceneDiagram)}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                {generatedSceneImage ? (
                  <div className="scene-ai-image">
                    <img src={generatedSceneImage.imageUrl} alt={chapter.scene.title} />
                  </div>
                ) : (
                  <div
                    className={`scene-visual ${sceneVariant} diagram-${sceneDiagram}`}
                    aria-label={chapter.scene.title}
                  >
                    <div className="scene-sky" />
                    <div className="scene-window">
                      <span />
                      <span />
                    </div>
                    <div className="scene-floor" />
                    <div className="scene-bed" />
                    <div className="scene-desk" />
                    <div className="scene-fireplace" />
                    <div className="scene-vent" />
                    <div className="scene-rope" />
                    <div className="scene-match" />
                    <div className="scene-figure figure-one" />
                    <div className="scene-figure figure-two" />
                    <div className="scene-clue clue-one">1</div>
                    <div className="scene-clue clue-two">2</div>
                    <div className="scene-caption">
                      <strong>{chapter.scene.title}</strong>
                      <span>
                        {sceneVariant === 'manor' ? '现场结构' : sceneVariant === 'night' ? '夜间守候' : '清晨会面'}
                      </span>
                    </div>
                  </div>
                )}
                <div className="scene-prompt">
                  <span>Prompt</span>
                  <p>{generatedSceneImage?.prompt || chapter.scene.imagePrompt}</p>
                  <button type="button" onClick={generateSceneImage} disabled={sceneLoading}>
                    重新生成
                  </button>
                </div>
              </>
            )}
            <div className="diagram-legend">
              <span>1 空间结构</span>
              <span>2 可疑物件</span>
              <span>3 行动路径</span>
            </div>
            <h2>{chapter.scene.title}</h2>
            <p>{chapter.scene.imagePrompt}</p>
            <dl className="scene-notes">
              <div>
                <dt>氛围</dt>
                <dd>{chapter.scene.mood}</dd>
              </div>
              <div>
                <dt>环境音</dt>
                <dd>{chapter.scene.soundscape}</dd>
              </div>
            </dl>
          </section>
        )}

            {contextTab === 'ai' && (
          <section className="chat-card context-card">
            <div className="context-heading">
              <h2>案情助手</h2>
              <span>不剧透</span>
            </div>
            <div className="messages">
              {messages.map((message, index) => (
                <p key={index} className={message.role}>
                  {message.content}
                </p>
              ))}
            </div>
            <div className="chat-input">
              <input
                value={question}
                onChange={(event) => setQuestion(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') askAssistant();
                }}
                placeholder="问一个关于当前案情的问题"
              />
              <button onClick={askAssistant}>发送</button>
            </div>
          </section>
        )}

            {contextTab === 'bag' && (
              <section className="bag-card context-card">
                <div className="context-heading">
                  <h2>证物袋</h2>
                  <span>{collectedClues.length} 件</span>
                </div>

                {collectedClues.length === 0 ? (
                  <p className="empty-bag">还没有证物。阅读正文时点击可疑细节即可收入证物袋。</p>
                ) : (
                  <div className="clue-board-list">
                    {collectedClues.map(({ clue, record }) => {
                      const image = clueImages[clueImageKey(clue.id)];
                      return (
                        <article
                          key={clue.id}
                          className={activeClueId === clue.id ? 'clue-card active' : 'clue-card'}
                        >
                          <div className="clue-card-header">
                            <span>{clue.type}</span>
                            <div className="clue-card-actions">
                              <button
                                type="button"
                                onClick={() => regenerateClue(clue.id, record.occurrenceId)}
                                disabled={image?.loading || !record.occurrenceId}
                              >
                                {image?.loading ? '生成中' : '重新生成'}
                              </button>
                              <button type="button" onClick={() => removeClue(clue.id)}>
                                取出
                              </button>
                            </div>
                          </div>

                          <div className="clue-image-stage">
                            {!record.occurrenceId ? (
                              <div className="clue-image-placeholder error">
                                线索服务版本未更新，请稍后刷新页面
                              </div>
                            ) : image?.loading ? (
                              <div className="clue-image-placeholder loading">正在规划画面...</div>
                            ) : image?.imageUrl ? (
                              <img className="clue-card-image" src={image.imageUrl} alt={clue.label} />
                            ) : image?.skipped ? (
                              <div className="clue-image-placeholder">{image.reason || '这条线索不适合图像化'}</div>
                            ) : image?.error ? (
                              <div className="clue-image-placeholder error">{image.error}</div>
                            ) : (
                              <div className="clue-image-placeholder">等待生成</div>
                            )}
                          </div>
                          <h3>{clue.label}</h3>
                          <p>{clue.surfaceDescription}</p>
                        </article>
                      );
                    })}
                  </div>
                )}
              </section>
            )}          </div>
        )}
      </aside>
      {notice && <div className="toast">{notice}</div>}
    </section>
  );
}

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
