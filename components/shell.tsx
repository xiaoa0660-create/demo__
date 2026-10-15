'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  AudioLines,
  ArrowUpRight,
  BookOpen,
  ChartNoAxesCombined,
  ChevronRight,
  Home,
  Leaf,
  LockKeyhole,
  Settings2,
  Sun,
} from 'lucide-react';
import { useApp } from './app-provider';
import { SettingsDialog } from './settings';
import { useEffect, useState } from 'react';

const navigation = [
  { href: '/', label: '首页', en: 'A fresh thought', icon: Home },
  { href: '/coach', label: '训练', en: 'Find your first point', icon: AudioLines },
  { href: '/growth', label: '成长', en: 'Little by little', icon: ChartNoAxesCombined },
  { href: '/memory', label: 'Memory', en: 'A notebook of you', icon: BookOpen },
];
export function Brand({ small = false }: { small?: boolean }) {
  return (
    <span className={`brand ${small ? 'small' : ''}`}>
      <span className="brand-mark">
        <i />
        <i />
        <i />
        <i />
        <i />
      </span>
      <span>
        FirstPoint<span className="brand-period">.</span>
      </span>
    </span>
  );
}
export function Shell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { data, error, refresh, settings, setSettings, recording } = useApp();
  const [date, setDate] = useState('让思绪，晒一会儿太阳');
  useEffect(() => {
    setDate(
      new Intl.DateTimeFormat('zh-CN', { month: 'long', day: 'numeric', weekday: 'long' }).format(
        new Date(),
      ),
    );
  }, []);
  const active = navigation.find((n) => n.href === pathname) || navigation[0];
  return (
    <div className={`app-shell ${recording ? 'is-recording' : ''}`}>
      <a className="skip-link" href="#main">
        跳到主要内容
      </a>
      <aside className="sidebar">
        <Link href="/" aria-label="FirstPoint 首页">
          <Brand />
        </Link>
        <p className="brand-caption">留一点空间，给自己的声音。</p>
        <div className="nav-heading">你的思考空间</div>
        <nav aria-label="主导航">
          {navigation.map((n) => (
            <Link
              key={n.href}
              href={n.href}
              className={`nav-item ${pathname === n.href ? 'active' : ''}`}
              aria-current={pathname === n.href ? 'page' : undefined}
            >
              <n.icon size={19} strokeWidth={1.65} />
              <span>
                {n.label}
                <small>{n.en}</small>
              </span>
              {pathname === n.href && <span className="active-dot" />}
            </Link>
          ))}
        </nav>
        <div className="sidebar-note">
          <Sun size={26} strokeWidth={1.2} />
          <p>
            好想法不必着急。
            <br />
            一点一点，
            <br />
            也会变得清晰。
          </p>
          <span>GROW AT YOUR OWN PACE</span>
        </div>
        <div className="sidebar-bottom">
          <button className="settings-button" onClick={() => setSettings(true)}>
            <Settings2 size={18} />
            偏好与设置
            <ChevronRight size={15} />
          </button>
          <div className="profile">
            <span className="avatar">{data?.profile.name.slice(0, 1) || '我'}</span>
            <span>
              {data?.profile.name === '朋友'
                ? '我的私人笔记本'
                : data?.profile.name || '我的私人笔记本'}
              <small>
                <span className="green-dot" />{' '}
                {data?.capabilities.storage === 'supabase' ? '云端私人空间' : '本地私人空间'}
              </small>
            </span>
            <LockKeyhole size={14} />
          </div>
        </div>
      </aside>
      <div className="main-shell">
        <header className="topbar">
          <div className="breadcrumb">
            <span>我的空间</span>
            <ChevronRight size={13} />
            <strong>{active.label}</strong>
          </div>
          <Link href="/" className="mobile-brand">
            <Brand small />
          </Link>
          <div className="topbar-right">
            <span className="date">
              <Sun size={16} />
              {date}
            </span>
            <button className="private-badge" onClick={() => setSettings(true)}>
              <LockKeyhole size={13} />
              <span>只属于你</span>
            </button>
          </div>
        </header>
        <main id="main" className={`main-content page-${pathname.slice(1) || 'home'}`}>
          {error && (
            <div className="notice error" role="alert">
              {error}
              <button onClick={() => void refresh()}>重新连接</button>
            </div>
          )}
          {data && !data.capabilities.signed_in && (
            <div className="notice">
              登录后，训练和记忆会安全保存在你的账户中。
              <button onClick={() => setSettings(true)}>
                登录 / 注册 <ArrowUpRight size={14} />
              </button>
            </div>
          )}
          {children}
        </main>
        <footer className="page-footer">
          <span>
            <Leaf size={13} /> 每一次表达，都离自己近一点。
          </span>
          <span>Think clearly. Speak freely.</span>
        </footer>
      </div>
      <nav className="mobile-nav" aria-label="移动导航">
        {navigation.map((n) => (
          <Link
            key={n.href}
            href={n.href}
            className={pathname === n.href ? 'active' : ''}
            aria-current={pathname === n.href ? 'page' : undefined}
          >
            <n.icon size={21} strokeWidth={1.7} />
            <span>{n.label}</span>
          </Link>
        ))}
      </nav>
      {settings && <SettingsDialog onClose={() => setSettings(false)} />}
    </div>
  );
}
