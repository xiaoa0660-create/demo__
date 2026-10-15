import { beforeEach, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { NextRequest } from 'next/server';
import { localObservation } from '../../lib/rules';
import { Session } from '../../lib/domain';

const mocks = vi.hoisted(() => ({
  jar: new Map<string, string>(),
  analyze: vi.fn(),
  transcribe: vi.fn(),
}));
vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (name: string) => (mocks.jar.has(name) ? { name, value: mocks.jar.get(name) } : undefined),
    set: (name: string, value: string) => mocks.jar.set(name, value),
    delete: (name: string) => mocks.jar.delete(name),
    getAll: () => [...mocks.jar].map(([name, value]) => ({ name, value })),
  }),
}));
vi.mock('../../lib/server/ai', () => ({
  analyze: mocks.analyze,
  transcribe: mocks.transcribe,
  coach: vi.fn(),
}));
process.env.FIRSTPOINT_STORAGE = 'local';
process.env.FIRSTPOINT_ALLOW_LOCAL = 'true';
process.env.FIRSTPOINT_DB_PATH = `.data/api-test-${randomUUID()}.sqlite`;
import { GET } from '../../app/api/[...path]/route';
async function request(path: string, method = 'GET', value?: unknown) {
  const headers = {
    'X-FirstPoint': '1',
    Host: 'firstpoint.test',
    Origin: 'http://firstpoint.test',
    ...(value instanceof FormData ? {} : { 'content-type': 'application/json' }),
  };
  const req = new NextRequest(`http://firstpoint.test/api/${path}`, {
    method,
    headers,
    body:
      value === undefined ? undefined : value instanceof FormData ? value : JSON.stringify(value),
  });
  return GET(req, { params: Promise.resolve({ path: path.split('/') }) });
}
async function session() {
  await request('state');
  const r = await request('sessions', 'POST', {
    mode: 'speak',
    scene: 'work',
    idempotency_key: randomUUID(),
  });
  return r.json();
}
describe('real route, auth and SQLite persistence with mocked AI transport', () => {
  beforeEach(() => {
    mocks.jar.clear();
    vi.clearAllMocks();
  });
  it('late guest cookies cannot replace a logged-in account', async () => {
    const original = await session();
    const email = `race-${randomUUID()}@example.test`;
    const password = `test-only-${randomUUID()}`;
    expect((await request('auth', 'POST', { action: 'register', email, password })).status).toBe(
      200,
    );
    const accountCookie = mocks.jar.get('fp_session')!;
    mocks.jar.clear();
    await request('state');
    const lateGuestCookie = mocks.jar.get('fp_guest')!;
    mocks.jar.set('fp_session', accountCookie);
    mocks.jar.set('fp_guest', lateGuestCookie);
    const state = await (await request('state')).json();
    expect(state.capabilities.email).toBe(email);
    expect(state.sessions[0].id).toBe(original.id);
  });
  it('retains raw ASR separately while analysis receives corrected text; transcription is idempotent', async () => {
    const s = await session();
    mocks.transcribe.mockResolvedValue('标签只保留九天，嗯，要不要暂停？');
    const key = randomUUID();
    const form = () => {
      const f = new FormData();
      f.append('session_id', s.id);
      f.append('idempotency_key', key);
      f.append('duration_ms', '30000');
      f.append('audio', new File(['x'.repeat(100)], 'test.webm', { type: 'audio/webm' }));
      return f;
    };
    const transcribed = await (await request('transcribe', 'POST', form())).json();
    expect(transcribed.text).toContain('九天');
    const repeated = await (await request('transcribe', 'POST', form())).json();
    expect(repeated.id).toBe(transcribed.id);
    expect(mocks.transcribe).toHaveBeenCalledTimes(1);
    const corrected = '标签只保留90天，嗯，要不要暂停？';
    const a = await (
      await request('attempts', 'POST', {
        session_id: s.id,
        idempotency_key: randomUUID(),
        text: corrected,
        origin: 'voice',
        transcript_id: transcribed.id,
      })
    ).json();
    expect(a.raw_asr_text).toContain('九天');
    expect(a.confirmed_text).toBe(corrected);
    mocks.analyze.mockImplementation(async (s: Session) => ({
      analysis: localObservation(s.attempts[0].confirmed_text, s),
      usage: { requests: 0, input_tokens: 0, output_tokens: 0 },
    }));
    const analyzed = await request('analyze', 'POST', { session_id: s.id, attempt_id: a.id });
    expect(analyzed.status).toBe(200);
    expect(mocks.analyze.mock.calls[0][0].attempts[0].confirmed_text).toBe(corrected);
  });
  it('failed analysis preserves the original attempt and successful retry does not duplicate it', async () => {
    const s = await session();
    const a = await (
      await request('attempts', 'POST', {
        session_id: s.id,
        idempotency_key: randomUUID(),
        text: '我建议暂停这个任务。',
      })
    ).json();
    mocks.analyze.mockRejectedValueOnce(new Error('invalid model schema'));
    expect((await request('analyze', 'POST', { session_id: s.id, attempt_id: a.id })).status).toBe(
      500,
    );
    let saved = await (await request(`sessions/${s.id}`)).json();
    expect(saved.attempts).toHaveLength(1);
    expect(saved.attempts[0].analysis).toBeNull();
    expect(saved.status).toBe('failed_retryable');
    mocks.analyze.mockImplementation(async (s: Session) => ({
      analysis: localObservation(s.attempts[0].confirmed_text, s),
      usage: { requests: 0, input_tokens: 0, output_tokens: 0 },
    }));
    expect((await request('analyze', 'POST', { session_id: s.id, attempt_id: a.id })).status).toBe(
      200,
    );
    saved = await (await request(`sessions/${s.id}`)).json();
    expect(saved.attempts).toHaveLength(1);
    expect(saved.attempts[0].analysis).not.toBeNull();
  });
  it('full data deletion removes attempts, memory, audits and transcript drafts', async () => {
    const s = await session();
    await request('attempts', 'POST', {
      session_id: s.id,
      idempotency_key: randomUUID(),
      text: '私密测试原文。',
    });
    expect((await request('me/data', 'DELETE', { confirmation: 'wrong' })).status).toBe(400);
    expect((await request('me/data', 'DELETE', { confirmation: '删除所有记录' })).status).toBe(200);
    const exported = await (await request('export', 'POST', {})).json();
    expect(exported.sessions).toHaveLength(0);
    expect(JSON.stringify(exported)).not.toContain('私密测试原文');
  });
});
