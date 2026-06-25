import React, { useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';

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

const COLLECTED_CLUES_KEY = 'immersive-reader-collected-clues';

const api = {
  async chapters(): Promise<Chapter[]> {
    const res = await fetch('/api/chapters');
    return res.json();
  },
  async clues(): Promise<Clue[]> {
    const res = await fetch('/api/clues');
    return res.json();
  },
  async chat(question: string, chapterId: string): Promise<string> {
    const res = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ question, chapterId })
    });
    const data = await res.json();
    return data.answer;
  }
};

function App() {
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
    <main className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-mark">🔎</span>
          <div>
            <h1>探案沉浸阅读器</h1>
            <p>Holmes Case Lab</p>
          </div>
        </div>

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
    </main>
  );
}

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
