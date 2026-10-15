import { randomUUID, createHash } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { emptyWorkspace, memoryKey, relevantMemories, Session, Workspace } from '@/lib/domain';
import { AppError, eligibility, growth, rebuildMemories, removeSession } from '@/lib/rules';
import { authenticate, identity, mutate, readState, storageMode } from '@/lib/server/storage';
import { analyze, coach, transcribe } from '@/lib/server/ai';
import { aiConfigured } from '@/lib/server/config';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const registry = globalThis as typeof globalThis & {
  fpLimits?: Map<string, { count: number; until: number }>;
  fpJobs?: Map<string, Promise<unknown>>;
};
const limits = (registry.fpLimits ||= new Map());
const jobs = (registry.fpJobs ||= new Map());
function limit(key: string, max = 60) {
  const now = Date.now();
  if (limits.size > 5000) for (const [k, v] of limits) if (v.until < now) limits.delete(k);
  const bucket = limits.get(key);
  if (bucket && bucket.until > now) {
    if (++bucket.count > max) throw new AppError(429, '操作太频繁，请一分钟后再试。');
  } else limits.set(key, { count: 1, until: now + 60000 });
}
async function singleFlight<T>(key: string, work: () => Promise<T>): Promise<T> {
  if (jobs.has(key)) return jobs.get(key) as Promise<T>;
  const promise = work();
  jobs.set(key, promise);
  try {
    return await promise;
  } finally {
    jobs.delete(key);
  }
}
function sessionOf(state: Workspace, id: string) {
  const session = state.sessions.find((s) => s.id === id);
  if (!session) throw new AppError(404, '找不到这次练习，或你没有访问权限。');
  return session;
}
function writable(session: Session) {
  if (session.status === 'completed') throw new AppError(409, '这次练习已完成，请开始新练习。');
}
const sessionId = z.string().uuid();
async function readLimited(request: Request, max: number) {
  if (Number(request.headers.get('content-length') || 0) > max)
    throw new AppError(413, '内容太大，请分段提交。');
  const reader = request.body?.getReader();
  if (!reader) return new Uint8Array();
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > max) {
      await reader.cancel();
      throw new AppError(413, '内容太大，请分段提交。');
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let at = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, at);
    at += chunk.length;
  }
  return bytes;
}
async function body(request: Request) {
  if (!request.headers.get('content-type')?.includes('application/json'))
    throw new AppError(415, '请使用 JSON 请求。');
  try {
    return JSON.parse(new TextDecoder().decode(await readLimited(request, 60000)));
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError(400, '请求内容无法读取。');
  }
}
function config(signedIn: boolean, email: string | null = null) {
  return {
    storage: storageMode(),
    ai: aiConfigured(),
    signed_in: signedIn,
    email,
    max_audio_seconds: Math.min(300, Math.max(30, Number(process.env.MAX_AUDIO_SECONDS) || 300)),
  };
}
async function route(request: NextRequest, context: { params: Promise<{ path: string[] }> }) {
  try {
    const { path } = await context.params;
    const endpoint = path.join('/');
    const method = request.method;
    if (method !== 'GET') {
      const origin = request.headers.get('origin');
      const url = new URL(request.url);
      const allowed =
        process.env.APP_ORIGIN || `${url.protocol}//${request.headers.get('host') || url.host}`;
      if (request.headers.get('x-firstpoint') !== '1' || (origin && origin !== allowed))
        throw new AppError(403, '请求来源校验失败。');
    }
    if (endpoint === 'health' && method === 'GET')
      return NextResponse.json({ ok: true, app: 'FirstPoint' });
    if (endpoint === 'auth' && method === 'POST') {
      const input = z
        .object({
          action: z.enum(['login', 'register', 'logout']),
          email: z.string().max(254).default(''),
          password: z.string().max(200).default(''),
        })
        .parse(await body(request));
      limit(`auth:${input.email.toLowerCase()}`, 8);
      if (
        input.action !== 'logout' &&
        (!z.email().safeParse(input.email).success || input.password.length < 8)
      )
        throw new AppError(400, '请输入有效邮箱和至少 8 位密码。');
      return NextResponse.json(await authenticate(input.action, input.email, input.password));
    }
    if (endpoint === 'state' && method === 'GET') {
      try {
        const actor = await identity(true);
        const { data } = await readState(actor);
        return NextResponse.json({ ...data, capabilities: config(true, actor.email) });
      } catch (e) {
        if (e instanceof AppError && e.status === 401)
          return NextResponse.json({ ...emptyWorkspace(), capabilities: config(false) });
        throw e;
      }
    }
    const actor = await identity();
    limit(actor.userId);
    if (endpoint === 'sessions' && method === 'POST') {
      const input = z
        .object({
          mode: z.enum(['think', 'speak']),
          scene: z.enum(['work', 'interview', 'opinion', 'free']),
          topic: z.string().max(160).default(''),
          idempotency_key: z.string().uuid(),
          challenge_of: sessionId.nullable().default(null),
          challenge_blinded: z.boolean().default(true),
          quick_advice: z.boolean().default(false),
        })
        .parse(await body(request));
      const session = await mutate(actor, (state) => {
        const existing = state.sessions.find((s) => s.idempotency_key === input.idempotency_key);
        if (existing) return existing;
        const prior = input.challenge_of ? sessionOf(state, input.challenge_of) : null;
        if (prior && prior.status !== 'completed')
          throw new AppError(400, '先完成原练习，再发起挑战。');
        const s: Session = {
          ...input,
          id: randomUUID(),
          task_key: prior?.task_key || randomUUID(),
          difficulty: prior?.difficulty || 1,
          topic: prior?.topic || input.topic,
          mode: prior?.mode || input.mode,
          scene: prior?.scene || input.scene,
          status: 'draft',
          created_at: new Date().toISOString(),
          completed_at: null,
          attempts: [],
          hints: [],
          selected_point_id: null,
          point_corrections: {},
          removed_relations: [],
          feedback: null,
          transcripts: [],
          usage: { requests: 0, input_tokens: 0, output_tokens: 0 },
        };
        state.sessions.push(s);
        return s;
      });
      return NextResponse.json(session);
    }
    if (path[0] === 'sessions' && path.length === 2) {
      if (method === 'GET')
        return NextResponse.json(sessionOf((await readState(actor)).data, path[1]));
      if (method === 'DELETE') {
        await mutate(actor, (state) => removeSession(state, path[1]));
        return NextResponse.json({ deleted: true });
      }
      if (method === 'PATCH') {
        const input = z
          .object({
            selected_point_id: z.string().nullable().optional(),
            point_id: z.string().optional(),
            correction: z.string().max(100).optional(),
            remove_relation: z.string().optional(),
            recall: z.boolean().optional(),
            quick_advice: z.literal(true).optional(),
          })
          .parse(await body(request));
        return NextResponse.json(
          await mutate(actor, (state) => {
            const s = sessionOf(state, path[1]);
            writable(s);
            const analysis = s.attempts.at(-1)?.analysis;
            if (input.quick_advice) {
              if (s.attempts.length) throw new AppError(409, '已有尝试，请从提示阶梯查看示范。');
              s.quick_advice = true;
            }
            if (input.selected_point_id !== undefined) {
              if (
                input.selected_point_id &&
                !analysis?.points.some((p) => p.id === input.selected_point_id)
              )
                throw new AppError(400, '请选择已有的语义点。');
              s.selected_point_id = input.selected_point_id;
            }
            if (input.point_id && input.correction) {
              if (!analysis?.points.some((p) => p.id === input.point_id))
                throw new AppError(400, '找不到语义点。');
              s.point_corrections[input.point_id] = input.correction;
            }
            if (
              input.remove_relation &&
              analysis?.relations.some((r) => `${r.from}:${r.to}` === input.remove_relation)
            )
              s.removed_relations.push(input.remove_relation);
            if (input.recall) {
              if (!analysis || s.attempts.length >= 3)
                throw new AppError(409, '请先完成前一轮分析，最多练习三轮。');
              s.status = 'final_assessment';
            }
            return s;
          }),
        );
      }
    }
    if (endpoint === 'attempts' && method === 'POST') {
      const input = z
        .object({
          session_id: sessionId,
          text: z.string().trim().min(2).max(10000),
          idempotency_key: z.string().uuid(),
          origin: z.enum(['text', 'voice']).default('text'),
          transcript_id: z.string().uuid().nullable().default(null),
        })
        .parse(await body(request));
      const attempt = await mutate(actor, (state) => {
        const s = sessionOf(state, input.session_id);
        const existing = s.attempts.find((a) => a.idempotency_key === input.idempotency_key);
        if (existing) {
          if (existing.confirmed_text !== input.text)
            throw new AppError(409, '此提交已保存，请开始下一轮。');
          return existing;
        }
        writable(s);
        if (s.attempts.length >= 3)
          throw new AppError(409, '这轮已经尝试三次，休息一下再开始新的话题。');
        if (s.attempts.length && !s.attempts.at(-1)?.analysis)
          throw new AppError(409, '请先重试上一轮分析，原文已经保存。');
        const transcript = s.transcripts.find((t) => t.id === input.transcript_id);
        if (input.origin === 'voice' && !transcript)
          throw new AppError(400, '请先完成转写并确认原文。');
        const a = {
          id: randomUUID(),
          idempotency_key: input.idempotency_key,
          round_no: s.attempts.length + 1,
          origin: input.origin,
          confirmed_text: input.text,
          raw_asr_text: transcript?.text || null,
          duration_ms: transcript?.duration_ms || null,
          ...eligibility(state, s, input.text),
          is_recall: s.status === 'final_assessment',
          created_at: new Date().toISOString(),
          analysis: null,
        };
        if (!s.attempts.length && !s.challenge_of)
          s.task_key = createHash('sha256')
            .update(`${s.scene}:${s.topic || input.text.replace(/\s/g, '')}`)
            .digest('hex');
        s.attempts.push(a);
        s.status = 'analyzing';
        return a;
      });
      return NextResponse.json(attempt);
    }
    if (endpoint === 'analyze' && method === 'POST') {
      const input = z
        .object({ session_id: sessionId, attempt_id: sessionId })
        .parse(await body(request));
      limit(`model:${actor.userId}`, 12);
      const result = await singleFlight(`${actor.userId}:analyze:${input.attempt_id}`, async () => {
        const { data } = await readState(actor);
        const s = sessionOf(data, input.session_id);
        const a = s.attempts.find((a) => a.id === input.attempt_id);
        if (!a) throw new AppError(404, '找不到本轮表达。');
        if (a.analysis) return a.analysis;
        writable(s);
        try {
          const result = await analyze(s, a.id);
          return await mutate(actor, (state) => {
            const current = sessionOf(state, s.id);
            writable(current);
            const attempt = current.attempts.find((a) => a.id === input.attempt_id)!;
            if (attempt.analysis) return attempt.analysis;
            attempt.analysis = result.analysis;
            current.status = 'feedback_ready';
            // Sending coaching feedback is itself assistance for all following attempts.
            current.hints.push({
              level: 1,
              text: result.analysis.next_action,
              created_at: new Date().toISOString(),
              memory_ids: [],
            });
            for (const key of ['requests', 'input_tokens', 'output_tokens'] as const)
              current.usage[key] += result.usage[key];
            return result.analysis;
          });
        } catch (e) {
          await mutate(actor, (state) => {
            const current = state.sessions.find((s) => s.id === input.session_id);
            if (current && current.status !== 'completed') current.status = 'failed_retryable';
          });
          throw e;
        }
      });
      return NextResponse.json(result);
    }
    if (endpoint === 'coach' && method === 'POST') {
      const input = z
        .object({ session_id: sessionId, hint_level: z.number().int().min(1).max(3) })
        .parse(await body(request));
      const { data } = await readState(actor);
      const s = sessionOf(data, input.session_id);
      writable(s);
      if (!s.attempts.at(-1)?.analysis || s.status === 'final_assessment')
        throw new AppError(409, '请先完成本轮表达与分析。');
      limit(`model:${actor.userId}`, 12);
      const memories = input.hint_level === 3 ? relevantMemories(data, s.scene) : [];
      const result = await coach(s, input.hint_level, memories);
      const hint = await mutate(actor, (state) => {
        const current = sessionOf(state, s.id);
        writable(current);
        if (current.status === 'final_assessment')
          throw new AppError(409, '已进入隐藏提示复述，请先完成这一轮。');
        const hint = {
          level: input.hint_level,
          text: result.text,
          created_at: new Date().toISOString(),
          memory_ids: memories.map((m) => m.id),
        };
        for (const key of ['requests', 'input_tokens', 'output_tokens'] as const)
          current.usage[key] += result.usage[key];
        current.hints.push(hint);
        return hint;
      });
      return NextResponse.json(hint);
    }
    if (path[0] === 'sessions' && path[2] === 'complete' && method === 'POST') {
      const input = z
        .object({
          final_attempt_id: sessionId,
          feedback: z.enum(['understood', 'questioned', 'unsure']).nullable().default(null),
        })
        .parse(await body(request));
      return NextResponse.json(
        await mutate(actor, (state) => {
          const s = sessionOf(state, path[1]);
          if (s.status === 'completed') return { session: s, persisted: true };
          const final = s.attempts.at(-1);
          if (final?.id !== input.final_attempt_id || !final.analysis)
            throw new AppError(409, '请完成最后一轮分析后再保存。');
          s.status = 'completed';
          s.completed_at = new Date().toISOString();
          s.feedback = input.feedback;
          s.transcripts = []; // Raw ASR required for evidence is retained only in its submitted attempt.
          rebuildMemories(state);
          return { session: s, persisted: true };
        }),
      );
    }
    if (endpoint === 'transcribe' && method === 'POST') {
      limit(`model:${actor.userId}`, 12);
      const bytes = await readLimited(request, 13 * 1024 * 1024);
      const form = await new Request(request.url, {
        method: 'POST',
        headers: { 'content-type': request.headers.get('content-type') || '' },
        body: bytes,
      }).formData();
      const sid = sessionId.parse(form.get('session_id'));
      const key = z.string().uuid().parse(form.get('idempotency_key'));
      const s = sessionOf((await readState(actor)).data, sid);
      writable(s);
      const cached = s.transcripts.find((t) => t.key === key);
      if (cached) return NextResponse.json(cached);
      const file = form.get('audio');
      if (
        !(file instanceof File) ||
        file.size < 50 ||
        file.size > 12 * 1024 * 1024 ||
        !/^(audio|video)\/(webm|mp4|mpeg|ogg|wav|x-wav)/.test(file.type)
      )
        throw new AppError(400, '请上传不超过 12 MB 的录音（WebM、MP4、MP3、OGG 或 WAV）。');
      const duration = Number(form.get('duration_ms'));
      if (
        !Number.isFinite(duration) ||
        duration < 0 ||
        duration > config(true).max_audio_seconds * 1000 + 2000
      )
        throw new AppError(400, '录音时长超出限制，请分段表达。');
      return NextResponse.json(
        await singleFlight(`${actor.userId}:asr:${key}`, async () => {
          const text = await transcribe(file);
          const item = { id: randomUUID(), key, text, duration_ms: duration };
          return mutate(actor, (state) => {
            const s = sessionOf(state, sid);
            writable(s);
            const existing = s.transcripts.find((t) => t.key === key);
            if (existing) return existing;
            s.transcripts.push(item);
            s.status = 'transcript_review';
            s.usage.requests++;
            return item;
          });
        }),
      );
    }
    if (endpoint === 'memory' && method === 'GET')
      return NextResponse.json((await readState(actor)).data.memories);
    if (path[0] === 'memory' && path.length === 2 && method === 'PATCH') {
      const input = z
        .object({
          action: z.enum(['confirm', 'correct', 'freeze', 'delete']),
          correction: z.string().trim().max(500).optional(),
        })
        .parse(await body(request));
      return NextResponse.json(
        await mutate(actor, (state) => {
          const m = state.memories.find((m) => m.id === path[1]);
          if (!m) throw new AppError(404, '找不到这条记忆。');
          const old = structuredClone(m);
          if (input.action === 'delete') {
            state.memories = state.memories.filter((item) => item.id !== m.id);
            state.memory_versions = state.memory_versions.filter((v) => v.memory_id !== m.id);
            state.suppressed_memories.push(memoryKey(m));
            for (const s of state.sessions)
              s.hints = s.hints.map((h) =>
                h.memory_ids.includes(m.id)
                  ? { ...h, text: '关联记忆已删除，提示内容已清理。', memory_ids: [] }
                  : h,
              );
            return { deleted: true };
          }
          if (input.action === 'correct') {
            if (!input.correction) throw new AppError(400, '请写下你的纠正。');
            m.hypothesis = input.correction;
            m.status = 'disputed';
            m.is_frozen = true;
          }
          if (input.action === 'freeze') m.is_frozen = true;
          if (input.action === 'confirm') {
            m.status = 'observing';
            m.is_frozen = false;
          }
          m.updated_at = new Date().toISOString();
          state.memory_versions.push({
            id: randomUUID(),
            memory_id: m.id,
            old_value: old,
            new_value: structuredClone(m),
            reason: input.action,
            actor: 'user',
            created_at: m.updated_at,
          });
          return m;
        }),
      );
    }
    if (endpoint === 'profile' && method === 'PATCH') {
      const input = z
        .object({
          name: z.string().trim().min(1).max(30).optional(),
          consent_memory: z.boolean().optional(),
          timezone: z.string().max(100).optional(),
        })
        .parse(await body(request));
      if (input.timezone) {
        try {
          new Intl.DateTimeFormat('en', { timeZone: input.timezone });
        } catch {
          throw new AppError(400, '时区无效。');
        }
      }
      return NextResponse.json(
        await mutate(actor, (state) => {
          Object.assign(state.profile, input);
          return state.profile;
        }),
      );
    }
    if (endpoint === 'growth' && method === 'GET') {
      const scene = z
        .enum(['work', 'interview', 'opinion', 'free'])
        .parse(request.nextUrl.searchParams.get('scene') || 'work');
      const days = z.coerce
        .number()
        .int()
        .min(7)
        .max(365)
        .parse(request.nextUrl.searchParams.get('window') || '30');
      return NextResponse.json(growth((await readState(actor)).data, scene, days));
    }
    if (endpoint === 'export' && method === 'POST')
      return NextResponse.json(
        { exported_at: new Date().toISOString(), ...(await readState(actor)).data },
        { headers: { 'Content-Disposition': 'attachment; filename="firstpoint-export.json"' } },
      );
    if (endpoint === 'me/data' && method === 'DELETE') {
      const input = z
        .object({ confirmation: z.literal('删除所有记录') })
        .parse(await body(request));
      if (input.confirmation)
        await mutate(actor, (state) => {
          Object.assign(state, emptyWorkspace());
        });
      return NextResponse.json({ deleted: true });
    }
    throw new AppError(404, '接口不存在。');
  } catch (error) {
    if (error instanceof z.ZodError)
      return NextResponse.json(
        { error: '输入不符合要求，请检查内容或刷新后重试。', code: 'INVALID_INPUT' },
        { status: 400 },
      );
    if (error instanceof AppError)
      return NextResponse.json(
        { error: error.message, code: error.code },
        { status: error.status },
      );
    // Never log provider messages, transcripts, cookies or request bodies.
    return NextResponse.json(
      { error: '服务暂时不可用，已保存的内容不受影响，请重试。', code: 'INTERNAL_ERROR' },
      { status: 500 },
    );
  }
}
export { route as GET, route as POST, route as PATCH, route as DELETE };
