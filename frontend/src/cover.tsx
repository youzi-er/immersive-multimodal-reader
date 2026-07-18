import React, { useCallback, useEffect, useMemo, useState } from 'react';

export type CoverVersion = {
  id: string;
  projectId: string;
  versionNumber: number;
  ownerUserId: string;
  username: string;
  displayName: string;
  articleId: string;
  status: 'private' | 'public' | 'withdrawn' | 'moderated' | 'deleted';
  imageUrl: string;
  mediaAssetId: string | null;
  mode: 'guided' | 'advanced';
  prompt: string;
  finalPrompt: string;
  mood: string;
  palette: string;
  composition: string;
  parameters: Partial<CoverParameters>;
  bookTitle: string;
  bookAuthor: string;
  bookSubtitle: string;
  remixedFromVersionId: string | null;
  likeCount: number;
  collectionCount: number;
  remixCount: number;
  likedByMe: boolean;
  collectedByMe: boolean;
  activeByMe: boolean;
  ownedByMe: boolean;
  createdAt: string;
};

export type CoverParameters = {
  cast: string;
  relationship: string;
  storyBeat: string;
  performance: string;
  shotSize: string;
  cameraAngle: string;
  lighting: string;
  colorGrade: string;
  texture: string;
};

export type CoverDraft = {
  articleId: string;
  mode: 'guided' | 'advanced';
  prompt: string;
  mood: string;
  palette: string;
  composition: string;
  parameters: Partial<CoverParameters>;
  bookTitle: string;
  bookAuthor: string;
  bookSubtitle: string;
  remixedFromVersionId?: string | null;
};

export type CoverApi = {
  coverHistory: (articleId: string) => Promise<{ versions: CoverVersion[] }>;
  coverCommunity: (
    articleId: string,
    sort: 'popular' | 'newest',
    scope?: 'all' | 'mine' | 'collected'
  ) => Promise<{ versions: CoverVersion[] }>;
  createCover: (payload: CoverDraft) => Promise<{ version: CoverVersion }>;
  setCurrentCover: (articleId: string, versionId: string) => Promise<{ version: CoverVersion }>;
  restoreOfficialCover: (articleId: string) => Promise<{ ok: true; version: null }>;
  setCoverStatus: (
    versionId: string,
    status: 'public' | 'withdrawn' | 'deleted'
  ) => Promise<{ version: CoverVersion }>;
  likeCover: (versionId: string, liked: boolean) => Promise<{ version: CoverVersion }>;
  collectCover: (versionId: string, collected: boolean) => Promise<{ version: CoverVersion }>;
  reportCover: (versionId: string, reason: string) => Promise<{ report: { status: 'open' } }>;
};

const PARAMETER_OPTIONS: Record<keyof CoverParameters, string[]> = {
  cast: ['单主角', '双人主导', '三人群像', '主角与威胁'],
  relationship: ['并肩侦查', '前后守望', '紧张对峙', '同望画外'],
  storyBeat: ['初见委托', '发现线索', '危险前一秒', '真相揭开'],
  performance: ['克制不安', '冷静推理', '高度警觉', '惊恐爆发'],
  shotSize: ['面部特写', '半身近景', '中景群像', '环境全景'],
  cameraAngle: ['平视在场', '低机位压迫', '门框窥视', '轻微倾斜'],
  lighting: ['油灯侧光', '冷月逆光', '壁炉跳光', '窗格切光'],
  colorGrade: ['书籍默认', '墨绿旧金', '午夜蓝银', '暗红象牙'],
  texture: ['插图原貌', '更写实', '油画笔触', '胶片颗粒']
};

const DEFAULT_PARAMETERS: CoverParameters = {
  cast: '三人群像',
  relationship: '同望画外',
  storyBeat: '危险前一秒',
  performance: '高度警觉',
  shotSize: '中景群像',
  cameraAngle: '门框窥视',
  lighting: '油灯侧光',
  colorGrade: '书籍默认',
  texture: '插图原貌'
};

function updateVersion(list: CoverVersion[], version: CoverVersion) {
  return list.map((item) => item.id === version.id ? version : item);
}

