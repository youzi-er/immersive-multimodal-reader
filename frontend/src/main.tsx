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
  chat: async (question: string, chapterId: string) => {
    const data = await requestJson<{ answer: string }>('/api/chat', {
      method: 'POST',
      body: JSON.stringify({ question, chapterId })
    });
    return data.answer;
  },
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
      content: '我是你的探案阅读助手。你可以问我：目前有哪些线索？谁最可疑？这一段发生在哪里？'
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
        <span>🔎</span>
        <strong>探案沉浸阅读器</strong>
      </button>
      <nav>
        <button className={page === 'home' ? 'active' : ''} onClick={() => setPage('home')}>
          首页
        </button>
        <button className={page === 'reader' ? 'active' : ''} onClick={() => setPage('reader')}>
          阅读器
        </button>
        {user ? (
          <>
            <button className={page === 'profile' ? 'active' : ''} onClick={() => setPage('profile')}>
              个人中心
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
      <div className="hero-card">
        <p className="eyebrow">Holmes Case Lab</p>
        <h1>把探案小说变成可听、可看、可收集线索的沉浸式阅读体验</h1>
        <p>
          当前原型以《福尔摩斯探案集》为研究目标，支持角色对话配音、场景画面提示、AI
          案情问答和侦探背包。
        </p>
        <div className="hero-actions">
          <button onClick={() => setPage('reader')}>进入阅读器</button>
          <button className="secondary" onClick={() => setPage(user ? 'profile' : 'register')}>
            {user ? '查看个人中心' : '创建账号'}
          </button>
        </div>
      </div>

      <div className="feature-grid">
        <article>
          <span>01</span>
          <h2>角色配音</h2>
          <p>点击正文中的角色对话，为不同人物播放不同语气的语音。</p>
        </article>
        <article>
          <span>02</span>
          <h2>线索背包</h2>
          <p>阅读时点击黄色线索，将它们收集到侦探背包中。</p>
        </article>
        <article>
          <span>03</span>
          <h2>案情问答</h2>
          <p>围绕当前章节提问，后续可以接入大模型进行真实推理回答。</p>
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
          <p>登录后可以查看你的阅读进度、收集线索和个人信息。</p>
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
          <p>已收集线索</p>
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
        <h2>我的线索</h2>
        {collectedClues.length === 0 ? (
          <p>还没有收集线索。进入阅读器，点击黄色线索即可加入背包。</p>
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

  const collectedClues = useMemo(
    () => clues.filter((clue) => collectedClueIds.includes(clue.id)),
    [clues, collectedClueIds]
  );

  async function askAssistant() {
    if (!question.trim() || !chapter) return;
    const currentQuestion = question.trim();
    setQuestion('');
    setMessages((prev) => [...prev, { role: 'reader', content: currentQuestion }]);
    const answer = await api.chat(currentQuestion, chapter.id);
    setMessages((prev) => [...prev, { role: 'assistant', content: answer }]);
  }

  function speakDialogue(speaker: string, text: string, voice: VoiceConfig) {
    const utterance = new SpeechSynthesisUtterance(`${speaker}说：${text}`);
    utterance.lang = 'zh-CN';
    utterance.pitch = voice.pitch;
    utterance.rate = voice.rate;
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(utterance);
  }

  function collectClue(clueId: string) {
    const clue = clues.find((item) => item.id === clueId);
    if (!clue) return;

    setCollectedClueIds((prev) => {
      if (prev.includes(clueId)) {
        setNotice(`“${clue.label}”已经在背包里`);
        return prev;
      }
      setNotice(`已收集线索：“${clue.label}”`);
      setBagOpen(true);
      return [...prev, clueId];
    });

    window.setTimeout(() => setNotice(''), 1800);
  }

  function renderSegment(segment: TextSegment, index: number) {
    if (segment.type === 'dialogue') {
      return (
        <button
          key={index}
          className="dialogue-segment"
          onClick={() => speakDialogue(segment.speaker, segment.text, segment.voice)}
          title="点击为这个角色配音"
        >
          <span className="speaker">{segment.speaker}</span>
          “{segment.text}”
          <span className="voice-hint">点击配音</span>
        </button>
      );
    }

    if (segment.type === 'clue') {
      const collected = collectedClueIds.includes(segment.clueId);
      return (
        <button
          key={index}
          className={collected ? 'clue-segment collected' : 'clue-segment'}
          onClick={() => collectClue(segment.clueId)}
          title="点击收集到侦探背包"
        >
          {segment.text}
          <span className="clue-hint">{collected ? '已收集' : '收集线索'}</span>
        </button>
      );
    }

    return <span key={index}>{segment.text}</span>;
  }

  if (!chapter) {
    return <main className="loading">正在加载阅读器...</main>;
  }

  return (
    <section className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-mark">🔎</span>
          <div>
            <h1>探案沉浸阅读器</h1>
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
          <h2>章节</h2>
          <div className="chapter-list">
            {chapters.map((item) => (
              <button
                key={item.id}
                className={item.id === chapter.id ? 'chapter active' : 'chapter'}
                onClick={() => setChapterId(item.id)}
              >
                <span>{item.title}</span>
                <small>{item.subtitle}</small>
              </button>
            ))}
          </div>
        </section>

        <section className="panel compact">
          <h2>阅读进度</h2>
          <div className="progress">
            <span style={{ width: `${chapter.progress}%` }} />
          </div>
          <p>{chapter.progress}% 已读</p>
        </section>
      </aside>

      <section className="reader">
        <div className="reader-toolbar">
          <div>
            <p className="eyebrow">福尔摩斯探案集 · 研究原型</p>
            <h2>{chapter.title}</h2>
          </div>
          <div className="toolbar-actions">
            <button onClick={() => window.speechSynthesis.cancel()}>停止语音</button>
            <button onClick={() => setBagOpen(true)}>打开背包</button>
          </div>
        </div>

        <div className="interaction-guide">
          <span>角色对话：点击句子为角色配音</span>
          <span>黄色线索：点击收集到背包</span>
        </div>

        <article className="book-page">
          {chapter.paragraphs.map((paragraph, paragraphIndex) => (
            <p key={paragraphIndex}>
              {paragraph.map((segment, segmentIndex) => renderSegment(segment, segmentIndex))}
            </p>
          ))}
        </article>
      </section>

      <aside className="right-rail">
        <section className="scene-card">
          <div className="scene-visual">
            <span>AI 画面占位</span>
          </div>
          <h2>{chapter.scene.title}</h2>
          <p>{chapter.scene.imagePrompt}</p>
          <dl>
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

        <section className="chat-card">
          <h2>案情对话</h2>
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
              placeholder="问一个关于当前案件的问题"
            />
            <button onClick={askAssistant}>发送</button>
          </div>
        </section>
      </aside>

      {notice && <div className="toast">{notice}</div>}

      <button className="floating-bag" onClick={() => setBagOpen((open) => !open)}>
        🎒
        <span>{collectedClues.length} 条</span>
      </button>

      {bagOpen && (
        <div className="bag-panel">
          <div className="bag-header">
            <h2>侦探背包</h2>
            <button onClick={() => setBagOpen(false)}>关闭</button>
          </div>

          {collectedClues.length === 0 ? (
            <p className="empty-bag">还没有线索。阅读正文时点击黄色高亮内容即可收集。</p>
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
