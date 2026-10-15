import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { evidenceState } from '../fixtures';

const alice = '00000000-0000-4000-8000-000000000001';
const bob = '00000000-0000-4000-8000-000000000002';
let db: PGlite;
async function asUser(id: string) {
  await db.exec(
    `reset role; set role authenticated; select set_config('request.jwt.claim.sub', '${id}', false);`,
  );
}
describe('PostgreSQL RLS and atomic storage (actual migration)', () => {
  beforeAll(async () => {
    db = new PGlite();
    await db.exec(`create role authenticated; create role anon; create schema auth; create table auth.users(id uuid primary key);
      create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
      grant usage on schema auth to authenticated,anon; grant execute on function auth.uid() to authenticated,anon;
      insert into auth.users values ('${alice}'),('${bob}');`);
    await db.exec(readFileSync('supabase/migrations/202610140001_firstpoint.sql', 'utf8'));
    await asUser(alice);
    await db.query('select public.save_workspace(-1,$1::jsonb)', [JSON.stringify(evidenceState())]);
  }, 30000);
  afterAll(async () => {
    await db.close();
  });
  it('owner can read their sessions and attempts', async () => {
    await asUser(alice);
    expect((await db.query('select * from public.sessions')).rows).toHaveLength(3);
    expect((await db.query('select * from public.attempts')).rows).toHaveLength(3);
  });
  it('a different account cannot read raw rows or any projected private data', async () => {
    await asUser(bob);
    for (const table of [
      'workspaces',
      'profiles',
      'sessions',
      'attempts',
      'assessments',
      'semantic_maps',
      'memories',
      'memory_evidence',
      'memory_versions',
      'skill_history',
    ])
      expect((await db.query(`select * from public.${table}`)).rows, table).toHaveLength(0);
  });
  it('cannot overwrite another account through RPC or direct SQL', async () => {
    await asUser(bob);
    const result = await db.query<{ save_workspace: boolean }>(
      'select public.save_workspace(0,$1::jsonb)',
      [JSON.stringify(evidenceState())],
    );
    expect(result.rows[0].save_workspace).toBe(false);
    await expect(
      db.query(`update public.workspaces set data='{}' where user_id='${alice}'`),
    ).rejects.toThrow();
  });
  it('anonymous access is denied', async () => {
    await db.exec('reset role; set role anon;');
    await expect(db.query('select * from public.sessions')).rejects.toThrow();
    await expect(
      db.query('select public.save_workspace(-1,$1::jsonb)', [JSON.stringify(evidenceState())]),
    ).rejects.toThrow();
  });
  it('compare-and-swap rejects stale revisions without partial writes', async () => {
    await asUser(alice);
    const state = evidenceState(1);
    const first = await db.query<{ save_workspace: boolean }>(
      'select public.save_workspace(0,$1::jsonb)',
      [JSON.stringify(state)],
    );
    expect(first.rows[0].save_workspace).toBe(true);
    const second = await db.query<{ save_workspace: boolean }>(
      'select public.save_workspace(0,$1::jsonb)',
      [JSON.stringify(evidenceState(4))],
    );
    expect(second.rows[0].save_workspace).toBe(false);
    expect((await db.query('select * from public.sessions')).rows).toHaveLength(1);
  });
});