export function CoverArtwork({
  version,
  className = '',
  title = '斑点带子案',
  author = 'Arthur Conan Doyle',
  subtitle = 'The Speckled Band'
}: {
  version?: CoverVersion | null;
  className?: string;
  title?: string;
  author?: string;
  subtitle?: string;
}) {
  const coverTitle = version?.bookTitle || title;
  const coverAuthor = version?.bookAuthor || author;
  const coverSubtitle = version?.bookSubtitle || subtitle;
  return (
    <div className={`cover-artwork${version ? ' generated' : ' official'}${className ? ` ${className}` : ''}`}>
      <img src={version?.imageUrl || '/assets/speckled-band-poster-v2.png'} alt={`${coverTitle}封面`} />
      <div className="cover-artwork-shade" />
      <span className="cover-artwork-studio">CASE READER ORIGINAL</span>
      <span className="cover-artwork-author">{coverAuthor}</span>
      <div className="cover-artwork-title">
        <strong>{coverTitle}</strong>
        {coverSubtitle && <small>{coverSubtitle}</small>}
      </div>
      <span className="cover-artwork-billing">MYSTERY PICTURES · MMXXVI</span>
    </div>
  );
}

export function CoverStudio({
  articleId,
  api,
  activeCover,
  onActiveCoverChange,
  onOpenFullCommunity,
  inspiration,
  onInspirationHandled
}: {
  articleId: string;
  api: CoverApi;
  activeCover: CoverVersion | null;
  onActiveCoverChange: (cover: CoverVersion | null) => void;
  onOpenFullCommunity: () => void;
  inspiration: CoverVersion | null;
  onInspirationHandled: () => void;
}) {
  const [tab, setTab] = useState<'studio' | 'community'>('studio');
  const [studioStep, setStudioStep] = useState<'editor' | 'generating' | 'result'>('editor');
  const [mode, setMode] = useState<'guided' | 'advanced'>('guided');
  const [prompt, setPrompt] = useState('雨夜的维多利亚庄园内，福尔摩斯举着油灯侧身察看铃绳，华生警觉地回头，年轻女继承人在他们身后惊恐凝望黑暗；三个人的目光都引向画外的危险，像故事高潮前一秒');
  const [parameters, setParameters] = useState<CoverParameters>(DEFAULT_PARAMETERS);
  const [bookTitle, setBookTitle] = useState('斑点带子案');
  const [bookAuthor, setBookAuthor] = useState('Arthur Conan Doyle');
  const [bookSubtitle, setBookSubtitle] = useState('The Speckled Band');
  const [remixedFromVersionId, setRemixedFromVersionId] = useState<string | null>(null);
  const [history, setHistory] = useState<CoverVersion[]>([]);
  const [community, setCommunity] = useState<CoverVersion[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [sort, setSort] = useState<'popular' | 'newest'>('popular');
  const [loading, setLoading] = useState(true);
  const [communityLoading, setCommunityLoading] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const selectedCover = useMemo(
    () => history.find((item) => item.id === selectedId) || history[0] || activeCover,
    [activeCover, history, selectedId]
  );

  const loadHistory = useCallback(async () => {
    setLoading(true);
    try {
      const result = await api.coverHistory(articleId);
      setHistory(result.versions);
      setSelectedId((current) => current || result.versions[0]?.id || null);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : '封面历史加载失败');
    } finally {
      setLoading(false);
    }
  }, [api, articleId]);

  const loadCommunity = useCallback(async () => {
    setCommunityLoading(true);
    try {
      const result = await api.coverCommunity(articleId, sort, 'all');
      setCommunity(result.versions);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : '封面社区加载失败');
    } finally {
      setCommunityLoading(false);
    }
  }, [api, articleId, sort]);

  useEffect(() => {
    void loadHistory();
  }, [loadHistory]);

  useEffect(() => {
    if (tab === 'community') void loadCommunity();
  }, [loadCommunity, tab]);

  function useAsInspiration(version: CoverVersion) {
    setMode(version.mode);
    setPrompt(version.prompt);
    setParameters({ ...DEFAULT_PARAMETERS, ...(version.parameters || {}) });
    setBookTitle(version.bookTitle);
    setBookAuthor(version.bookAuthor);
    setBookSubtitle(version.bookSubtitle);
    setRemixedFromVersionId(version.id);
    setTab('studio');
    setStudioStep('editor');
    setMessage(`已引用 ${version.displayName || version.username} 的 V${version.versionNumber} 作为灵感，可继续修改`);
    setError('');
  }

  useEffect(() => {
    if (!inspiration) return;
    useAsInspiration(inspiration);
    onInspirationHandled();
  }, [inspiration, onInspirationHandled]);

  async function generate(event: React.FormEvent) {
    event.preventDefault();
    if (prompt.trim().length < 5) {
      setError('请至少写 5 个字，描述你想看到的封面');
      return;
    }
    setGenerating(true);
    setStudioStep('generating');
    setError('');
    setMessage('正在按镜头脚本生成封面…');
    try {
      const { version } = await api.createCover({
        articleId,
        mode,
        prompt: prompt.trim(),
        mood: mode === 'guided' ? parameters.performance : '',
        palette: mode === 'guided' ? parameters.colorGrade : '',
        composition: mode === 'guided' ? parameters.shotSize : '',
        parameters: mode === 'guided' ? parameters : {},
        bookTitle: bookTitle.trim(),
        bookAuthor: bookAuthor.trim(),
        bookSubtitle: bookSubtitle.trim(),
        remixedFromVersionId
      });
      setHistory((current) => [version, ...current]);
      setSelectedId(version.id);
      setRemixedFromVersionId(null);
      setStudioStep('result');
      setMessage(`V${version.versionNumber} 已保存。满意的话，可以设为当前封面或发布到社区。`);
    } catch (nextError) {
      setStudioStep('editor');
      setMessage('');
      setError(nextError instanceof Error ? nextError.message : '封面生成失败');
    } finally {
      setGenerating(false);
    }
  }

  async function copyFinalPrompt() {
    if (!selectedCover?.finalPrompt) return;
    try {
      await navigator.clipboard.writeText(selectedCover.finalPrompt);
      setMessage(`V${selectedCover.versionNumber} 的完整提示词已复制`);
      setError('');
    } catch {
      setError('复制失败，请手动选择提示词文本');
    }
  }

  async function activate(version: CoverVersion) {
    setError('');
    try {
      const result = await api.setCurrentCover(articleId, version.id);
      onActiveCoverChange(result.version);
      setHistory((current) => current.map((item) => ({ ...item, activeByMe: item.id === version.id })));
      setMessage(`V${version.versionNumber} 已成为这本书的当前封面`);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : '设置封面失败');
    }
  }

  async function restoreOfficial() {
    setError('');
    try {
      await api.restoreOfficialCover(articleId);
      onActiveCoverChange(null);
      setHistory((current) => current.map((item) => ({ ...item, activeByMe: false })));
      setMessage('已恢复官方封面，你创作的历史版本仍然保留');
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : '恢复官方封面失败');
    }
  }

  async function setStatus(version: CoverVersion, status: 'public' | 'withdrawn') {
    setError('');
    try {
      const result = await api.setCoverStatus(version.id, status);
      setHistory((current) => updateVersion(current, result.version));
      setCommunity((current) => status === 'withdrawn'
        ? current.filter((item) => item.id !== version.id)
        : [result.version, ...current.filter((item) => item.id !== version.id)]);
      setMessage(status === 'public' ? '封面已发布到创作社区' : '封面已从创作社区撤回');
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : '更新发布状态失败');
    }
  }

  async function toggleLike(version: CoverVersion) {
    try {
      const result = await api.likeCover(version.id, !version.likedByMe);
      setCommunity((current) => updateVersion(current, result.version));
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : '点赞失败');
    }
  }

  async function toggleCollection(version: CoverVersion) {
    try {
      const result = await api.collectCover(version.id, !version.collectedByMe);
      setCommunity((current) => updateVersion(current, result.version));
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : '收藏失败');
    }
  }

  async function report(version: CoverVersion) {
    const reason = window.prompt('请简要说明举报原因（3—500 字）');
    if (!reason) return;
    try {
      await api.reportCover(version.id, reason);
      setMessage('举报已提交');
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : '举报失败');
    }
  }

  return (
    <section className="cover-studio context-card">
      <div className="cover-subtabs" role="tablist" aria-label="封面设计">
        <button type="button" className={tab === 'studio' ? 'active' : ''} onClick={() => setTab('studio')}>创作封面</button>
        <button type="button" className={tab === 'community' ? 'active' : ''} onClick={() => setTab('community')}>封面社区</button>
      </div>

      {error && <p className="cover-feedback error">{error}</p>}
      {message && <p className="cover-feedback">{message}</p>}

      {tab === 'studio' ? (
        studioStep === 'generating' ? (
          <section className="cover-generating-view" aria-live="polite">
            <div className="cover-generating-poster"><span /><strong>AI</strong></div>
            <span className="cover-kicker">GENERATING COVER</span>
            <h2>正在制作新封面</h2>
            <p>MiniMax 正在根据人物关系、戏剧节点和摄影参数生成 2:3 画面，完成后会自动进入结果确认页。</p>
            <div className="cover-generating-summary">
              <span>{parameters.cast}</span><span>{parameters.relationship}</span><span>{parameters.storyBeat}</span>
              <span>{parameters.shotSize}</span><span>{parameters.cameraAngle}</span><span>{parameters.lighting}</span>
            </div>
          </section>
        ) : studioStep === 'result' && selectedCover ? (
          <section className="cover-result-view">
            <header className="cover-result-heading">
              <button type="button" onClick={() => setStudioStep('editor')}>← 返回调整</button>
              <div><span>GENERATION COMPLETE</span><h2>V{selectedCover.versionNumber} 生成完成</h2></div>
              <small>{selectedCover.status === 'public' ? '已发布' : '私人版本'}</small>
            </header>

            <div className="cover-result-hero">
              <CoverArtwork version={selectedCover} />
              <div>
                <span className="cover-kicker">RESULT PREVIEW</span>
                <h3>{selectedCover.bookTitle}</h3>
                <p>图片已经保存到“我的版本”。采用和发布是两个独立选择，你可以只做其中一个，也可以稍后再决定。</p>
                <div className="cover-result-tags">
                  {Object.values(selectedCover.parameters || {}).filter(Boolean).map((value) => <span key={value}>{value}</span>)}
                </div>
              </div>
            </div>

            <div className="cover-result-decisions">
              <article className={selectedCover.activeByMe ? 'done' : ''}>
                <span>01 · 个人使用</span>
                <strong>{selectedCover.activeByMe ? '已采用为当前封面' : '采用这张封面？'}</strong>
                <p>只会替换你自己书架和阅读器里的封面，不会自动公开。</p>
                <button type="button" disabled={selectedCover.activeByMe} onClick={() => void activate(selectedCover)}>
                  {selectedCover.activeByMe ? '已采用' : '采用为当前封面'}
                </button>
              </article>
              <article className={selectedCover.status === 'public' ? 'done' : ''}>
                <span>02 · 创作社区</span>
                <strong>{selectedCover.status === 'public' ? '已发布到社区' : '公开这张封面？'}</strong>
                <p>其他读者可以查看完整提示词、收藏并以此继续二创。</p>
                {selectedCover.status === 'public' ? (
                  <button type="button" className="secondary" onClick={() => void setStatus(selectedCover, 'withdrawn')}>撤回发布</button>
                ) : (
                  <button type="button" onClick={() => void setStatus(selectedCover, 'public')}>发布到社区</button>
                )}
              </article>
            </div>

            <section className="cover-prompt-receipt">
              <header>
                <div><span>MINIMAX PROMPT RECEIPT</span><strong>实际发送给 MiniMax 的完整提示词</strong></div>
                <small>{selectedCover.finalPrompt.length} 字符</small>
              </header>
              <p>{selectedCover.finalPrompt}</p>
              <button type="button" onClick={() => void copyFinalPrompt()}>复制完整提示词</button>
            </section>

            <div className="cover-result-footer">
              <button type="button" onClick={() => setStudioStep('editor')}>返回调整参数</button>
              <button type="button" className="primary" onClick={() => useAsInspiration(selectedCover)}>基于此版继续创作</button>
            </div>
          </section>
        ) : (
        <>
          <div className="cover-studio-preview">
            <CoverArtwork version={selectedCover} title={bookTitle} author={bookAuthor} subtitle={bookSubtitle} />
            <div>
              <span className="cover-kicker">BOOK COVER LAB</span>
              <h2>{selectedCover ? `创作版本 V${selectedCover.versionNumber}` : '从一个画面开始'}</h2>
              <p>图像负责氛围，书名与作者由系统清晰排版，不让乱码破坏封面。</p>
              {activeCover && <button type="button" className="cover-text-button" onClick={() => void restoreOfficial()}>恢复官方封面</button>}
            </div>
          </div>

          <form className="cover-design-form" onSubmit={generate}>
            <div className="cover-mode-switch" role="radiogroup" aria-label="创作模式">
              <button type="button" className={mode === 'guided' ? 'active' : ''} onClick={() => setMode('guided')}>
                <strong>快捷生成</strong>
              </button>
              <button type="button" className={mode === 'advanced' ? 'active' : ''} onClick={() => setMode('advanced')}>
                <strong>自由</strong>
              </button>
            </div>

            <label className="cover-prompt-field">
              <span>{mode === 'guided' ? '描述演员、场景和戏剧瞬间' : '完整提示词'}</span>
              <textarea
                value={prompt}
                onChange={(event) => setPrompt(event.target.value)}
                maxLength={mode === 'guided' ? 180 : 900}
                rows={5}
                placeholder={mode === 'guided' ? '例如：福尔摩斯举灯检查铃绳，华生突然回头，女继承人在门边惊恐屏息；像危险发生前一秒的电影剧照…' : '直接输入最终发送给生图模型的完整提示词…'}
              />
              <small>{prompt.length}/{mode === 'guided' ? 180 : 900}</small>
            </label>

            {mode === 'guided' && (
              <div className="cover-director-controls">
                <header className="cover-director-heading">
                  <div><span>DIRECTOR'S BOARD</span><strong>镜头脚本</strong></div>
                  <small>{parameters.cast} · {parameters.storyBeat} · {parameters.shotSize}</small>
                </header>

                <section className="cover-control-section">
                  <div className="cover-control-title">
                    <em>01</em><div><strong>人物与戏剧</strong><small>先确定谁在演、关系是什么、此刻发生了什么</small></div>
                  </div>
                  <div className="cover-direction-grid">
                    <TagGroup label="人物阵容" hint="决定视觉主体" values={PARAMETER_OPTIONS.cast} selected={parameters.cast} onSelect={(value) => setParameters((current) => ({ ...current, cast: value }))} />
                    <TagGroup label="关系调度" hint="决定人物站位与视线" values={PARAMETER_OPTIONS.relationship} selected={parameters.relationship} onSelect={(value) => setParameters((current) => ({ ...current, relationship: value }))} />
                    <TagGroup label="戏剧节点" hint="决定截图发生在哪一秒" values={PARAMETER_OPTIONS.storyBeat} selected={parameters.storyBeat} onSelect={(value) => setParameters((current) => ({ ...current, storyBeat: value }))} />
                    <TagGroup label="表演强度" hint="决定演员的情绪状态" values={PARAMETER_OPTIONS.performance} selected={parameters.performance} onSelect={(value) => setParameters((current) => ({ ...current, performance: value }))} />
                  </div>
                </section>

                <details className="cover-camera-controls" open>
                  <summary className="cover-control-title">
                    <em>02</em><div><strong>摄影与美术</strong><small>锁定景别、机位、光源和成片质感</small></div>
                  </summary>
                  <div className="cover-direction-grid">
                    <TagGroup label="人物景别" hint="脸在画面里有多大" values={PARAMETER_OPTIONS.shotSize} selected={parameters.shotSize} onSelect={(value) => setParameters((current) => ({ ...current, shotSize: value }))} />
                    <TagGroup label="摄影机位" hint="观众从哪里看" values={PARAMETER_OPTIONS.cameraAngle} selected={parameters.cameraAngle} onSelect={(value) => setParameters((current) => ({ ...current, cameraAngle: value }))} />
                    <TagGroup label="叙事光源" hint="让光线有剧情理由" values={PARAMETER_OPTIONS.lighting} selected={parameters.lighting} onSelect={(value) => setParameters((current) => ({ ...current, lighting: value }))} />
                    <TagGroup label="色彩方案" hint="在本书底色上偏移" values={PARAMETER_OPTIONS.colorGrade} selected={parameters.colorGrade} onSelect={(value) => setParameters((current) => ({ ...current, colorGrade: value }))} />
                    <TagGroup label="质感偏移" hint="不改变全书基础画风" values={PARAMETER_OPTIONS.texture} selected={parameters.texture} onSelect={(value) => setParameters((current) => ({ ...current, texture: value }))} />
                  </div>
                </details>

                <p className="cover-director-note">生成优先级：人物关系 → 戏剧节点 → 景别与机位 → 光色。上面的描述框只需要补充本书独有的场景和动作。</p>
              </div>
            )}

            <details className="cover-book-fields">
              <summary>封面文字与署名</summary>
              <label>书名<input value={bookTitle} onChange={(event) => setBookTitle(event.target.value)} maxLength={80} /></label>
              <label>作者<input value={bookAuthor} onChange={(event) => setBookAuthor(event.target.value)} maxLength={80} /></label>
              <label>英文副标题<input value={bookSubtitle} onChange={(event) => setBookSubtitle(event.target.value)} maxLength={80} /></label>
            </details>

            {remixedFromVersionId && (
              <div className="cover-remix-note">
                正在进行灵感二创
                <button type="button" onClick={() => setRemixedFromVersionId(null)}>取消引用</button>
              </div>
            )}
            <button className="cover-generate-button" type="submit" disabled={generating}>
              {generating ? '正在生成封面…' : '生成新封面'}
            </button>
          </form>

          <section className="cover-history">
            <div className="cover-section-heading">
              <div><span>VERSION ARCHIVE</span><h3>我的版本</h3></div>
              <small>{history.length} 个版本</small>
            </div>
            {loading ? <p className="cover-empty">正在读取版本…</p> : history.length === 0 ? (
              <p className="cover-empty">第一张封面会自动保存在这里。</p>
            ) : (
              <div className="cover-history-grid">
                {history.map((version) => (
                  <button type="button" key={version.id} className={selectedCover?.id === version.id ? 'active' : ''} onClick={() => { setSelectedId(version.id); setStudioStep('result'); setMessage(''); setError(''); }}>
                    <CoverArtwork version={version} />
                    <span>V{version.versionNumber}{version.activeByMe ? ' · 使用中' : version.status === 'public' ? ' · 已发布' : ''}</span>
                  </button>
                ))}
              </div>
            )}
          </section>
        </>
        )
      ) : (
        <section className="cover-community-panel">
          <div className="cover-community-intro">
            <div><span>INSPIRATION WALL</span><h2>同一本书，不同想象</h2></div>
            <select value={sort} onChange={(event) => setSort(event.target.value as typeof sort)} aria-label="封面排序">
              <option value="popular">热门优先</option><option value="newest">最新发布</option>
            </select>
          </div>
          {communityLoading ? <p className="cover-empty">正在布置灵感墙…</p> : community.length === 0 ? (
            <p className="cover-empty">还没有公开封面。你可以发布第一张。</p>
          ) : (
            <div className="cover-community-mini-grid">
              {community.map((version) => (
                <article key={version.id}>
                  <CoverArtwork version={version} />
                  <div className="cover-community-card-body">
                    <strong>{version.displayName || version.username}</strong>
                    <small>赞 {version.likeCount} · 收藏 {version.collectionCount} · 二创 {version.remixCount}</small>
                    <details><summary>完整提示词</summary><p>{version.finalPrompt}</p></details>
                    <div>
                      {version.ownedByMe ? (
                        <button type="button" onClick={() => void setStatus(version, 'withdrawn')}>撤回</button>
                      ) : (
                        <>
                          <button type="button" className={version.likedByMe ? 'active' : ''} onClick={() => void toggleLike(version)}>{version.likedByMe ? '已赞' : '点赞'}</button>
                          <button type="button" className={version.collectedByMe ? 'active' : ''} onClick={() => void toggleCollection(version)}>{version.collectedByMe ? '已收藏' : '收藏'}</button>
                          <button type="button" onClick={() => void report(version)}>举报</button>
                        </>
                      )}
                      <button type="button" className="remix" onClick={() => useAsInspiration(version)}>以此为灵感</button>
                    </div>
                  </div>
                </article>
              ))}
            </div>
          )}
          <button type="button" className="cover-open-square" onClick={onOpenFullCommunity}>进入完整创作广场</button>
        </section>
      )}
    </section>
  );
}

function TagGroup({
  label,
  hint,
  values,
  selected,
  onSelect
}: {
  label: string;
  hint?: string;
  values: string[];
  selected: string;
  onSelect: (value: string) => void;
}) {
  return (
    <div className="cover-tag-group">
      <span>{label}{hint && <small>{hint}</small>}</span>
      <div>{values.map((value) => (
        <button key={value} type="button" className={selected === value ? 'active' : ''} onClick={() => onSelect(value)}>{value}</button>
      ))}</div>
    </div>
  );
}
