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
  mediaAssets: (articleId: string, chapterId: string) =>
    requestJson<{ assets: MediaLibraryAsset[] }>(
      `/api/media/assets?articleId=${encodeURIComponent(articleId)}&chapterId=${encodeURIComponent(chapterId)}`
    ),
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
          目前是原型账号系统，数据暂存在后端内存里；正式部署前再接数据库。
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
  const [paragraphSpeechLoadingKey, setParagraphSpeechLoadingKey] = useState<string | null>(null);
  const [paragraphImages, setParagraphImages] = useState<Record<string, RangeMedia<ParagraphImage>>>({});
  const toggleContextPanel = useCallback(
    (tab: ContextTab) => {
      setContextOpen((open) => (open && contextTab === tab ? false : true));
      setContextTab(tab);
    },
    [contextTab]
  );
  const [paragraphAudios, setParagraphAudios] = useState<Record<string, RangeMedia<ParagraphSpeech>>>({});
  const [playingAudioKey, setPlayingAudioKey] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const longPressTimer = useRef<number | null>(null);
  const sceneVariant =
    chapter?.id === 'speckled-band-2' ? 'manor' : chapter?.id === 'speckled-band-3' ? 'night' : 'baker';

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

    api
      .mediaAssets('speckled-band', chapter.id)
      .then(({ assets }) => {
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

        setParagraphImages(nextImages);
        setParagraphAudios(nextAudios);
        if (nextSceneImage) {
          setGeneratedSceneImage(nextSceneImage);
          setSceneGenerated(true);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setParagraphImages({});
          setParagraphAudios({});
        }
      });

    return () => {
      cancelled = true;
    };
  }, [chapter?.id]);

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
    };
  }, []);

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
    setNotice('正在生成段落配音，首次使用会先初始化全书音色，可能较慢');
    try {
      const result = await api.paragraphSpeech({
        chapterId: savedChapterId,
        paragraphIndex: savedParagraphIndex,
        targetSegment,
        range: savedRange
      });
      setParagraphAudios((prev) => ({
        ...prev,
        [key]: { ...result, chapterId: savedChapterId, range: savedRange, fromLibrary: false }
      }));
      setSelectedParagraph(null);
      setNotice('段落配音已生成');
      window.setTimeout(() => setNotice(''), 1800);
      playParagraphAudio(key, result.audioUrl);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : '段落配音生成失败');
      window.setTimeout(() => setNotice(''), 2600);
    } finally {
      setParagraphSpeechLoadingKey(null);
    }
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
  const speechGenerating = Boolean(currentRangeKey && paragraphSpeechLoadingKey === currentRangeKey);

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

            return (
              <p
                key={key}
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
                    {speechGenerating ? '生成中...' : '生成配音'}
                  </button>
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
