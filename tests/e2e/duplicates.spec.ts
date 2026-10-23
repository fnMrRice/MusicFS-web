import { test, expect, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { duplicateFixture, groupedTracks, verifyHashes } from './duplicates-fixture';
import type { DirectoryTestServer } from './directory-server';

const plugin = 'musicfs.plugin.matching.standard';
let server: DirectoryTestServer | undefined;
test.afterEach(async () => { await server?.stop(); server = undefined; });

async function settings(page: Page, origin: string) {
  const response = await page.request.get(`${origin}/api/v1/plugin-settings/${plugin}`);
  expect(response.status()).toBe(200);
  return response.json();
}

async function disableAutomatic(page: Page, origin: string) {
  const current = await settings(page, origin);
  const session = await (await page.request.get(`${origin}/api/v1/auth/session`)).json();
  const response = await page.request.put(`${origin}/api/v1/plugin-settings/${plugin}`, {
    headers: { Origin: origin, 'X-CSRF-Token': session.csrfToken, 'Idempotency-Key': crypto.randomUUID() },
    data: { expectedRevision: current.revision, schemaRevision: current.schema.revision, values: { ...current.values, automatic: false } },
  });
  expect(response.status()).toBe(200);
}

test('manual merge, source playback and unlink survive restart without automatic detection', async ({ page }, info) => {
  test.setTimeout(180_000);
  const fixture = await duplicateFixture(page);
  server = fixture.server;
  const original = readFileSync(join(server.selectedRoot, 'selected.wav'));
  await disableAutomatic(page, server.origin);
  await page.reload();
  await page.getByRole('checkbox', { name: '选择 selected.wav', exact: true }).check();
  await page.getByRole('checkbox', { name: '选择 second-selected.wav', exact: true }).check();
  await page.getByRole('button', { name: '合并歌曲', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '合并歌曲', exact: true });
  await expect(dialog).toContainText('selected.wav');
  await expect(dialog).toContainText('second-selected.wav');
  const [response] = await Promise.all([
    page.waitForResponse(response => response.url().endsWith('/matching/links') && response.request().method() === 'POST'),
    dialog.getByRole('button', { name: '确认合并', exact: true }).click(),
  ]);
  expect(response.status()).toBe(200);
  await expect.poll(async () => (await groupedTracks(page, server!.origin)).length).toBe(2);
  await expect(page.getByRole('button', { name: /^展开 .* 的来源版本$/ })).toHaveCount(1);
  await page.getByRole('button', { name: /^展开 .* 的来源版本$/ }).click();
  const versions = page.getByLabel('来源版本', { exact: true });
  await expect(versions.getByRole('button', { name: /^播放来源版本 / })).toHaveCount(2);
  await versions.getByRole('button', { name: '播放来源版本 second-selected.wav', exact: true }).click();
  await expect.poll(() => page.locator('audio').evaluate((audio: HTMLAudioElement) => audio.currentTime)).toBeGreaterThan(.2);
  await page.screenshot({ path: info.outputPath('merged-source-versions.png') });
  await server.restart();
  await page.reload();
  await expect(page.getByRole('button', { name: /^展开 .* 的来源版本$/ })).toHaveCount(1);
  expect((await settings(page, server.origin)).values.automatic).toBe(false);
  await page.getByRole('button', { name: /^展开 .* 的来源版本$/ }).click();
  await page.getByRole('button', { name: '解除 second-selected.wav 的关联', exact: true }).click();
  await page.getByRole('dialog', { name: '解除关联', exact: true }).getByRole('button', { name: '确认解除', exact: true }).click();
  await expect.poll(async () => (await groupedTracks(page, server!.origin)).length).toBe(3);
  await expect(page.getByRole('button', { name: /^展开 .* 的来源版本$/ })).toHaveCount(0);
  expect(readFileSync(join(server.selectedRoot, 'selected.wav')).equals(original)).toBe(true);
  expect(readFileSync(join(server.secondSelectedRoot, 'second-selected.wav')).equals(original)).toBe(true);
});

test('plugin settings drive duplicate recognition while candidates still require manual confirmation', async ({ page }, info) => {
  test.setTimeout(180_000);
  const fixture = await duplicateFixture(page);
  server = fixture.server;
  await disableAutomatic(page, server.origin);
  await verifyHashes(page, server.origin, fixture.tracks);
  await page.getByRole('button', { name: '设置', exact: true }).click();
  await page.getByRole('navigation', { name: '设置分类', exact: true }).getByRole('button', { name: '插件管理', exact: true }).click();
  const entry = page.locator('details.plugin-entry').filter({ hasText: plugin });
  await entry.locator('summary').click();
  const form = entry.locator('section');
  await expect(form.getByRole('checkbox')).toHaveCount(1);
  await form.getByRole('spinbutton').fill('100');
  await expect(form.getByRole('button', { name: '保存设置', exact: true })).toBeEnabled();
  const before = await settings(page, server.origin);
  const actionID = before.schema.actions[0].id;
  const action = form.getByRole('button').filter({ hasNotText: '保存设置' }).last();
  await expect(action).toBeDisabled();
  await form.getByRole('button', { name: '保存设置', exact: true }).click();
  await expect.poll(async () => (await settings(page, server!.origin)).values.minimumScore).toBe(100);
  const [submitted] = await Promise.all([
    page.waitForResponse(response => response.url().endsWith(`/plugin-settings/${plugin}/actions/${actionID}`)),
    action.click(),
  ]);
  expect(submitted.ok()).toBe(true);
  await expect.poll(async () => (await settings(page, server!.origin)).job.status, { timeout: 30_000 }).toBe('succeeded');
  const candidates = await (await page.request.get(`${server.origin}/api/v1/matching/candidates`)).json();
  expect(candidates.items).toHaveLength(3);
  expect(candidates.items.every((candidate: { requiresConfirmation: boolean; score: number }) => candidate.requiresConfirmation && candidate.score === 100)).toBe(true);
  expect(await groupedTracks(page, server.origin)).toHaveLength(3);
  await page.screenshot({ path: info.outputPath('plugin-declared-settings.png') });
  await page.getByRole('link', { name: '曲目列表', exact: true }).click();
  await page.getByRole('button', { name: '重复识别', exact: true }).click();
  await expect(page.getByRole('dialog', { name: '重复识别', exact: true })).toContainText('selected.wav');
  await page.getByRole('dialog', { name: '重复识别', exact: true }).screenshot({ path: info.outputPath('duplicate-candidates.png') });
  for (const count of [2, 1]) {
    await page.getByRole('dialog', { name: '重复识别', exact: true }).getByRole('button', { name: '合并歌曲', exact: true }).first().click();
    await page.getByRole('dialog', { name: '合并歌曲', exact: true }).getByRole('button', { name: '确认合并', exact: true }).click();
    await expect(page.getByRole('dialog', { name: '合并歌曲', exact: true })).toHaveCount(0);
    await expect.poll(async () => (await groupedTracks(page, server!.origin)).length).toBe(count);
    if (count === 2) {
      const session = await (await page.request.get(`${server.origin}/api/v1/auth/session`)).json();
      const rescan = await page.request.post(`${server.origin}/api/v1/plugin-settings/${plugin}/actions/scan`, {
        headers: { Origin: server.origin, 'X-CSRF-Token': session.csrfToken, 'Idempotency-Key': crypto.randomUUID() }, data: {},
      });
      expect(rescan.ok()).toBe(true);
      await expect.poll(async () => (await settings(page, server!.origin)).job.status, { timeout: 30_000 }).toBe('succeeded');
      await page.getByRole('dialog', { name: '重复识别', exact: true }).getByRole('button', { name: '刷新候选', exact: true }).click();
    }
  }
  const merged = await groupedTracks(page, server.origin);
  expect(merged[0].versions).toHaveLength(3);
  await expect(page.getByRole('dialog', { name: '重复识别', exact: true })).toContainText('暂无待确认的重复歌曲');
});

test('automatic detection runs outside settings and preserves its results after restart', async ({ page }) => {
  test.setTimeout(180_000);
  const fixture = await duplicateFixture(page);
  server = fixture.server;
  await disableAutomatic(page, server.origin);
  await verifyHashes(page, server.origin, fixture.tracks);
  const current = await settings(page, server.origin);
  const session = await (await page.request.get(`${server.origin}/api/v1/auth/session`)).json();
  const response = await page.request.put(`${server.origin}/api/v1/plugin-settings/${plugin}`, {
    headers: { Origin: server.origin, 'X-CSRF-Token': session.csrfToken, 'Idempotency-Key': crypto.randomUUID() },
    data: { expectedRevision: current.revision, schemaRevision: current.schema.revision, values: { ...current.values, automatic: true } },
  });
  expect(response.status()).toBe(200);
  await page.goto(`${server.origin}/#/library`);
  const candidates = async () => (await (await page.request.get(`${server!.origin}/api/v1/matching/candidates`)).json()).items;
  await expect.poll(async () => (await candidates()).length, { timeout: 30_000 }).toBe(3);
  await expect.poll(async () => (await settings(page, server!.origin)).job.status).toBe('succeeded');
  const original = (await candidates()).map((item: { candidateId: string }) => item.candidateId).sort();
  expect(await groupedTracks(page, server.origin)).toHaveLength(3);
  await server.restart();
  await page.reload();
  await expect(page.getByRole('button', { name: '账号菜单' })).toBeVisible();
  await expect.poll(async () => (await candidates()).map((item: { candidateId: string }) => item.candidateId).sort()).toEqual(original);
  expect((await settings(page, server.origin)).values.automatic).toBe(true);
  expect(await groupedTracks(page, server.origin)).toHaveLength(3);
});
