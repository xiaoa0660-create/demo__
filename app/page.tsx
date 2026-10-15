'use client';
import Link from 'next/link';
import {
  ArrowRight,
  AudioLines,
  BookOpen,
  Check,
  ChevronRight,
  Feather,
  Lightbulb,
  Mic,
  MoveUpRight,
  PenLine,
  ShieldCheck,
  Sparkles,
  Sun,
} from 'lucide-react';
import { useState } from 'react';
import { useApp } from '@/components/app-provider';
import { Mode, scenes } from '@/lib/domain';

export default function HomePage() {
  const { data, setSettings } = useApp();
  const [mode, setMode] = useState<Mode>('think');
  const recent = data?.sessions.filter((s) => s.status !== 'completed').slice(-1)[0];
  const memory = data?.memories.filter((m) => !m.is_frozen && m.status !== 'disputed').at(-1);
  const completed = data?.sessions.filter((s) => s.status === 'completed').length || 0;
  return (
    <>
      <div className="page-heading home-heading">
        <div>
          <div className="eyebrow">
            <span className="tiny-sun" /> A LITTLE SPACE FOR YOUR MIND
          </div>
          <h1>
            今天，想说些什么<span className="orange-text">？</span>
          </h1>
          <p>不必组织好语言。先说出来，一起找到那个重点。</p>
        </div>
        <span className="handwritten greeting">
          从一个念头开始{' '}
          <svg width="55" height="35" viewBox="0 0 55 35" fill="none">
            <path
              d="M3 3Q45 0 42 29M35 23l7 7 6-9"
              stroke="currentColor"
              strokeWidth="1.4"
              strokeLinecap="round"
            />
          </svg>
        </span>
      </div>
      <section className="voice-hero" aria-label="开始表达">
        <div className="hero-copy">
          <span className="pill-label">
            <span />
            先听见自己的声音
          </span>
          <h2>
            零散的想法，
            <br />
            也有一个<span>起点。</span>
          </h2>
          <p>
            一个念头、一个困惑，或一件想讲清楚的事。
            <br className="desktop-only" />
            这里没有标准答案，只有你自己的声音。
          </p>
          <Link href={`/coach?mode=${mode}&input=text`} className="text-entry">
            <PenLine size={16} />
            或者，写下来
            <ArrowRight size={16} />
          </Link>
        </div>
        <div className="hero-visual">
          <div className="orbit orbit-one" />
          <div className="orbit orbit-two" />
          <span className="floating-dot dot-yellow" />
          <span className="floating-dot dot-mint" />
          <span className="floating-dot dot-coral" />
          <span className="floating-dot dot-small" />
          <span className="visual-word word-one">一个念头</span>
          <span className="visual-word word-two">一点好奇</span>
          <svg className="hero-doodle" viewBox="0 0 400 320" aria-hidden="true">
            <path
              d="M70 90C101 61 132 71 141 90M270 235c30 4 49-11 57-34"
              fill="none"
              stroke="#d9c9b4"
              strokeWidth="1.2"
              strokeDasharray="3 6"
            />
            <path
              d="m294 71 5-13m4 18 13-3m-11 11 9 7"
              stroke="#d6b884"
              strokeWidth="1.5"
              strokeLinecap="round"
            />
          </svg>
          <Link
            href={`/coach?mode=${mode}&input=voice`}
            className="hero-record"
            aria-label="开始录音"
          >
            <Mic size={36} strokeWidth={1.5} />
          </Link>
          <div className="record-caption">
            点击，开始说说<small>给自己几分钟就好</small>
          </div>
        </div>
        <div className="hero-bottom">
          <ShieldCheck size={13} />
          你的表达，安心留在你的空间里<span>VOICE FIRST · YOU FIRST</span>
        </div>
      </section>
      <div className="section-heading mode-heading">
        <h2>你想从哪里开始？</h2>
        <span>选一种此刻舒服的方式</span>
      </div>
      <div className="mode-grid" role="group" aria-label="训练模式">
        <button
          className={`mode-card think ${mode === 'think' ? 'selected' : ''}`}
          onClick={() => setMode('think')}
          aria-pressed={mode === 'think'}
        >
          <span className="mode-icon">
            <Lightbulb size={24} strokeWidth={1.5} />
          </span>
          <div>
            <div className="mode-title">
              先理一理 <span>THINK</span>
            </div>
            <p>想法还没成形？把零散的线索慢慢收拢。</p>
            <small>从「我还没想清楚」开始，也很好</small>
          </div>
          <span className="mode-check">
            {mode === 'think' ? <Check size={14} /> : <ArrowRight size={17} />}
          </span>
        </button>
        <button
          className={`mode-card speak ${mode === 'speak' ? 'selected' : ''}`}
          onClick={() => setMode('speak')}
          aria-pressed={mode === 'speak'}
        >
          <span className="mode-icon">
            <AudioLines size={24} strokeWidth={1.5} />
          </span>
          <div>
            <div className="mode-title">
              直接表达 <span>SPEAK</span>
            </div>
            <p>心里有了方向？练习把想法清楚地讲出来。</p>
            <small>工作同步、项目介绍，或一个自己的观点</small>
          </div>
          <span className="mode-check">
            {mode === 'speak' ? <Check size={14} /> : <ArrowRight size={17} />}
          </span>
        </button>
      </div>
      <div className="home-bottom-grid">
        <section className="focus-note">
          <div className="note-kicker">
            <Sun size={17} />
            给今天的一个小提醒<span>ONE SMALL THING</span>
          </div>
          <h3>{memory ? memory.hypothesis : '先找到你最想说的那一句。'}</h3>
          <p>
            {memory
              ? memory.next_action
              : '不用一次讲完所有事情。想一想：如果对方只记住一句话，你希望是哪句？'}
          </p>
          <Link href={memory ? '/memory' : '/coach?mode=speak&scene=work'}>
            {memory ? '翻开这条记忆' : '试着说一说'}
            <ArrowRight size={15} />
          </Link>
          <span className="note-sparkle" aria-hidden="true">
            ✳︎
          </span>
        </section>
        <section className="notebook-card">
          <div className="section-heading">
            <h3>
              <BookOpen size={18} />
              我的练习笔记
            </h3>
            <Link href="/growth" aria-label="查看训练历史">
              <MoveUpRight size={17} />
            </Link>
          </div>
          {recent ? (
            <Link href={`/coach?session=${recent.id}`} className="resume-item">
              <span className="resume-icon">
                <PenLine size={20} />
              </span>
              <div>
                <strong>{recent.topic || scenes[recent.scene].label}</strong>
                <small>有一段未完成的表达，随时接着说</small>
              </div>
              <ChevronRight size={17} />
            </Link>
          ) : (
            <div className="notebook-empty">
              <span className="empty-lines">
                <Feather size={24} />
              </span>
              <div>
                <p>{completed ? `已经留下 ${completed} 次真实表达` : '你的第一篇，留给今天。'}</p>
                <span>
                  {completed
                    ? '每一条记录，都是回看自己的线索。'
                    : '不需要连续打卡，想说的时候就来。'}
                </span>
              </div>
            </div>
          )}
          <div className="notebook-footer">
            <span>
              <span className="green-dot" />
              {completed ? '真实记录，慢慢积累' : '从零开始，也很有意义'}
            </span>
            <Link href="/growth">
              去看看
              <ArrowRight size={13} />
            </Link>
          </div>
        </section>
      </div>
      <div className="gentle-note">
        <Sparkles size={15} />
        <span>AI 帮你找到路，表达仍然由你完成。</span>
        {data && !data.capabilities.ai && (
          <button onClick={() => setSettings(true)}>
            本地文字模式 · AI 尚未连接
            <ChevronRight size={13} />
          </button>
        )}
      </div>
    </>
  );
}
