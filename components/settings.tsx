'use client';
import { useEffect, useRef, useState } from 'react';
import { Check, Download, LogOut, Settings2, ShieldCheck, Trash2, X } from 'lucide-react';
import { api, useApp } from './app-provider';

export function Dialog({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    dialog.current?.showModal();
    const el = dialog.current;
    return () => el?.close();
  }, []);
  return (
    <dialog
      ref={dialog}
      className="dialog"
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="dialog-inner">
        <div className="dialog-header">
          <h2>{title}</h2>
          <button className="icon-button" aria-label="关闭" onClick={onClose}>
            <X size={20} />
          </button>
        </div>
        {children}
      </div>
    </dialog>
  );
}
export function SettingsDialog({ onClose }: { onClose: () => void }) {
  const { data, refresh, toast } = useApp();
  const [name, setName] = useState(data?.profile.name || '朋友');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [deleting, setDeleting] = useState(false);
  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError('');
    try {
      await fn();
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const auth = (action: 'login' | 'register' | 'logout') =>
    run(async () => {
      const result = await api<{ message: string }>('auth', 'POST', { action, email, password });
      toast(result.message);
      setPassword('');
      if (action === 'login' || action === 'logout') {
        Object.keys(localStorage)
          .filter((key) => key.startsWith('fp-draft:'))
          .forEach((key) => localStorage.removeItem(key));
        // Discard in-memory views from the previous account as well as drafts.
        window.location.assign('/');
      }
    });
  const exportData = () =>
    run(async () => {
      const archive = await api('export', 'POST', {});
      const url = URL.createObjectURL(
        new Blob([JSON.stringify(archive, null, 2)], { type: 'application/json' }),
      );
      const a = document.createElement('a');
      a.href = url;
      a.download = 'firstpoint-export.json';
      a.click();
      URL.revokeObjectURL(url);
      toast('数据已导出到下载文件。');
    });
  return (
    <Dialog title="你的私人空间" onClose={onClose}>
      <p className="muted">名字、记忆和数据，都由你决定。</p>
      {error && (
        <p role="alert" className="notice error">
          {error}
        </p>
      )}
      <section className="settings-section">
        <h3>
          <Settings2 size={17} />
          个人偏好
        </h3>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void run(async () => {
              await api('profile', 'PATCH', { name });
              toast('称呼已保存。');
            });
          }}
        >
          <label htmlFor="profile-name">希望怎么称呼你？</label>
          <div className="input-row">
            <input
              id="profile-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={30}
              required
            />
            <button className="button secondary" disabled={busy || !data?.capabilities.signed_in}>
              <Check size={16} />
              保存
            </button>
          </div>
        </form>
      </section>
      <section className="settings-section">
        <h3>
          <ShieldCheck size={17} />
          连接与隐私
        </h3>
        <div className="connection-row">
          <span>训练记录</span>
          <span className="tag mint">
            {data?.capabilities.storage === 'supabase' ? 'Supabase 云端' : '本地 SQLite 持久化'}
          </span>
        </div>
        <div className="connection-row">
          <span>AI 教练与转写</span>
          <span className={`tag ${data?.capabilities.ai ? 'mint' : 'sand'}`}>
            {data?.capabilities.ai ? '已配置 · 按请求验证' : '尚未连接'}
          </span>
        </div>
        <p className="small muted">
          {data?.capabilities.ai
            ? '确认后的文字和本次录音会发送至 OpenAI 处理；应用不持久保存原始音频。结构分析请求禁用响应存储。'
            : '当前可使用本地文字结构观察，不提供 AI 评分或语音转写。正式使用需在服务端配置 OpenAI。'}{' '}
          原文不写入应用日志。
        </p>
        {data?.capabilities.storage === 'local' && (
          <p className="small muted">
            本地模式用于开发或私人自托管。记录保存在这台服务器；连接 Supabase
            后使用云端账户，本地数据不会自动迁移。
          </p>
        )}
      </section>
      <section className="settings-section">
        <h3>{data?.capabilities.email ? '已登录' : '让笔记跟着你'}</h3>
        {data?.capabilities.email ? (
          <div className="input-row">
            <span>{data.capabilities.email}</span>
            <button
              className="button secondary"
              onClick={() => void auth('logout')}
              disabled={busy}
            >
              <LogOut size={16} />
              退出
            </button>
          </div>
        ) : (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void auth('login');
            }}
          >
            <label htmlFor="email">邮箱</label>
            <input
              id="email"
              type="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
            <label htmlFor="password">密码（至少 8 位）</label>
            <input
              id="password"
              type="password"
              autoComplete="current-password"
              minLength={8}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
            <div className="button-row">
              <button className="button primary" disabled={busy}>
                登录
              </button>
              <button
                className="button secondary"
                type="button"
                disabled={busy || password.length < 8 || !email}
                onClick={() => void auth('register')}
              >
                创建账户
              </button>
            </div>
          </form>
        )}
      </section>
      <section className="settings-section">
        <h3>数据控制</h3>
        <div className="button-row">
          <button
            className="button secondary"
            disabled={busy || !data?.capabilities.signed_in}
            onClick={() => void exportData()}
          >
            <Download size={16} />
            导出我的数据
          </button>
          <button
            className="button danger-subtle"
            onClick={() => setDeleting(!deleting)}
            disabled={busy}
          >
            <Trash2 size={16} />
            清空训练记录
          </button>
        </div>
        {deleting && (
          <div className="delete-box">
            <p>这会删除原文、评测、Memory 和版本记录。账户会保留。建议先导出。</p>
            <label htmlFor="delete-confirm">输入「删除所有记录」确认</label>
            <input
              id="delete-confirm"
              value={confirmation}
              onChange={(e) => setConfirmation(e.target.value)}
            />
            <button
              className="button danger"
              disabled={busy || confirmation !== '删除所有记录'}
              onClick={() =>
                void run(async () => {
                  await api('me/data', 'DELETE', { confirmation });
                  Object.keys(localStorage)
                    .filter((k) => k.startsWith('fp-draft:'))
                    .forEach((k) => localStorage.removeItem(k));
                  setDeleting(false);
                  toast('所有训练记录已删除。');
                })
              }
            >
              确认永久删除
            </button>
          </div>
        )}
      </section>
    </Dialog>
  );
}
