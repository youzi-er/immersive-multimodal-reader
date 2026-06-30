import React, { useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';

type Page = 'home' | 'reader' | 'login' | 'register' | 'profile';

type User = {
  id: string;
  username: string;
  displayName: string;
  bio: string;
};

type VoiceConfig = {
  pitch: number;
  rate: number;
};

type TextSegment =
  | {
      type: 'narration';
      text: string;
    }
  | {
      type: 'dialogue';
      speaker: string;
      text: string;
      voice: VoiceConfig;
    }
  | {
      type: 'clue';
      clueId: string;
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
  type: '线索' | '人物' | '地点';
  description: string;
};

type ChatMessage = {
  role: 'reader' | 'assistant';
  content: string;
};

type GeneratedSceneImage = {
  imageUrl: string;
  prompt: string;
};

type ActiveDialogue = {
  id: string;
  speaker: string;
  text: string;
  voice: VoiceConfig;
};

type ContextTab = 'scene' | 'clues' | 'ai';
type ReadingTheme = 'light' | 'paper' | 'night';
type ReadingWidth = 'narrow' | 'standard' | 'wide';
type SceneDiagram = 'layout' | 'positions' | 'clues';

const TOKEN_KEY = 'immersive-reader-token';
const USER_KEY = 'immersive-reader-user';
const COLLECTED_CLUES_KEY = 'immersive-reader-collected-clues';

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
  const data = await res.json();

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
  const [collectedClueIds, setCollectedClueIds] = useState<string[]>(() => {
    const saved = window.localStorage.getItem(COLLECTED_CLUES_KEY);
    return saved ? JSON.parse(saved) : [];
  });
  const [chapterId, setChapterId] = useState('speckled-band-1');
  const [bagOpen, setBagOpen] = useState(false);
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
    api.clues().then(setClues);
  }, []);

  useEffect(() => {
    window.localStorage.setItem(COLLECTED_CLUES_KEY, JSON.stringify(collectedClueIds));
  }, [collectedClueIds]);

  function saveSession(token: string, nextUser: User) {
    window.localStorage.setItem(TOKEN_KEY, token);
    window.localStorage.setItem(USER_KEY, JSON.stringify(nextUser));
    setUser(nextUser);
    setPage('reader');
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
    setPage('home');
  }

  return (
    <main>
      <TopNav page={page} user={user} setPage={setPage} logout={logout} />

      {page === 'home' && <HomePage user={user} setPage={setPage} />}
      {page === 'login' && <AuthPage mode="login" saveSession={saveSession} setPage={setPage} />}
      {page === 'register' && <AuthPage mode="register" saveSession={saveSession} setPage={setPage} />}
      {page === 'profile' && (
        <ProfilePage user={user} setPage={setPage} collectedClueIds={collectedClueIds} clues={clues} />
      )}
      {page === 'reader' && (
        <ReaderPage
          user={user}
          chapters={chapters}
          clues={clues}
          collectedClueIds={collectedClueIds}
          setCollectedClueIds={setCollectedClueIds}
          chapterId={chapterId}
          setChapterId={setChapterId}
          bagOpen={bagOpen}
          setBagOpen={setBagOpen}
          notice={notice}
          setNotice={setNotice}
          question={question}
          setQuestion={setQuestion}
          messages={messages}
          setMessages={setMessages}
          setPage={setPage}
        />
      )}
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
        <button className={page === 'reader' ? 'active' : ''} onClick={() => setPage('reader')}>
          阅读桌
        </button>
        {user ? (
          <>
            <button className={page === 'profile' ? 'active' : ''} onClick={() => setPage('profile')}>
              阅读档案
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
            <button onClick={() => setPage('reader')}>继续阅读</button>
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
  collectedClueIds,
  clues
}: {
  user: User | null;
  setPage: (page: Page) => void;
  collectedClueIds: string[];
  clues: Clue[];
}) {
  const collectedClues = clues.filter((clue) => collectedClueIds.includes(clue.id));

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
          <span>{collectedClues.length}</span>
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
        {collectedClues.length === 0 ? (
          <p>还没有收集证物。进入阅读桌，点击正文中的可疑细节即可加入证物袋。</p>
        ) : (
          <div className="profile-clues">
            {collectedClues.map((clue) => (
              <article key={clue.id} className="clue-card">
                <span>{clue.type}</span>
                <h3>{clue.label}</h3>
                <p>{clue.description}</p>
              </article>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

function ReaderPage({
  user,
  chapters,
  clues,
  collectedClueIds,
  setCollectedClueIds,
  chapterId,
  setChapterId,
  bagOpen,
  setBagOpen,
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
  collectedClueIds: string[];
  setCollectedClueIds: React.Dispatch<React.SetStateAction<string[]>>;
  chapterId: string;
  setChapterId: (id: string) => void;
  bagOpen: boolean;
  setBagOpen: React.Dispatch<React.SetStateAction<boolean>>;
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
  const nextChapter = chapterIndex >= 0 && chapterIndex < chapters.length - 1 ? chapters[chapterIndex + 1] : null;

  const collectedClues = useMemo(
    () => clues.filter((clue) => collectedClueIds.includes(clue.id)),
    [clues, collectedClueIds]
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
  const [activeDialogue, setActiveDialogue] = useState<ActiveDialogue | null>(null);
  const [contextTab, setContextTab] = useState<ContextTab>('scene');
  const [readingTheme, setReadingTheme] = useState<ReadingTheme>('light');
  const [readingWidth, setReadingWidth] = useState<ReadingWidth>('standard');
  const [fontSize, setFontSize] = useState(19);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [sceneGenerated, setSceneGenerated] = useState(false);
  const [sceneLoading, setSceneLoading] = useState(false);
  const [generatedSceneImage, setGeneratedSceneImage] = useState<GeneratedSceneImage | null>(null);
  const [voiceLoadingId, setVoiceLoadingId] = useState<string | null>(null);
  const [sceneDiagram, setSceneDiagram] = useState<SceneDiagram>('layout');
  const [bagPulse, setBagPulse] = useState(false);
  const sceneVariant =
    chapter?.id === 'speckled-band-2' ? 'manor' : chapter?.id === 'speckled-band-3' ? 'night' : 'baker';

  useEffect(() => {
    setActiveDialogue(null);
    setSceneGenerated(false);
    setGeneratedSceneImage(null);
    setSceneDiagram('layout');
    window.speechSynthesis.cancel();
  }, [chapterId]);

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

  async function speakDialogue(dialogueId: string, speaker: string, text: string, voice: VoiceConfig) {
    setVoiceLoadingId(dialogueId);
    try {
      const result = await api.tts({
        speaker,
        text,
        speed: voice.rate,
        pitch: Math.round((voice.pitch - 1) * 4)
      });
      const audio = new Audio(result.audioUrl);
      window.speechSynthesis.cancel();
      await audio.play();
    } catch (error) {
      const utterance = new SpeechSynthesisUtterance(`${speaker}说：${text}`);
      utterance.lang = 'zh-CN';
      utterance.pitch = voice.pitch;
      utterance.rate = voice.rate;
      window.speechSynthesis.cancel();
      window.speechSynthesis.speak(utterance);
      setNotice('MiniMax 配音失败，已使用浏览器语音兜底');
      window.setTimeout(() => setNotice(''), 2200);
    } finally {
      setVoiceLoadingId(null);
    }
  }

  async function generateSceneImage() {
    if (!chapter) return;
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

  function collectClue(clueId: string) {
    const clue = clues.find((item) => item.id === clueId);
    if (!clue) return;

    setCollectedClueIds((prev) => {
      if (prev.includes(clueId)) {
      setNotice(`“${clue.label}”已经在证物袋里`);
        return prev;
      }
      setNotice(`已收入证物袋：“${clue.label}”`);
      setBagOpen(true);
      setBagPulse(true);
      window.setTimeout(() => setBagPulse(false), 620);
      return [...prev, clueId];
    });

    window.setTimeout(() => setNotice(''), 1800);
  }

  function renderSegment(segment: TextSegment, index: number, paragraphIndex: number) {
    if (segment.type === 'dialogue') {
      const dialogueId = `${chapter.id}-${paragraphIndex}-${index}`;
      const selected = activeDialogue?.id === dialogueId;

      return (
        <span key={index} className={selected ? 'dialogue-wrap active' : 'dialogue-wrap'}>
          <button
            className="dialogue-segment"
            onClick={() =>
              setActiveDialogue({
                id: dialogueId,
                speaker: segment.speaker,
                text: segment.text,
                voice: segment.voice
              })
            }
            title="点击显示配音按钮"
            type="button"
          >
            <span className="speaker">{segment.speaker}</span>
            “{segment.text}”
          </button>
          {selected && (
            <span className="voice-popover">
              <button
                type="button"
                onClick={() => speakDialogue(dialogueId, segment.speaker, segment.text, segment.voice)}
                disabled={voiceLoadingId === dialogueId}
              >
                {voiceLoadingId === dialogueId ? '生成中' : '播放'}
              </button>
              <button type="button" className="quiet" onClick={() => setActiveDialogue(null)}>
                收起
              </button>
            </span>
          )}
        </span>
      );
    }

    if (segment.type === 'clue') {
      const collected = collectedClueIds.includes(segment.clueId);
      return (
        <button
          key={index}
          className={collected ? 'clue-segment collected' : 'clue-segment'}
          onClick={() => collectClue(segment.clueId)}
          title="点击收入证物袋"
        >
          {segment.text}
          <span className="clue-hint">{collected ? '已入袋' : '收入证物袋'}</span>
        </button>
      );
    }

    return <span key={index}>{segment.text}</span>;
  }

  if (!chapter) {
    return <main className="loading">正在加载阅读桌...</main>;
  }

  return (
    <section className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-mark">🔎</span>
          <div>
            <h1>CaseReader</h1>
            <p>{user ? `${user.displayName} 的案件档案` : '游客模式'}</p>
          </div>
        </div>

        {!user && (
          <section className="panel compact">
            <h2>游客提示</h2>
            <p>注册或登录后，可在个人中心查看你的阅读档案。</p>
            <button className="panel-action" onClick={() => setPage('login')}>
              去登录
            </button>
          </section>
        )}

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
            <button onClick={() => window.speechSynthesis.cancel()}>停止语音</button>
            <button onClick={() => setBagOpen(true)}>证物袋</button>
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
          className="book-page"
          style={{ '--reader-font-size': `${fontSize}px` } as React.CSSProperties}
        >
          {chapter.paragraphs.map((paragraph, paragraphIndex) => (
            <p key={paragraphIndex}>
              {paragraph.map((segment, segmentIndex) =>
                renderSegment(segment, segmentIndex, paragraphIndex)
              )}
            </p>
          ))}
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

      <aside className="right-rail">
        <div className="context-tabs" role="tablist" aria-label="阅读辅助">
          <button
            type="button"
            role="tab"
            className={contextTab === 'scene' ? 'active' : ''}
            onClick={() => setContextTab('scene')}
          >
            现场
          </button>
          <button
            type="button"
            role="tab"
            className={contextTab === 'clues' ? 'active' : ''}
            onClick={() => setContextTab('clues')}
          >
            证物
          </button>
          <button
            type="button"
            role="tab"
            className={contextTab === 'ai' ? 'active' : ''}
            onClick={() => setContextTab('ai')}
          >
            助手
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
                  <div className={`scene-visual ${sceneVariant} diagram-${sceneDiagram}`} aria-label={chapter.scene.title}>
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

        {contextTab === 'clues' && (
          <section className="clue-board context-card">
            <div className="context-heading">
                  <h2>本章证物</h2>
              <span>{chapterClues.length} 项</span>
            </div>
            <div className="clue-board-list">
              {chapterClues.length === 0 ? (
                <p className="empty-bag">这一章暂时没有可收入证物袋的细节。</p>
              ) : (
                chapterClues.map((clue) => (
                  <article
                    key={clue.id}
                    className={collectedClueIds.includes(clue.id) ? 'clue-card collected' : 'clue-card'}
                  >
                    <span>{clue.type}</span>
                    <h3>{clue.label}</h3>
                    <p>{clue.description}</p>
                  </article>
                ))
              )}
            </div>
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
      </aside>

      {notice && <div className="toast">{notice}</div>}

      <button className={bagPulse ? 'floating-bag pulse' : 'floating-bag'} onClick={() => setBagOpen((open) => !open)}>
        <span className="bag-icon">EV</span>
        <span>{collectedClues.length} 件</span>
      </button>

      {bagOpen && (
        <div className="bag-panel">
          <div className="bag-header">
            <h2>证物袋</h2>
            <button onClick={() => setBagOpen(false)}>关闭</button>
          </div>

          {collectedClues.length === 0 ? (
            <p className="empty-bag">还没有证物。阅读正文时点击可疑细节即可收入证物袋。</p>
          ) : (
            collectedClues.map((clue) => (
              <article key={clue.id} className="clue-card">
                <span>{clue.type}</span>
                <h3>{clue.label}</h3>
                <p>{clue.description}</p>
              </article>
            ))
          )}
        </div>
      )}
    </section>
  );
}

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
