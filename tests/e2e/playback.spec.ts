import { test, expect, type Page } from '@playwright/test';
import { renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { startDevServer, startServer, type TestServer } from './server';
import { decodedEnergy, decodedSignal, login, scan, scanRequest, waitPlaying } from './helpers';

let server: TestServer;
test.beforeAll(async () => { test.setTimeout(120_000); server = await startServer(); });
test.afterAll(async () => { await server?.stop(); });

async function showAll(page: Page): Promise<void> {
  const more = page.getByRole('button', { name: '加载更多' });
  await expect(more).toBeVisible(); await more.click(); await expect(page.locator('tbody tr')).toHaveCount(107);
}

test('real login, CSRF rejection, scanning, fixed pages, refresh restore, and logout', async ({ page }) => {
  test.setTimeout(120_000);
  await login(page, server);
  expect(await page.getByLabel('管理员登录令牌').inputValue()).toBe('');
  const cookie = (await page.context().cookies()).find((cookie) => cookie.name === 'musicfs_session');
  expect(cookie).toMatchObject({ httpOnly: true, sameSite: 'Strict', path: '/api/v1' });
  const denied = await page.request.post(`${server.origin}/api/v1/provider-instances/local/scan-jobs`, { headers: { Origin: server.origin }, data: { mode: 'full' } });
  expect(denied.status()).toBe(403);
  await scan(page.request, server.origin); await page.getByRole('button', { name: '刷新列表' }).click();
  await expect(page.locator('tbody tr')).toHaveCount(100); await showAll(page);
  await expect(page.getByRole('button', { name: '播放 中文 空格曲目.wav', exact: true })).toBeVisible();
  expect(await page.evaluate(() => ({ local: localStorage.length, session: sessionStorage.length }))).toEqual({ local: 0, session: 0 });
  await page.reload(); await expect(page.getByRole('button', { name: '退出登录' })).toBeVisible();
  await page.getByRole('button', { name: '退出登录' }).click(); await expect(page.getByRole('button', { name: '登录', exact: true })).toBeVisible();
  expect((await page.request.get(`${server.origin}/api/v1/auth/session`)).status()).toBe(401);
});

test('real original WAV decodes, pauses, seeks through Range, switches, and stops', async ({ page, browser }, info) => {
  await login(page, server);
  const responses: { status: number; range: string | null; contentType: string | null }[] = [];
  page.on('response', (response) => { if (response.url().endsWith('/stream')) responses.push({ status: response.status(), range: response.headers()['content-range'] ?? null, contentType: response.headers()['content-type'] ?? null }); });
  await page.getByRole('button', { name: '播放 markers.wav', exact: true }).click(); await waitPlaying(page);
  const descriptorResponse = await page.request.get(`${server.origin}/api/v1/auth/session`); expect(descriptorResponse.ok()).toBeTruthy();
  const audio = page.locator('audio'); const streamUrl = await audio.getAttribute('src');
  await audio.evaluate((element: HTMLAudioElement) => element.pause());
  const pausedAt = await audio.evaluate((element: HTMLAudioElement) => element.currentTime);
  await page.waitForTimeout(300); expect(await audio.evaluate((element: HTMLAudioElement) => element.currentTime)).toBeCloseTo(pausedAt, 1);
  await page.getByLabel('曲目位置（秒）').fill('3'); await page.getByRole('button', { name: '跳转', exact: true }).click();
  await expect.poll(() => audio.evaluate((element: HTMLAudioElement) => element.currentTime)).toBeGreaterThanOrEqual(2.8);
  await audio.evaluate((element: HTMLAudioElement) => element.play()); await waitPlaying(page);
  const energy = await decodedEnergy(page); expect(energy).toBeGreaterThan(.01);
  expect(responses.some((response) => response.status === 206 && response.range)).toBeTruthy();
  const unauthorized = await browser.newContext(); expect((await unauthorized.request.get(`${server.origin}${streamUrl}`)).status()).toBe(401); await unauthorized.close();
  const outOfRange = await page.request.get(`${server.origin}${streamUrl}`, { headers: { Range: 'bytes=999999999-' } }); expect(outOfRange.status()).toBe(416);
  await page.getByRole('button', { name: '刷新列表' }).click(); expect(await audio.getAttribute('src')).toBe(streamUrl);
  for (const name of ['markers.wav', 'pagination-000.wav', 'markers.wav']) await page.getByRole('button', { name: `播放 ${name}`, exact: true }).click();
  await waitPlaying(page); await expect(page.getByRole('region', { name: '播放器' }).getByText('markers.wav', { exact: true })).toBeVisible();
  await page.screenshot({ path: info.outputPath('original-playback.png'), fullPage: true });
  await page.getByRole('button', { name: '停止', exact: true }).click(); await expect(page.locator('audio')).toHaveCount(0);
  writeFileSync(join(server.directory, 'original-evidence.json'), JSON.stringify({ browser: browser.version(), responses, decodedRms: energy, physicalListening: 'Not performed' }, null, 2));
  await info.attach('browser-media-evidence', { body: JSON.stringify({ browser: browser.version(), responses, decodedRms: energy, physicalListening: 'Not performed' }, null, 2), contentType: 'application/json' });
});

test('unsupported AIFF becomes streaming processed MP3 and timeRestart preserves track position', async ({ page, browser }, info) => {
  await login(page, server); await showAll(page);
  const rawError = await page.evaluate(async () => {
    const audio = new Audio('/raw-processing.aiff');
    return new Promise<number>((resolve) => {
      audio.onerror = () => { resolve(audio.error?.code ?? -1); audio.removeAttribute('src'); audio.load(); };
      audio.onplaying = () => { resolve(0); audio.pause(); audio.removeAttribute('src'); audio.load(); };
      void audio.play().catch(() => {}); setTimeout(() => { audio.pause(); resolve(-2); }, 8000);
    });
  });
  expect(rawError).toBe(4);
  await page.getByLabel('服务端处理（降低 6 dB，下一首生效）').check();
  const [created] = await Promise.all([
    page.waitForResponse((response) => response.url().endsWith('/playback/sessions') && response.request().method() === 'POST'),
    page.getByRole('button', { name: '播放 processing.aiff', exact: true }).click(),
  ]);
  const initial = await created.json(); expect(initial.deliveryMode).toBe('processed'); expect(initial.outputProfile.mime).toContain('audio/mpeg');
  await waitPlaying(page); expect(await decodedEnergy(page)).toBeGreaterThan(.01);
  const attempts: Record<string, unknown>[] = [];
  page.on('response', async (response) => { if (response.url().endsWith('/seek') && response.ok()) attempts.push(await response.json()); });
  await page.getByLabel('曲目位置（秒）').fill('2'); await page.getByRole('button', { name: '跳转', exact: true }).click();
  await page.getByLabel('曲目位置（秒）').fill('4'); await page.getByRole('button', { name: '跳转', exact: true }).click();
  await expect.poll(() => attempts.length).toBeGreaterThanOrEqual(1);
  await expect(page.getByRole('region', { name: '播放器' })).toContainText(/曲目位置：[4-9]/);
  const currentUrl = await page.locator('audio').getAttribute('src'); expect(currentUrl).not.toBe(initial.streamUrl);
  expect(attempts.at(-1)?.positionOriginMs).toBe(4000);
  await waitPlaying(page);
  expect(await page.locator('audio').evaluate((audio: HTMLAudioElement) => audio.currentTime)).toBeLessThan(2);
  const signal = await decodedSignal(page); expect(signal.rms).toBeGreaterThan(.01); expect(signal.peakHz).toBeGreaterThan(600); expect(signal.peakHz).toBeLessThan(700);
  await page.screenshot({ path: info.outputPath('processed-playback.png'), fullPage: true });
  const evidence = { browser: browser.version(), rawAIFFErrorCode: rawError, initial, attempts, decodedSeekSignal: signal, physicalListening: 'Not performed' };
  writeFileSync(join(server.directory, 'processed-evidence.json'), JSON.stringify(evidence, null, 2));
  await info.attach('processed-evidence', { body: JSON.stringify(evidence, null, 2), contentType: 'application/json' });
  await page.getByRole('button', { name: '停止', exact: true }).click(); await expect(page.locator('audio')).toHaveCount(0);
});

test('long processed output decodes before HTTP stream completes and cancellation unloads media', async ({ page, browser }, info) => {
  await login(page, server); await showAll(page);
  const completed = new Set<string>(); let firstResponseAt = 0;
  page.on('requestfinished', (request) => { if (request.url().endsWith('/stream')) completed.add(request.url()); });
  page.on('response', (response) => { if (response.url().endsWith('/stream') && !firstResponseAt) firstResponseAt = Date.now(); });
  await page.getByLabel('服务端处理（降低 6 dB，下一首生效）').check();
  const startedAt = Date.now(); await page.getByRole('button', { name: '播放 zz-long-processing.aiff', exact: true }).click();
  await waitPlaying(page); const energy = await decodedEnergy(page); const decodedAt = Date.now();
  const url = await page.locator('audio').evaluate((audio: HTMLAudioElement) => audio.src);
  const finishedAtFirstDecodedSample = completed.has(url);
  expect(energy).toBeGreaterThan(.01); expect(finishedAtFirstDecodedSample).toBe(false);
  writeFileSync(join(server.directory, 'streaming-evidence.json'), JSON.stringify({ browser: browser.version(), startedAt, firstResponseAt, decodedAt, decodedRms: energy, finishedAtFirstDecodedSample, physicalListening: 'Not performed' }, null, 2));
  await page.getByRole('button', { name: '停止', exact: true }).click(); await expect(page.locator('audio')).toHaveCount(0);
  await info.attach('streaming-timing', { body: JSON.stringify({ browser: browser.version(), startedAt, firstResponseAt, decodedAt, decodedRms: energy, finishedAtFirstDecodedSample, physicalListening: 'Not performed' }, null, 2), contentType: 'application/json' });
});

test('offline music directory retains published library and logout unloads active media', async ({ page }) => {
  await login(page, server);
  const original = join(server.directory, 'music'); const unavailable = join(server.directory, 'offline-music');
  if (!original.startsWith(server.directory) || !unavailable.startsWith(server.directory)) throw new Error('Invalid test directory boundary');
  renameSync(original, unavailable);
  try {
    const session = await (await page.request.get(`${server.origin}/api/v1/auth/session`)).json();
    const response = await page.request.post(`${server.origin}/api/v1/provider-instances/local/scan-jobs`, {
      headers: { Origin: server.origin, 'X-CSRF-Token': session.csrfToken, 'Idempotency-Key': crypto.randomUUID() }, data: await scanRequest(page.request, server.origin),
    });
    expect(response.ok()).toBeTruthy(); const { jobId } = await response.json();
    await expect.poll(async () => (await (await page.request.get(`${server.origin}/api/v1/scan-jobs/${jobId}`)).json()).status).toBe('failed');
    await page.getByRole('button', { name: '刷新列表' }).click();
    await expect(page.getByRole('region', { name: '音乐文件' })).toContainText('最近扫描失败');
    await expect(page.locator('tbody tr')).toHaveCount(100);
  } finally { renameSync(unavailable, original); }
  await page.getByRole('button', { name: '播放 markers.wav', exact: true }).click(); await waitPlaying(page);
  await page.getByRole('button', { name: '退出登录' }).click(); await expect(page.locator('audio')).toHaveCount(0);
  await expect(page.getByRole('button', { name: '登录', exact: true })).toBeVisible();
});

test('development proxy preserves origin, session cookies and native audio Range', async ({ page }) => {
  const stop = await startDevServer(server.origin);
  try {
    await login(page, { ...server, origin: 'http://127.0.0.1:5173' });
    const [stream] = await Promise.all([
      page.waitForResponse((response) => response.url().endsWith('/stream')),
      page.getByRole('button', { name: '播放 markers.wav', exact: true }).click(),
    ]);
    expect(stream.status()).toBe(206); await waitPlaying(page);
    await page.getByRole('button', { name: '退出登录' }).click(); await expect(page.locator('audio')).toHaveCount(0);
    await expect(page.getByRole('button', { name: '登录', exact: true })).toBeVisible();
  } finally { await stop(); }
});

test('keyboard reaches scrollable library and final minimal player controls', async ({ page }, info) => {
  test.setTimeout(120_000);
  await login(page, server); await scan(page.request, server.origin);
  await page.getByRole('button', { name: '刷新列表' }).click(); await expect(page.locator('tbody tr')).toHaveCount(100);
  await page.getByRole('button', { name: '退出登录' }).focus();
  await page.keyboard.press('Tab'); await expect(page.getByLabel('来源', { exact: true })).toBeFocused();
  await page.keyboard.press('Tab'); await expect(page.getByRole('button', { name: '刷新列表' })).toBeFocused();
  await page.keyboard.press('Tab'); await expect(page.getByRole('region', { name: '可滚动的文件列表' })).toBeFocused();
  await page.getByRole('button', { name: '播放 markers.wav', exact: true }).click(); await waitPlaying(page);
  await page.getByRole('button', { name: '停止', exact: true }).scrollIntoViewIfNeeded();
  await expect(page.getByRole('button', { name: '停止', exact: true })).toBeInViewport();
  await page.screenshot({ path: info.outputPath('minimal-web.png'), fullPage: true });
  await page.getByRole('region', { name: '播放器', exact: true }).screenshot({ path: info.outputPath('player-detail.png') });
  await page.getByRole('button', { name: '停止', exact: true }).click(); await expect(page.locator('audio')).toHaveCount(0);
});
