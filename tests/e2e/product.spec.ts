import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { rawThink, rawWork, revisedWork } from '../fixtures';

async function waitReady(page: Page) {
  await page.waitForResponse((r) => r.url().endsWith('/api/state') && r.status() === 200);
}
async function startText(page: Page, mode = 'speak') {
  const ready = waitReady(page);
  await page.goto(`/coach?mode=${mode}&input=text`);
  await ready;
  await page.getByLabel('你的原话').fill(mode === 'speak' ? rawWork : rawThink);
  await page.getByRole('button', { name: '确认原文，找到重点' }).click();
  await expect(page.getByRole('heading', { name: '你刚才这样说' })).toBeVisible();
}
test('375px, 390px and desktop show microphone and both modes without horizontal overflow', async ({
  page,
}) => {
  for (const width of [375, 390, 1440]) {
    await page.setViewportSize({ width, height: width > 600 ? 1000 : 812 });
    await page.goto('/');
    const mic = page.getByRole('link', { name: '开始录音', exact: true });
    await expect(mic).toBeInViewport();
    await expect(page.getByRole('button', { name: /先理一理 THINK/ })).toBeInViewport();
    await expect(page.getByRole('button', { name: /直接表达 SPEAK/ })).toBeInViewport();
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
  }
  await page.screenshot({ path: 'test-results/firstpoint-desktop.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: 'test-results/firstpoint-mobile.png', fullPage: true });
});
test('Speak: real attempts, hidden-hint recall, persisted completion and no invented growth', async ({
  page,
}) => {
  await startText(page);
  await page.getByRole('button', { name: '小骨架', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: '我的判断' })).toBeVisible();
  await page.getByRole('button', { name: '用自己的话，再说一次' }).click();
  await page.getByLabel('你的原话').fill(revisedWork);
  await page.getByRole('button', { name: '提交这次重述' }).click();
  await expect(page.getByRole('heading', { name: '听听前后的自己' })).toBeVisible();
  await page.getByRole('button', { name: '收起提示，练习复述' }).click();
  await expect(page.getByRole('heading', { name: '这一次，只听你自己。' })).toBeVisible();
  await expect(page.locator('.feedback-card')).toHaveCount(0);
  await page
    .getByLabel('你的原话')
    .fill('我倾向暂停这批标注，因为标签已过期。请负责人确认后，再讨论下一批样本。');
  await page.getByRole('button', { name: '提交这次重述' }).click();
  await expect(page.getByRole('heading', { name: '你刚才这样说' })).toBeVisible();
  await page.getByRole('button', { name: '保存这次练习' }).click();
  await expect(page.getByRole('heading', { name: '把这份清晰，带走。' })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('heading', { name: '把这份清晰，带走。' })).toBeVisible();
  const state = await (await page.request.get('/api/state')).json();
  expect(state.sessions).toHaveLength(1);
  expect(state.sessions[0].attempts).toHaveLength(3);
  expect(state.sessions[0].attempts[1].independent_eligible).toBe(false);
  expect(state.sessions[0].attempts[2].is_recall).toBe(true);
  expect(state.sessions[0].attempts[2].assistance_level).toBe(2);
  await page.goto('/growth');
  await expect(page.getByRole('heading', { name: '还在建立基线，慢慢来就好。' })).toBeVisible();
  await expect(page.locator('.stats-grid section').nth(2).locator('strong')).toHaveText('—');
});
test('Think: uncertain thoughts, user-selected core, corrected memory stays frozen', async ({
  page,
}) => {
  await startText(page, 'think');
  await expect(page.getByText('线索待收拢', { exact: true })).toBeVisible();
  await page.locator('.semantic-list button').first().click();
  await page.getByLabel('想调整这个点的理解？').fill('怎样识别一个真实需求');
  await page.getByRole('button', { name: '保存纠正', exact: true }).click();
  await expect(page.locator('.semantic-list button').first()).toContainText('怎样识别一个真实需求');
  await page.getByRole('button', { name: '用自己的话，再说一次' }).click();
  await page
    .getByLabel('你的原话')
    .fill('我倾向先观察用户为什么重复使用产品，因为新鲜感不一定等于长期需求。');
  await page.getByRole('button', { name: '提交这次重述' }).click();
  await expect(page.getByRole('heading', { name: '你刚才这样说' })).toBeVisible();
  await page.getByRole('button', { name: '保存这次练习' }).click();
  await expect(page.getByRole('heading', { name: '把这份清晰，带走。' })).toBeVisible();
  await page.goto('/memory');
  await page.getByRole('button', { name: '纠正', exact: true }).first().click();
  await page.getByLabel('你希望如何纠正这条观察？').fill('那次只是探索，不代表总是缺少观点。');
  await page.getByRole('button', { name: '保存纠正并冻结旧判断' }).click();
  await expect(
    page.getByRole('heading', { name: '那次只是探索，不代表总是缺少观点。' }),
  ).toBeVisible();
  await page.reload();
  await expect(page.getByText('已冻结', { exact: true }).first()).toBeVisible();
});
test('microphone refusal keeps text input usable on mobile', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.addInitScript(() => {
    Object.defineProperty(navigator.mediaDevices, 'getUserMedia', {
      value: () => Promise.reject(new DOMException('Denied', 'NotAllowedError')),
    });
  });
  const ready = waitReady(page);
  await page.goto('/coach');
  await ready;
  await page.getByRole('button', { name: '开启麦克风录音' }).click();
  await expect(page.locator('.notice.error')).toContainText('麦克风权限未开启');
  await page.getByRole('button', { name: '写下来', exact: true }).click();
  await page.getByLabel('你的原话').fill(rawThink);
  await page.getByRole('button', { name: '确认原文，找到重点' }).click();
  await expect(page.getByRole('heading', { name: '你刚才这样说' })).toBeVisible();
});
test('draft survives reload without manufacturing a submitted attempt', async ({ page }) => {
  const ready = waitReady(page);
  await page.goto('/coach?input=text');
  await ready;
  await page.getByLabel('你的原话').fill('这是还没有提交的思绪草稿。');
  await page.reload();
  await expect(page.getByLabel('你的原话')).toHaveValue('这是还没有提交的思绪草稿。');
  const state = await (await page.request.get('/api/state')).json();
  expect(state.sessions).toHaveLength(0);
});
test('API rejects cross-account reads and spoofed independence, retries are idempotent', async ({
  page,
  browser,
}) => {
  const ready = waitReady(page);
  await page.goto('/');
  await ready;
  const headers = { 'X-FirstPoint': '1' };
  const key = crypto.randomUUID();
  const created = await page.request.post('/api/sessions', {
    headers,
    data: { mode: 'speak', scene: 'work', idempotency_key: key },
  });
  expect(created.ok()).toBe(true);
  const s = await created.json();
  const again = await (
    await page.request.post('/api/sessions', {
      headers,
      data: { mode: 'speak', scene: 'work', idempotency_key: key },
    })
  ).json();
  expect(again.id).toBe(s.id);
  const attemptData = {
    session_id: s.id,
    text: rawWork,
    idempotency_key: crypto.randomUUID(),
    independent_eligible: true,
  };
  const first = await (
    await page.request.post('/api/attempts', { headers, data: attemptData })
  ).json();
  const duplicate = await (
    await page.request.post('/api/attempts', { headers, data: attemptData })
  ).json();
  expect(first.id).toBe(duplicate.id);
  await page.request.post('/api/analyze', {
    headers,
    data: { session_id: s.id, attempt_id: first.id },
  });
  const second = await (
    await page.request.post('/api/attempts', {
      headers,
      data: {
        ...attemptData,
        idempotency_key: crypto.randomUUID(),
        text: revisedWork,
        assistance_level: 0,
      },
    })
  ).json();
  expect(second.independent_eligible).toBe(false);
  expect(second.assistance_level).toBe(1);
  const other = await browser.newContext();
  const otherPage = await other.newPage();
  await otherPage.goto('/');
  await otherPage.request.get('/api/state');
  const denied = await otherPage.request.get(`/api/sessions/${s.id}`);
  expect(denied.status()).toBe(404);
  const csrf = await page.request.post('/api/sessions', {
    data: { mode: 'speak', scene: 'work', idempotency_key: crypto.randomUUID() },
  });
  expect(csrf.status()).toBe(403);
  await other.close();
});
test('account login shares persisted data between desktop and mobile clients', async ({
  page,
  browser,
}) => {
  await startText(page);
  const email = `test-${crypto.randomUUID()}@example.test`;
  const password = `Safe-test-${crypto.randomUUID()}`;
  const result = await page.request.post('/api/auth', {
    headers: { 'X-FirstPoint': '1' },
    data: { action: 'register', email, password },
  });
  expect(result.ok()).toBe(true);
  const mobile = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const other = await mobile.newPage();
  await other.goto('/');
  await other.request.get('/api/state');
  const login = await other.request.post('/api/auth', {
    headers: { 'X-FirstPoint': '1' },
    data: { action: 'login', email, password },
  });
  expect(login.ok()).toBe(true);
  const state = await (await other.request.get('/api/state')).json();
  expect(state.sessions).toHaveLength(1);
  expect(state.sessions[0].attempts[0].confirmed_text).toBe(rawWork);
  await mobile.close();
});
test('deleting a session erases its derived evidence; export reflects deletion', async ({
  page,
}) => {
  await startText(page);
  await page.getByRole('button', { name: '保存这次练习' }).click();
  await expect(page.getByRole('heading', { name: '把这份清晰，带走。' })).toBeVisible();
  await page.goto('/growth');
  await page.getByRole('button', { name: '删除这次练习', exact: true }).click();
  await page.getByRole('button', { name: '确认删除这次练习' }).click();
  await expect(page.getByRole('heading', { name: '这里，会慢慢长出你的故事。' })).toBeVisible();
  const exported = await (
    await page.request.post('/api/export', { headers: { 'X-FirstPoint': '1' }, data: {} })
  ).json();
  expect(exported.sessions).toHaveLength(0);
  expect(exported.memories).toHaveLength(0);
  expect(JSON.stringify(exported)).not.toContain(rawWork);
});
test('reduced motion and mobile navigation remain usable', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto('/');
  expect(
    await page.locator('.hero-record').evaluate((el) => getComputedStyle(el).transitionDuration),
  ).toBe('0s');
  const nav = page.getByRole('navigation', { name: '移动导航', exact: true });
  await nav.getByRole('link', { name: 'Memory' }).click();
  await expect(page.getByRole('heading', { name: '记住线索，不定义你。' })).toBeVisible();
  await expect(page.getByRole('switch', { name: '个性化记忆' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
});

test('native recording pauses/resumes, keeps audio after ASR failure, and can fall back to text', async ({
  browser,
}) => {
  const context = await browser.newContext({ permissions: ['microphone'] });
  const page = await context.newPage();
  const ready = waitReady(page);
  await page.goto('/coach?input=voice');
  await ready;
  await page.getByRole('button', { name: '开启麦克风录音' }).click();
  await expect(page.getByText('正在倾听', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '暂停', exact: true }).click();
  await expect(page.getByText('已暂停', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '继续', exact: true }).click();
  await expect(page.getByText('正在倾听', { exact: true })).toBeVisible();
  await expect(page.locator('.recording-time')).toContainText('00:01', { timeout: 5000 });
  await page.getByRole('button', { name: '结束录音', exact: true }).click();
  await expect(page.getByLabel('回听本次录音')).toBeVisible();
  await page.getByRole('button', { name: '转写为文字', exact: true }).click();
  await expect(page.locator('.notice.error')).toContainText('语音转写尚未连接');
  await expect(page.getByLabel('回听本次录音')).toBeVisible();
  await expect(page.getByRole('button', { name: '转写为文字', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: '写下来', exact: true }).click();
  await page.getByLabel('你的原话').fill(rawThink);
  await page.getByRole('button', { name: '确认原文，找到重点' }).click();
  await expect(page.getByRole('heading', { name: '你刚才这样说' })).toBeVisible();
  await context.close();
});
