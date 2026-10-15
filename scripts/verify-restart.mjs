import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';

// Isolated local test database. Cookies stay only in this process's memory.
const origin = 'http://127.0.0.1:3200';
let server;
let cookie = '';
async function start() {
  server = spawn(
    process.execPath,
    ['node_modules/next/dist/bin/next', 'start', '-H', '127.0.0.1', '-p', '3200'],
    {
      env: {
        ...process.env,
        OPENAI_API_KEY: '',
        FIRSTPOINT_OPENAI_KEY: '',
        FIRSTPOINT_STORAGE: 'local',
        FIRSTPOINT_ALLOW_LOCAL: 'true',
        FIRSTPOINT_DB_PATH: '.data/restart-check.sqlite',
        APP_ORIGIN: origin,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
  let ready = false;
  server.stdout.on('data', (bytes) => {
    if (bytes.toString().includes('Ready')) ready = true;
  });
  const deadline = Date.now() + 30000;
  while (!ready) {
    if (server.exitCode !== null || Date.now() > deadline)
      throw new Error('Isolated test server did not start (port 3200 must be free).');
    await delay(100);
  }
  const response = await fetch(`${origin}/api/health`);
  assert.equal(response.status, 200);
}
async function stop() {
  if (!server || server.exitCode !== null) return;
  const exited = once(server, 'exit');
  server.kill('SIGTERM');
  await exited;
}
async function api(path, method = 'GET', data) {
  const response = await fetch(`${origin}/api/${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      'X-FirstPoint': '1',
      Origin: origin,
      Cookie: cookie,
    },
    body: data ? JSON.stringify(data) : undefined,
  });
  const issued = response.headers.get('set-cookie');
  if (issued) cookie = issued.split(';')[0];
  assert.equal(response.status, 200, `Request ${path} failed`);
  return response.json();
}
try {
  await start();
  await api('state');
  const session = await api('sessions', 'POST', {
    mode: 'speak',
    scene: 'work',
    idempotency_key: randomUUID(),
  });
  const text = '我建议先确认目标，因为这能帮助大家明确下一步。';
  const attempt = await api('attempts', 'POST', {
    session_id: session.id,
    idempotency_key: randomUUID(),
    text,
  });
  await api('analyze', 'POST', { session_id: session.id, attempt_id: attempt.id });
  await api(`sessions/${session.id}/complete`, 'POST', { final_attempt_id: attempt.id });
  const before = await api('state');
  await stop();
  await start();
  const after = await api('state');
  assert.deepEqual(after.sessions, before.sessions);
  assert.deepEqual(after.memories, before.memories);
  assert.equal(after.sessions[0].attempts[0].confirmed_text, text);
  console.log('PASS: real server restart preserves session, attempts, assessments and Memory.');
} finally {
  await stop();
}
