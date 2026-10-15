'use client';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  Check,
  CheckCircle2,
  ChevronDown,
  EyeOff,
  Lightbulb,
  LoaderCircle,
  Mic,
  PenLine,
  Plus,
  RotateCcw,
  Sparkles,
  Target,
} from 'lucide-react';
import { api, useApp } from './app-provider';
import { Attempt, Mode, Scene, scenes, Session, skillLabels, focusLabels } from '@/lib/domain';
import { VoiceRecorder } from './voice-recorder';
import { FocusMap } from './focus-map';

function EvidenceText({ text, quote }: { text: string; quote: string }) {
  const at = text.indexOf(quote);
  if (at < 0 || !quote) return <>{text}</>;
  return (
    <>
      {text.slice(0, at)}
      <mark>{quote}</mark>
      {text.slice(at + quote.length)}
    </>
  );
}

export function CoachPage() {
  const params = useSearchParams();
  const { data, refresh, toast, setSettings, recording } = useApp();
  const [session, setSession] = useState<Session | null>(null);
  const [mode, setMode] = useState<Mode>(params.get('mode') === 'speak' ? 'speak' : 'think');
  const [scene, setScene] = useState<Scene>(
    ((params.get('scene') || '') in scenes
      ? params.get('scene')
      : params.get('mode') === 'speak'
        ? 'work'
        : 'free') as Scene,
  );
  const [topic, setTopic] = useState('');
  const [text, setText] = useState('');
  const [transcript, setTranscript] = useState<{ id: string; text: string } | null>(null);
  const [input, setInput] = useState(params.get('input') === 'text' ? 'text' : 'voice');
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [editing, setEditing] = useState(true);
  const [hint, setHint] = useState('');
  const [correction, setCorrection] = useState('');
  const [feedback, setFeedback] = useState<Session['feedback']>(null);
  const sessionKey = useRef('');
  const attemptKey = useRef('');
  const creating = useRef<Promise<string> | null>(null);
  const sid = params.get('session');
  useEffect(() => {
    sessionKey.current = crypto.randomUUID();
    attemptKey.current = crypto.randomUUID();
  }, []);
  useEffect(() => {
    if (!data?.capabilities.signed_in) return;
    let cancelled = false;
    const load = async () => {
      try {
        if (sid) {
          const next = await api<Session>(`sessions/${sid}`);
          if (cancelled) return;
          setSession(next);
          setMode(next.mode);
          setScene(next.scene);
          setTopic(next.topic);
          setEditing(!next.attempts.length || next.status === 'final_assessment');
        }
        const draft = JSON.parse(localStorage.getItem(`fp-draft:${sid || 'new'}`) || 'null');
        if (draft && !cancelled) {
          setText(draft.text || '');
          setTranscript(draft.transcript || null);
          if (draft.text) setInput('text');
        }
      } catch (e) {
        if (!cancelled) setError((e as Error).message);
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [sid, data?.capabilities.signed_in]);
  function saveDraft(value: string, currentTranscript = transcript) {
    setText(value);
    try {
      localStorage.setItem(
        `fp-draft:${session?.id || sid || 'new'}`,
        JSON.stringify({ text: value, transcript: currentTranscript }),
      );
    } catch {
      /* Storage unavailable: keep in memory. */
    }
  }
  async function ensureSession(quickAdvice = false): Promise<string> {
    if (session) {
      if (quickAdvice && !session.quick_advice)
        setSession(await api<Session>(`sessions/${session.id}`, 'PATCH', { quick_advice: true }));
      return session.id;
    }
    if (!data?.capabilities.signed_in) {
      setSettings(true);
      throw new Error('请先登录，再开始这次练习。');
    }
    if (creating.current) return creating.current;
    creating.current = (async () => {
      const s = await api<Session>('sessions', 'POST', {
        mode,
        scene,
        topic,
        idempotency_key: sessionKey.current || crypto.randomUUID(),
        quick_advice: quickAdvice,
      });
      setSession(s);
      window.history.replaceState(null, '', `/coach?session=${s.id}`);
      try {
        localStorage.setItem(`fp-draft:${s.id}`, JSON.stringify({ text, transcript }));
        localStorage.removeItem('fp-draft:new');
      } catch {}
      return s.id;
    })();
    try {
      return await creating.current;
    } finally {
      creating.current = null;
    }
  }
  async function reload(id: string) {
    const s = await api<Session>(`sessions/${id}`);
    setSession(s);
    await refresh();
    return s;
  }
  async function analyzeAttempt(id: string, attemptId: string) {
    setBusy('正在找这一轮最重要的线索…');
    await api('analyze', 'POST', { session_id: id, attempt_id: attemptId });
    await reload(id);
    setEditing(false);
    setHint('');
  }
  async function submit(quickAdvice = false) {
    if (busy || text.trim().length < 2) return;
    setError('');
    setBusy('正在保存你的原话…');
    try {
      const id = await ensureSession(quickAdvice);
      const attempt = await api<Attempt>('attempts', 'POST', {
        session_id: id,
        text,
        idempotency_key: attemptKey.current,
        origin: transcript ? 'voice' : 'text',
        transcript_id: transcript?.id || null,
      });
      localStorage.removeItem(`fp-draft:${id}`);
      localStorage.removeItem('fp-draft:new');
      attemptKey.current = crypto.randomUUID();
      setText('');
      setTranscript(null);
      await reload(id);
      await analyzeAttempt(id, attempt.id);
      if (quickAdvice) {
        setBusy('正在准备快速建议（不计独立测验）…');
        const result = await api<{ text: string }>('coach', 'POST', {
          session_id: id,
          hint_level: 3,
        });
        setHint(result.text);
        await reload(id);
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy('');
    }
  }
  async function retry() {
    if (!session) return;
    setError('');
    try {
      await analyzeAttempt(session.id, session.attempts.at(-1)!.id);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy('');
    }
  }
  async function requestHint(level: number) {
    if (!session || busy) return;
    setBusy('正在准备这一点提示…');
    setError('');
    try {
      const result = await api<{ text: string }>('coach', 'POST', {
        session_id: session.id,
        hint_level: level,
      });
      setHint(result.text);
      await reload(session.id);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy('');
    }
  }
  async function patch(update: object) {
    if (!session) return;
    setError('');
    try {
      const next = await api<Session>(`sessions/${session.id}`, 'PATCH', update);
      setSession(next);
    } catch (e) {
      setError((e as Error).message);
    }
  }
  async function recall() {
    await patch({ recall: true });
    setEditing(true);
    setHint('');
    setText('');
    setTranscript(null);
    attemptKey.current = crypto.randomUUID();
  }
  async function complete() {
    if (!session) return;
    setBusy('正在把这次练习放进笔记本…');
    setError('');
    try {
      await api(`sessions/${session.id}/complete`, 'POST', {
        final_attempt_id: session.attempts.at(-1)!.id,
        feedback,
      });
      await reload(session.id);
      localStorage.removeItem(`fp-draft:${session.id}`);
      toast('这次表达和它的证据，已经好好保存。');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy('');
    }
  }
  const last = session?.attempts.at(-1);
  const analysis = last?.analysis;
  const isRecall = session?.status === 'final_assessment';
  const completed = session?.status === 'completed';
  const challengeSource = session?.challenge_of
    ? data?.sessions.find((s) => s.id === session.challenge_of)
    : null;
  const showFeedback = !!analysis && !isRecall && !editing;
  const step = completed
    ? 3
    : isRecall || (session?.attempts.length || 0) > 1
      ? 2
      : showFeedback
        ? 1
        : 0;
  const maxLevel = Math.max(0, ...(session?.hints.map((h) => h.level) || []));
  const inputVisible = !completed && (!last || (!!analysis && editing));
  return (
    <>
      <div className="page-heading">
        <div>
          <div className="eyebrow">YOUR VOICE, YOUR FIRST POINT</div>
          <h1>
            {completed
              ? '把这份清晰，带走。'
              : isRecall
                ? '这一次，只听你自己。'
                : mode === 'think'
                  ? '让念头，慢慢成形。'
                  : '用自己的话，讲清楚。'}
          </h1>
          <p>
            {completed
              ? '每一轮真实表达，都是你思考的痕迹。'
              : isRecall
                ? '提示已经收起。再用自己的话，讲一遍这个问题。'
                : '不急着说得漂亮。先说出你真正想说的。'}
          </p>
        </div>
        <Link href="/" className="button quiet">
          <ArrowLeft size={16} />
          返回空间
        </Link>
      </div>
      <div className="coach-stepper">
        {['留下原话', '找到重点', '再说一次', '带走收获'].map((label, i) => (
          <div key={label} className={step === i ? 'current' : step > i ? 'done' : ''}>
            <span>{step > i ? <Check size={13} /> : `0${i + 1}`}</span>
            {label}
            {i < 3 && <i />}
          </div>
        ))}
      </div>
      {data && !data.capabilities.ai && (
        <div className="notice subtle">
          <Lightbulb size={16} />
          <span>本地文字观察模式 · AI 教练与转写尚未连接，当前记录不计入正式能力评分。</span>
          <button onClick={() => setSettings(true)}>查看连接</button>
        </div>
      )}
      {error && (
        <div className="notice error" role="alert">
          {error}
        </div>
      )}
      {busy && (
        <div className="notice loading" role="status">
          <LoaderCircle className="spin" size={17} />
          {busy}
        </div>
      )}
      {completed ? (
        <div className="completed-layout">
          <section className="panel completion-card">
            <span className="completion-icon">
              <CheckCircle2 size={31} />
            </span>
            <span className="eyebrow">A THOUGHT, WELL KEPT</span>
            <h2>你又认真听了自己一次。</h2>
            <p>
              {session.attempts.length > 1
                ? `这次留下了 ${session.attempts.length} 轮真实表达。哪些变化是你自己想出来的？`
                : '先把表达留下来，也是一种开始。下次可以再试着重述。'}
            </p>
            <div className="completion-facts">
              <span>
                <Check size={15} />
                原文与结构证据已保存
              </span>
              <span>
                <Check size={15} />
                {data?.profile.consent_memory
                  ? 'Memory 已按证据规则更新'
                  : '按你的偏好，不更新 Memory'}
              </span>
              <span>
                <EyeOff size={15} />
                {last?.independent_eligible
                  ? '首次表达保留独立条件'
                  : '本轮为练习表达，不计独立通过'}
              </span>
            </div>
            <div className="button-row">
              <Link href="/growth" className="button primary">
                回看这次练习
                <ArrowRight size={16} />
              </Link>
              <a href="/coach" className="button secondary">
                <Plus size={16} />
                新的念头
              </a>
            </div>
          </section>
          {analysis && (
            <FocusMap
              analysis={analysis}
              selected={session.selected_point_id}
              corrections={session.point_corrections}
              removedRelations={session.removed_relations}
            />
          )}
        </div>
      ) : (
        <div className="coach-layout">
          <div className="coach-main">
            {inputVisible && (
              <section className="panel expression-panel">
                <div className="panel-heading">
                  <span className="step-label">
                    {isRecall ? '03 / 练习复述' : last ? '03 / 自主重述' : '01 / 先表达，再分析'}
                  </span>
                  <span className="tag sand">
                    {last
                      ? `第 ${(session?.attempts.length || 0) + 1} / 3 轮`
                      : '无提示 · 原始尝试'}
                  </span>
                </div>
                {!session && (
                  <>
                    <div className="segmented">
                      <button
                        className={mode === 'think' ? 'active' : ''}
                        onClick={() => {
                          setMode('think');
                          setScene('free');
                        }}
                      >
                        先理一理
                      </button>
                      <button
                        className={mode === 'speak' ? 'active' : ''}
                        onClick={() => {
                          setMode('speak');
                          setScene('work');
                        }}
                      >
                        直接表达
                      </button>
                    </div>
                    <div className="scene-tabs" role="group" aria-label="表达场景">
                      {(Object.entries(scenes) as [Scene, (typeof scenes)[Scene]][]).map(
                        ([key, s]) => (
                          <button
                            key={key}
                            className={scene === key ? 'active' : ''}
                            onClick={() => setScene(key)}
                          >
                            {s.label}
                          </button>
                        ),
                      )}
                    </div>
                    <label className="field-label" htmlFor="topic">
                      给这次表达一个主题 <span>可选</span>
                    </label>
                    <input
                      id="topic"
                      value={topic}
                      onChange={(e) => setTopic(e.target.value)}
                      maxLength={160}
                      placeholder="例如：我想和同事确认一个方案"
                    />
                  </>
                )}
                <div className="practice-prompt">
                  <Target size={17} />
                  <p>{session?.topic || scenes[scene].prompt}</p>
                </div>
                {isRecall && (
                  <div className="notice subtle">
                    <EyeOff size={17} />
                    本轮隐藏了提示；此前看过的帮助仍如实记录，不会重置独立资格。
                  </div>
                )}
                <div className="input-tabs">
                  <button
                    className={input === 'voice' ? 'active' : ''}
                    onClick={() => setInput('voice')}
                    disabled={recording}
                  >
                    <Mic size={16} />
                    说出来
                  </button>
                  <button
                    className={input === 'text' ? 'active' : ''}
                    onClick={() => setInput('text')}
                    disabled={recording}
                  >
                    <PenLine size={16} />
                    写下来
                  </button>
                  {recording && <span className="small muted">请先结束录音</span>}
                </div>
                {input === 'voice' && (
                  <VoiceRecorder
                    ensureSession={ensureSession}
                    disabled={!!busy}
                    onTranscript={(item) => {
                      setTranscript(item);
                      saveDraft(item.text, item);
                      setInput('text');
                    }}
                  />
                )}
                <label htmlFor="expression" className="field-label">
                  {transcript ? '转写待确认 · 可以直接修改错字' : '你的原话'}
                  <span>{text.length} / 10000</span>
                </label>
                <textarea
                  id="expression"
                  value={text}
                  onChange={(e) => saveDraft(e.target.value)}
                  placeholder={
                    isRecall
                      ? '不用回看提示，试着重新讲清楚…'
                      : mode === 'think'
                        ? '最近我一直在想……有些地方还没想明白，也没关系。'
                        : '我想说的这件事是……'
                  }
                  rows={input === 'voice' ? 4 : 8}
                  maxLength={10000}
                  disabled={!!busy}
                />
                <div className="editor-footer">
                  <span>文字草稿仅暂存在当前浏览器</span>
                  <button
                    className="button primary"
                    onClick={() => void submit()}
                    disabled={text.trim().length < 2 || !!busy}
                  >
                    {busy ? <LoaderCircle className="spin" size={16} /> : <ArrowRight size={16} />}
                    {transcript
                      ? '确认转写，开始分析'
                      : last
                        ? '提交这次重述'
                        : '确认原文，找到重点'}
                  </button>
                </div>
                {!last && (
                  <button
                    className="text-button quick-advice"
                    disabled={!!busy || recording || text.trim().length < 2}
                    onClick={() => {
                      if (!data?.capabilities.ai) {
                        setSettings(true);
                        return;
                      }
                      void submit(true);
                    }}
                  >
                    急用？直接看示范 <span>快速建议 · 不计独立测验</span>
                  </button>
                )}
              </section>
            )}
            {!analysis && last && (
              <section className="panel">
                <span className="step-label">原话已保存</span>
                <blockquote>{last.confirmed_text}</blockquote>
                <p className="muted">
                  {busy ? '正在等待分析完成。' : '分析未完成，可以从这里重试，无需重新输入。'}
                </p>
                <button className="button primary" onClick={() => void retry()} disabled={!!busy}>
                  <RotateCcw size={16} />
                  重试分析
                </button>
              </section>
            )}
            {showFeedback && (
              <>
                <section className="panel transcript-card">
                  <div className="panel-heading">
                    <h2>你刚才这样说</h2>
                    <span className="tag sand">
                      第 {last!.round_no} 轮 ·{' '}
                      {last!.independent_eligible ? '原始独立尝试' : '辅助练习'}
                    </span>
                  </div>
                  <blockquote>
                    <EvidenceText
                      text={last!.confirmed_text}
                      quote={
                        analysis.points.find((p) => p.id === session?.selected_point_id)?.quote ||
                        analysis.issue_quote
                      }
                    />
                  </blockquote>
                  <p className="small muted">仅文本结构分析 · 音频级语速、停顿等指标不可用</p>
                </section>
                <section className="panel semantic-panel">
                  <div className="panel-heading">
                    <h2>
                      {mode === 'think'
                        ? '哪个点，是你现在最想弄明白的？'
                        : '这些，是你表达里的线索'}
                    </h2>
                    <span className="small muted">来自你的原话</span>
                  </div>
                  <div className="semantic-list">
                    {analysis.points.map((p, i) => (
                      <button
                        key={p.id}
                        className={session?.selected_point_id === p.id ? 'selected' : ''}
                        onClick={() => {
                          void patch({ selected_point_id: p.id });
                          setCorrection(session?.point_corrections[p.id] || p.text);
                        }}
                      >
                        <span
                          style={{
                            background: ['#ffd86b', '#a8d8b9', '#ffb3a7', '#cbc6e1', '#f4c69c'][
                              i % 5
                            ],
                          }}
                        />
                        <strong>{session?.point_corrections[p.id] || p.text}</strong>
                        <small>「{p.quote}」</small>
                        {session?.selected_point_id === p.id && <Check size={15} />}
                      </button>
                    ))}
                  </div>
                  <button
                    className="text-button"
                    onClick={() => void patch({ selected_point_id: null })}
                  >
                    我还没想清楚，先继续探索
                  </button>
                  {session?.selected_point_id && (
                    <form
                      className="point-correction"
                      onSubmit={(e) => {
                        e.preventDefault();
                        void patch({ point_id: session.selected_point_id, correction });
                        toast('你的理解已保留，原始证据不会被覆盖。');
                      }}
                    >
                      <label htmlFor="point-correction">想调整这个点的理解？</label>
                      <div className="input-row">
                        <input
                          id="point-correction"
                          value={correction}
                          onChange={(e) => setCorrection(e.target.value)}
                          maxLength={100}
                        />
                        <button className="button secondary" disabled={!correction.trim()}>
                          保存纠正
                        </button>
                      </div>
                    </form>
                  )}
                </section>
                {(session?.attempts.length || 0) > 1 && (
                  <section className="panel">
                    <h2>听听前后的自己</h2>
                    <div className="comparison">
                      <div>
                        <span className="small muted">第一次表达</span>
                        <p>{session!.attempts[0].confirmed_text}</p>
                      </div>
                      <div>
                        <span className="small orange-text">这一次表达</span>
                        <p>{last!.confirmed_text}</p>
                      </div>
                    </div>
                    <p className="small muted">
                      结构观察：
                      {
                        focusLabels[session!.attempts[0].analysis?.focus_state || 'uncertain']
                      } → {focusLabels[analysis.focus_state]}。变化以两次真实原文为准。
                    </p>
                  </section>
                )}
                <div className="coach-actions">
                  {(session?.attempts.length || 0) < 3 && (
                    <>
                      <button
                        className="button primary"
                        onClick={() => {
                          setEditing(true);
                          setText('');
                          setTranscript(null);
                          attemptKey.current = crypto.randomUUID();
                        }}
                      >
                        <Mic size={16} />
                        用自己的话，再说一次
                      </button>
                      <button className="button secondary" onClick={() => void recall()}>
                        <EyeOff size={16} />
                        收起提示，练习复述
                      </button>
                    </>
                  )}
                  <button
                    className="button quiet"
                    onClick={() => void complete()}
                    disabled={!!busy}
                  >
                    保存这次练习
                    <Check size={16} />
                  </button>
                </div>
                <div className="communication-feedback">
                  <label htmlFor="communication">真实沟通后，对方理解了吗？</label>
                  <select
                    id="communication"
                    value={feedback || ''}
                    onChange={(e) => setFeedback((e.target.value || null) as Session['feedback'])}
                  >
                    <option value="">可选，之后再观察</option>
                    <option value="understood">一次被理解</option>
                    <option value="questioned">仍被追问</option>
                    <option value="unsure">不确定</option>
                  </select>
                </div>
              </>
            )}
          </div>
          <aside className="coach-aside">
            {showFeedback ? (
              <>
                <section className="feedback-card">
                  <div className="note-kicker">
                    <Sparkles size={17} />
                    这一轮，只改一个点<span>LEVEL {maxLevel}</span>
                  </div>
                  <h2>{analysis.issue_title}</h2>
                  <blockquote>「{analysis.issue_quote}」</blockquote>
                  <p>{analysis.why}</p>
                  <div className="one-question">
                    <span>想一想</span>
                    <strong>{analysis.next_action}</strong>
                  </div>
                  <div className="hint-ladder">
                    <span>需要多一点帮助？</span>
                    <div>
                      <button onClick={() => void requestHint(1)} disabled={!!busy}>
                        一个问题
                      </button>
                      <button onClick={() => void requestHint(2)} disabled={!!busy}>
                        小骨架
                      </button>
                      <button onClick={() => void requestHint(3)} disabled={!!busy}>
                        看示范
                      </button>
                    </div>
                    <small>看过提示后，后续表达会如实标为辅助练习。</small>
                  </div>
                  {hint && (
                    <div className="hint-content" role="status">
                      {hint}
                    </div>
                  )}
                  {session?.hints.at(-1)?.memory_ids.length ? (
                    <p className="small muted">
                      本次示范参考了 {session.hints.at(-1)!.memory_ids.length} 条
                      Memory；独立评分未使用记忆标签。
                    </p>
                  ) : null}
                </section>
                <FocusMap
                  analysis={analysis}
                  selected={session?.selected_point_id}
                  corrections={session?.point_corrections}
                  removedRelations={session?.removed_relations}
                  onSelect={(id) => {
                    void patch({ selected_point_id: id });
                    setCorrection(analysis.points.find((p) => p.id === id)?.text || '');
                  }}
                />
                {analysis.relations.length > 0 && (
                  <details className="panel relation-editor">
                    <summary>
                      检查语义关系
                      <ChevronDown size={14} />
                    </summary>
                    {analysis.relations
                      .filter((r) => !session?.removed_relations.includes(`${r.from}:${r.to}`))
                      .map((r) => (
                        <div key={`${r.from}:${r.to}`}>
                          <p>「{r.quote}」</p>
                          <button
                            className="text-button"
                            onClick={() => void patch({ remove_relation: `${r.from}:${r.to}` })}
                          >
                            这条关系不准确，移除
                          </button>
                        </div>
                      ))}
                  </details>
                )}
              </>
            ) : (
              <section className="coach-note">
                <div className="note-illustration">
                  <span />
                  <span />
                  <span />
                  <Lightbulb size={28} strokeWidth={1.3} />
                </div>
                <span className="eyebrow">A GENTLE REMINDER</span>
                <h2>{isRecall ? '把提示放下，把想法留下。' : '你不需要一开始就想清楚。'}</h2>
                <p>
                  {isRecall
                    ? '这不是背诵，也不需要复刻 AI 的句子。试试看，哪些东西真正留在了你的理解里。'
                    : '允许停顿，允许绕一点路。先保留真实的表达，才有值得一起探索的线索。'}
                </p>
                <div className="note-divider" />
                <span className="small muted">没有标准答案，也没有考试式总分。</span>
              </section>
            )}
          </aside>
        </div>
      )}
      {challengeSource && analysis && !isRecall && (
        <section className="panel completed-transcripts">
          <h2>现在，可以回看过去的自己了</h2>
          <p className="small muted">旧表达未参与本次评分。下面仅比较两次真实输出。</p>
          <div className="comparison">
            <div>
              <span className="small muted">上次的原始表达</span>
              <p>{challengeSource.attempts[0]?.confirmed_text}</p>
            </div>
            <div>
              <span className="small orange-text">这次不看旧答案的尝试</span>
              <p>{session?.attempts[0]?.confirmed_text}</p>
            </div>
          </div>
        </section>
      )}
      {completed && (
        <section className="panel completed-transcripts">
          <h2>这次留下的表达</h2>
          {session.attempts.map((a) => (
            <details key={a.id}>
              <summary>
                第 {a.round_no} 轮 ·{' '}
                {a.is_recall ? '练习复述' : a.independent_eligible ? '原始独立表达' : '自主修正'}
                <ChevronDown size={15} />
              </summary>
              <p>{a.confirmed_text}</p>
              {a.analysis && (
                <div className="score-list">
                  {a.analysis.scores.map((s) => (
                    <div key={s.skill}>
                      <span>{skillLabels[s.skill]}</span>
                      <strong>
                        {s.score === null
                          ? '不适用 / 暂未评估'
                          : ['待改进', '部分达标', '本轮达标'][s.score]}
                      </strong>
                      <small>{s.reason}</small>
                    </div>
                  ))}
                </div>
              )}
            </details>
          ))}
        </section>
      )}
    </>
  );
}
