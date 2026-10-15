import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { createHash, randomBytes, randomUUID, scryptSync, timingSafeEqual } from 'node:crypto';
import { cookies } from 'next/headers';
import { createServerClient } from '@supabase/ssr';
import type { SupabaseClient } from '@supabase/supabase-js';
import { emptyWorkspace, Workspace } from '@/lib/domain';
import { AppError } from '@/lib/rules';

const globalDb = globalThis as typeof globalThis & { firstpointDb?: DatabaseSync };
function initialWorkspace() {
  const state = emptyWorkspace();
  if (process.env.MEMORY_ENABLED === 'false') state.profile.consent_memory = false;
  return state;
}
export function database() {
  if (!globalDb.firstpointDb) {
    const path = resolve(process.env.FIRSTPOINT_DB_PATH || '.data/firstpoint.sqlite');
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    const db = new DatabaseSync(path);
    db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, email TEXT UNIQUE, password TEXT);
      CREATE TABLE IF NOT EXISTS auth_sessions (token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, expires_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS workspaces (user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE, revision INTEGER NOT NULL DEFAULT 0, data TEXT NOT NULL);`);
    globalDb.firstpointDb = db;
  }
  return globalDb.firstpointDb;
}
export function storageMode() {
  const mode =
    process.env.FIRSTPOINT_STORAGE || (process.env.NEXT_PUBLIC_SUPABASE_URL ? 'supabase' : 'local');
  if (mode !== 'local' && mode !== 'supabase') throw new AppError(503, '存储配置无效。');
  if (
    mode === 'local' &&
    process.env.NODE_ENV === 'production' &&
    process.env.FIRSTPOINT_ALLOW_LOCAL !== 'true'
  )
    throw new AppError(
      503,
      '正式部署需要配置 Supabase；本地自托管请显式启用 FIRSTPOINT_ALLOW_LOCAL。',
    );
  return mode;
}
export async function supabase() {
  const jar = await cookies();
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) throw new AppError(503, '请配置 Supabase URL 和公开 anon key。');
  return createServerClient(url, key, {
    cookies: {
      getAll: () => jar.getAll(),
      setAll: (list) => list.forEach((c) => jar.set(c.name, c.value, c.options)),
    },
  });
}
export type Identity = {
  userId: string;
  email: string | null;
  mode: 'local' | 'supabase';
  client?: SupabaseClient;
};
const hash = (text: string) => createHash('sha256').update(text).digest('hex');
export async function identity(createGuest = false): Promise<Identity> {
  const mode = storageMode();
  if (mode === 'supabase') {
    const client = await supabase();
    const { data, error } = await client.auth.getUser();
    if (error || !data.user)
      throw new AppError(401, '请登录，让练习和 Memory 在你的设备间同步。', 'AUTH_REQUIRED');
    return { userId: data.user.id, email: data.user.email || null, mode, client };
  }
  const jar = await cookies();
  const db = database();
  // A late anonymous bootstrap response must never overwrite an authenticated cookie.
  for (const name of ['fp_session', 'fp_guest']) {
    const token = jar.get(name)?.value;
    const user = token
      ? (db
          .prepare(
            'SELECT u.id, u.email FROM auth_sessions a JOIN users u ON u.id=a.user_id WHERE token_hash=? AND expires_at>?',
          )
          .get(hash(token), Date.now()) as { id: string; email: string | null } | undefined)
      : undefined;
    if (user) return { userId: user.id, email: user.email, mode };
  }
  if (!createGuest) throw new AppError(401, '会话已过期，请刷新后重新开始。', 'AUTH_REQUIRED');
  const id = randomUUID();
  db.prepare('INSERT INTO users(id) VALUES(?)').run(id);
  await issueLocalSession(id, true);
  return { userId: id, email: null, mode };
}
async function issueLocalSession(userId: string, guest = false) {
  const db = database();
  const jar = await cookies();
  const cookieName = guest ? 'fp_guest' : 'fp_session';
  const previous = jar.get(cookieName)?.value;
  if (previous) db.prepare('DELETE FROM auth_sessions WHERE token_hash=?').run(hash(previous));
  if (!guest) {
    const oldGuest = jar.get('fp_guest')?.value;
    if (oldGuest) db.prepare('DELETE FROM auth_sessions WHERE token_hash=?').run(hash(oldGuest));
    jar.delete('fp_guest');
  }
  const token = randomBytes(32).toString('base64url');
  db.prepare('DELETE FROM auth_sessions WHERE expires_at < ?').run(Date.now());
  db.prepare('INSERT INTO auth_sessions VALUES(?,?,?)').run(
    hash(token),
    userId,
    Date.now() + 30 * 86400000,
  );
  jar.set(cookieName, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.APP_ORIGIN?.startsWith('https://') || false,
    path: '/',
    maxAge: 30 * 86400,
  });
}
export async function authenticate(
  action: 'login' | 'register' | 'logout',
  email: string,
  password: string,
) {
  if (storageMode() === 'supabase') {
    const client = await supabase();
    if (action === 'logout') {
      await client.auth.signOut();
      return { message: '已退出登录。' };
    }
    const result =
      action === 'register'
        ? await client.auth.signUp({ email, password })
        : await client.auth.signInWithPassword({ email, password });
    if (result.error)
      throw new AppError(
        400,
        action === 'login' ? '登录失败，请检查邮箱和密码。' : '注册未完成，请检查邮箱或稍后重试。',
      );
    return { message: result.data.session ? '登录成功。' : '请到邮箱确认注册，再返回登录。' };
  }
  const db = database();
  if (action === 'logout') {
    const jar = await cookies();
    for (const name of ['fp_session', 'fp_guest']) {
      const token = jar.get(name)?.value;
      if (token) db.prepare('DELETE FROM auth_sessions WHERE token_hash=?').run(hash(token));
      jar.delete(name);
    }
    return { message: '已退出登录。' };
  }
  const normalized = email.trim().toLowerCase();
  const existing = db.prepare('SELECT id,password FROM users WHERE email=?').get(normalized) as
    { id: string; password: string } | undefined;
  if (action === 'register') {
    if (existing) throw new AppError(400, '该邮箱暂时无法注册，请尝试登录。');
    const salt = randomBytes(16).toString('hex');
    const saved = `${salt}:${scryptSync(password, salt, 64).toString('hex')}`;
    const current = await identity(true);
    if (current.email) throw new AppError(409, '请先退出当前账户。');
    db.prepare('UPDATE users SET email=?,password=? WHERE id=?').run(
      normalized,
      saved,
      current.userId,
    );
    await issueLocalSession(current.userId);
  } else {
    const [salt, value] = (existing?.password || 'dummy:').split(':');
    const actual = scryptSync(password, salt, 64);
    const expected = value ? Buffer.from(value, 'hex') : Buffer.alloc(64);
    if (!existing || !timingSafeEqual(actual, expected))
      throw new AppError(400, '邮箱或密码不正确。');
    await issueLocalSession(existing.id);
  }
  return { message: '登录成功，记录已同步。' };
}
export async function readState(actor: Identity): Promise<{ data: Workspace; revision: number }> {
  if (actor.mode === 'local') {
    const db = database();
    db.prepare('INSERT OR IGNORE INTO workspaces(user_id,data) VALUES(?,?)').run(
      actor.userId,
      JSON.stringify(initialWorkspace()),
    );
    const row = db
      .prepare('SELECT data,revision FROM workspaces WHERE user_id=?')
      .get(actor.userId) as { data: string; revision: number };
    return { data: JSON.parse(row.data), revision: row.revision };
  }
  const { data, error } = await actor
    .client!.from('workspaces')
    .select('data,revision')
    .eq('user_id', actor.userId)
    .maybeSingle();
  if (error)
    throw new AppError(503, '云端数据读取失败，请确认数据库迁移已应用。', 'STORAGE_UNAVAILABLE');
  return data || { data: initialWorkspace(), revision: -1 };
}
export async function mutate<T>(actor: Identity, change: (state: Workspace) => T): Promise<T> {
  // Compare-and-swap gives both adapters atomic, retryable mutations. Never call a model inside change().
  for (let retry = 0; retry < 5; retry++) {
    const { data, revision } = await readState(actor);
    const result = change(data);
    if (actor.mode === 'local') {
      const update = database()
        .prepare('UPDATE workspaces SET data=?,revision=revision+1 WHERE user_id=? AND revision=?')
        .run(JSON.stringify(data), actor.userId, revision);
      if (update.changes) return result;
    } else {
      const { data: saved, error } = await actor.client!.rpc('save_workspace', {
        expected_revision: revision,
        next_data: data,
      });
      if (error) throw new AppError(503, '保存暂未完成，请重试。', 'STORAGE_UNAVAILABLE');
      if (saved) return result;
    }
  }
  throw new AppError(409, '另一个设备更新了这份记录，请刷新后重试。', 'WRITE_CONFLICT');
}
