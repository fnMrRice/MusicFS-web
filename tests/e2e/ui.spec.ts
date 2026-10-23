import { instanceIds, neteasePlugin } from "../fixtures/plugins";
import { test, expect } from '@playwright/test';
import { startServer, type TestServer } from './server';
import { login, logout, scan, waitPlaying } from './helpers';
import { track } from '../fixtures/dto';

let server: TestServer;
test.beforeAll(async () => { test.setTimeout(120_000); server = await startServer(); });
test.afterAll(async () => { await server?.stop(); });

test('real shell, custom transport, themes and playlist writes survive route changes', async ({ page }, info) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
  await login(page, server); await scan(page.request, server.origin); await page.getByRole('button', { name: '刷新列表' }).click();
  await page.getByRole('checkbox', { name: '选择 markers.wav', exact: true }).check();
  await expect(page.locator('audio')).toHaveCount(0);
  await page.getByRole('button', { name: '添加到歌单', exact: true }).click();
  await page.getByLabel('歌单名称', { exact: true }).fill('夜间聆听');
  await page.getByRole('button', { name: '保存', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.getByRole('link', { name: '夜间聆听', exact: true }).click();
  await page.getByRole('button', { name: '更新歌单快照' }).click();
  await expect(page.getByRole('button', { name: '播放 markers.wav', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '编辑名称与聚合规则' }).click();
  await page.getByLabel('歌单名称', { exact: true }).fill('夜间聆听 · 我的歌单');
  await page.getByRole('button', { name: '保存修改' }).click();
  await expect(page.getByRole('heading', { name: '夜间聆听 · 我的歌单' })).toBeVisible();
  await page.getByRole('button', { name: '播放 markers.wav', exact: true }).click(); await waitPlaying(page);
  const source = await page.locator('audio').getAttribute('src');
  await page.getByRole('button', { name: '暂停', exact: true }).click();
  await expect.poll(() => page.locator('audio').evaluate((a: HTMLAudioElement) => a.paused)).toBe(true);
  await page.getByRole('button', { name: '播放', exact: true }).click(); await waitPlaying(page);
  await page.getByRole('slider', { name: '音量', exact: true }).fill('0.35');
  await expect.poll(() => page.locator('audio').evaluate((a: HTMLAudioElement) => a.volume)).toBe(.35);
  await page.getByRole('button', { name: '设置', exact: true }).click();
  await page.getByRole('navigation', { name: '设置分类', exact: true }).getByRole('button', { name: '外观与语言', exact: true }).click();
  const language = page.locator('.language-select select');
  await language.selectOption('en');
  await expect(page.getByRole('navigation', { name: 'Settings categories', exact: true })).toBeVisible();
  await language.selectOption('ja');
  await expect(page.getByRole('navigation', { name: '設定カテゴリー', exact: true })).toBeVisible();
  await expect(page.locator('audio')).toHaveCount(1);
  expect(await page.locator('audio').getAttribute('src')).toBe(source);
  await expect.poll(() => page.locator('audio').evaluate((a: HTMLAudioElement) => a.volume)).toBe(.35);
  await waitPlaying(page);
  await language.selectOption('zh-CN');
  await page.getByRole('link', { name: '搜索', exact: true }).click();
  await expect(page.locator('audio')).toHaveCount(1); expect(await page.locator('audio').getAttribute('src')).toBe(source);
  await page.getByRole('button', { name: '专辑', exact: true }).click();
  await expect(page.getByRole('heading', { name: '专辑搜索即将接入' })).toBeVisible();
  await page.getByRole('button', { name: '我的', exact: true }).click();
  await expect(page.getByRole('link', { name: '我的收藏', exact: true })).toHaveCount(0);
  await page.getByRole('navigation', { name: '主导航' }).getByRole('button', { name: '歌单', exact: true }).click();
  await expect(page.getByRole('button', { name: '我的', exact: true })).toHaveAttribute('aria-expanded', 'false');
  await page.getByRole('button', { name: '新建歌单', exact: true }).click();
  await expect(page.getByRole('dialog', { name: '新建歌单' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('navigation', { name: '主导航' }).getByRole('button', { name: '歌单', exact: true })).toHaveAttribute('aria-expanded', 'false');
  await page.getByRole('button', { name: '换肤', exact: true }).click(); await page.getByRole('button', { name: '晨光 · 浅色' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: '换肤', exact: true }).click(); await page.getByRole('button', { name: '深夜 · 深色' }).click(); await page.keyboard.press('Escape');
  await page.getByRole('link', { name: '曲目列表', exact: true }).click();
  await page.screenshot({ path: info.outputPath('react-library-1440.png') });
  await page.setViewportSize({ width: 1280, height: 800 }); await page.screenshot({ path: info.outputPath('react-library-1280.png') });
  await page.setViewportSize({ width: 480, height: 800 });
  await expect(page.getByRole('button', { name: '账号菜单' })).toBeInViewport(); await expect(page.getByRole('region', { name: '播放器', exact: true }).getByRole('button', { name: /^(播放|暂停)$/ })).toBeInViewport();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: info.outputPath('react-narrow.png') });
  await expect(page.getByRole('button', { name: /迷你模式|最小化|最大化/ })).toHaveCount(0);
  expect(errors).toEqual([]); await logout(page); await expect(page.locator('audio')).toHaveCount(0);
});

test('mock 1000-row cursor selection and retry do not auto-select appended rows', async ({ page }) => {
  let failed = false; const requests: string[] = [];
  await page.route('**/api/v1/source-tracks?**', async route => {
    const cursor = new URL(route.request().url()).searchParams.get('cursor'); requests.push(cursor ?? 'first');
    if (cursor === 'c100' && !failed) { failed = true; await route.fulfill({ status: 503, json: { error: { code: 'SOURCE_UNAVAILABLE', message: 'Offline' } } }); return; }
    const offset = cursor ? Number(cursor.slice(1)) : 0;
    await route.fulfill({ json: { items: Array.from({ length: 100 }, (_, n) => ({ ...track, sourceTrackId: `mock-${offset + n}`, displayName: `Mock ${offset + n}` })), nextCursor: offset < 900 ? `c${offset + 100}` : null, libraryRevision: 'mock-1' } });
  });
  await login(page, server); await expect(page.locator('tbody tr')).toHaveCount(100);
  const selectAll = page.getByRole('checkbox', { name: '全选当前已返回曲目' }); await selectAll.check();
  await page.locator('#page-scroll').evaluate(e => { e.scrollTop = e.scrollHeight; });
  await expect(page.getByRole('alert')).toBeVisible(); expect(requests.filter(c => c === 'c100')).toHaveLength(1);
  await page.getByRole('button', { name: '重试', exact: true }).click();
  await expect(page.locator('tbody tr')).toHaveCount(200);
  await expect(selectAll).toBeChecked({ indeterminate: true });
  await expect(page.getByRole('checkbox', { name: '选择 Mock 100', exact: true })).not.toBeChecked();
  for (let n = 300; n <= 1000; n += 100) { await page.locator('#page-scroll').evaluate(e => { e.scrollTop = e.scrollHeight; }); await expect(page.locator('tbody tr')).toHaveCount(n); }
  await expect(page.getByText('已选择 100 首', { exact: true })).toBeVisible(); await expect(page.locator('audio')).toHaveCount(0);
  expect(requests.filter(c => c === 'c200')).toHaveLength(1);
  await expect(page.getByRole('button', { name: '加载更多' })).toHaveCount(0);
  await page.getByRole('button', { name: '刷新列表' }).click();
  await expect(selectAll).not.toBeChecked();
});

test('mock source search preserves partial failure and never calls missing search types', async ({ page }, info) => {
  const calls: string[] = [];
  await page.route('**/api/v1/online-instances', route => route.fulfill({ json: { items: [instanceIds.netease, instanceIds.neteaseSecond].map((id, index) => ({ instanceId: id, name: `Listener ${index + 1}`, accountId: `account-${index + 1}`, plugin: neteasePlugin, platform: 'netease', availability: 'available', capabilities: [{ name: 'search.tracks', supported: true, reason: 'Mock' }] })) } }));
  await page.route('**/api/v1/online-instances/*/search?**', async route => {
    calls.push(route.request().url()); const url = new URL(route.request().url());
    if (url.pathname.includes(`/${instanceIds.neteaseSecond}/`)) { await route.fulfill({ status: 503, json: { error: { code: 'SOURCE_UNAVAILABLE', message: 'Unavailable' } } }); return; }
    await route.fulfill({ json: { tracks: [{ externalId: '123', title: '测试曲目 <安全文本>', artists: ['测试歌手'], album: '测试专辑', durationMs: 120000, sourceUrl: 'https://music.163.com/song?id=123' }], nextCursor: null, truncated: false } });
  });
  await login(page, server); await page.getByRole('link', { name: '搜索', exact: true }).click();
  const input = page.getByRole('textbox', { name: '搜索关键词' });
  await input.fill('测试'); await input.dispatchEvent('compositionstart'); await input.press('Enter'); expect(calls).toHaveLength(0); await input.dispatchEvent('compositionend'); await input.press('Enter');
  await expect(page.getByText('测试曲目 <安全文本>', { exact: true })).toBeVisible(); await expect(page.getByRole('alert')).toBeVisible();
  const count = calls.length; await page.getByRole('button', { name: '歌手', exact: true }).click();
  await expect(page.getByRole('heading', { name: '歌手搜索即将接入' })).toBeVisible(); expect(calls).toHaveLength(count);
  await page.screenshot({ path: info.outputPath('react-search-placeholder.png') });
});

test('session expiry clears cached library and next identity gets isolated preferences', async ({ page }) => {
  await login(page, server);
  await page.getByRole('button', { name: '我的', exact: true }).click();
  await page.getByRole('button', { name: '换肤', exact: true }).click();
  await page.getByRole('button', { name: '晨光 · 浅色' }).click(); await page.keyboard.press('Escape');
  await page.route('**/api/v1/source-tracks?**', route => route.fulfill({ status: 401, json: { error: { code: 'UNAUTHORIZED', message: 'Expired' } } }));
  await page.getByRole('button', { name: '刷新列表' }).click();
  await expect(page.getByRole('button', { name: '登录', exact: true })).toBeVisible(); await expect(page.locator('tbody tr')).toHaveCount(0); await expect(page.locator('audio')).toHaveCount(0);
  await page.unroute('**/api/v1/source-tracks?**');
  await page.route('**/api/v1/auth/session', async route => {
    const response = await route.fetch(); const data = await response.json(); data.user.id = 'mock-other-user'; await route.fulfill({ response, json: data });
  });
  await page.getByLabel('管理员登录令牌').fill(server.token); await page.getByRole('button', { name: '登录', exact: true }).click();
  await expect(page.getByRole('button', { name: '我的', exact: true })).toHaveAttribute('aria-expanded', 'true');
  const systemTheme = await page.evaluate(() => matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
  await expect(page.locator('html')).toHaveAttribute('data-theme', systemTheme);
});
