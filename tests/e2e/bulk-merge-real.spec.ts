import { test, expect, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { duplicateFixture, groupedTracks, verifyHashes } from './duplicates-fixture';
import type { DirectoryTestServer } from './directory-server';

const plugin = 'musicfs.plugin.matching.standard';
let server: DirectoryTestServer | undefined;
test.afterEach(async () => { await server?.stop(); server = undefined; });

async function prepareCandidates(page: Page, origin: string) {
  const session = await (await page.request.get(`${origin}/api/v1/auth/session`)).json();
  const response = await page.request.post(`${origin}/api/v1/plugin-settings/${plugin}/actions/scan`, {
    headers: { Origin: origin, 'X-CSRF-Token': session.csrfToken, 'Idempotency-Key': crypto.randomUUID() }, data: {},
  });
  expect(response.ok()).toBe(true);
  await expect.poll(async () => {
    const settings = await (await page.request.get(`${origin}/api/v1/plugin-settings/${plugin}`)).json();
    return settings.job.status;
  }, { timeout: 30_000 }).toBe('succeeded');
}

test('bulk merge preserves untagged sources, merges score matches once, and survives restart', async ({ page }, info) => {
  test.setTimeout(180_000);
  const fixture = await duplicateFixture(page);
  server = fixture.server;
  const original = readFileSync(join(server.selectedRoot, 'selected.wav'));
  const settings = await (await page.request.get(`${server.origin}/api/v1/plugin-settings/${plugin}`)).json();
  const session = await (await page.request.get(`${server.origin}/api/v1/auth/session`)).json();
  const disabled = await page.request.put(`${server.origin}/api/v1/plugin-settings/${plugin}`, {
    headers: { Origin: server.origin, 'X-CSRF-Token': session.csrfToken, 'Idempotency-Key': crypto.randomUUID() },
    data: { expectedRevision: settings.revision, schemaRevision: settings.schema.revision, values: { ...settings.values, automatic: false } },
  });
  expect(disabled.ok()).toBe(true);
  await page.reload();
  await page.getByRole('button', { name: '一键合并重复音乐', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '一键合并重复音乐', exact: true });
  await dialog.getByRole('radio', { name: '合并重名重作者', exact: true }).check();
  await dialog.getByRole('button', { name: '开始合并', exact: true }).click();
  await expect(dialog).toContainText('没有可合并的重复音乐。');
  expect(await groupedTracks(page, server.origin)).toHaveLength(3);
  await dialog.getByRole('button', { name: '关闭', exact: true }).last().click();

  await verifyHashes(page, server.origin, fixture.tracks);
  await prepareCandidates(page, server.origin);
  await page.getByRole('button', { name: '一键合并重复音乐', exact: true }).click();
  await dialog.getByRole('radio', { name: '按分数合并', exact: true }).check();
  await dialog.getByLabel('最低分数（0–100）', { exact: true }).fill('100');
  await dialog.screenshot({ path: info.outputPath('bulk-merge-score.png') });
  const [response] = await Promise.all([
    page.waitForResponse(item => item.url().endsWith('/matching/bulk-merge') && item.request().method() === 'POST'),
    dialog.getByRole('button', { name: '开始合并', exact: true }).click(),
  ]);
  expect(response.status()).toBe(200);
  const result = await response.json();
  expect(result).toMatchObject({ mergedGroups: 1, mergedSources: 3, skippedGroups: 0 });
  await expect(dialog).toContainText('已合并 1 组重复音乐，涉及 3 个来源版本。');
  await dialog.screenshot({ path: info.outputPath('bulk-merge-result.png') });
  const replay = await page.request.post(response.url(), {
    headers: { Origin: server.origin, 'X-CSRF-Token': session.csrfToken,
      'Idempotency-Key': response.request().headers()['idempotency-key'] }, data: response.request().postDataJSON(),
  });
  expect(replay.ok()).toBe(true);
  expect(await replay.json()).toEqual(result);
  const merged = await groupedTracks(page, server.origin);
  expect(merged).toHaveLength(1);
  expect(merged[0].versions).toHaveLength(3);
  await server.restart();
  await page.reload();
  await expect(page.getByRole('button', { name: /^展开 .* 的来源版本$/ })).toHaveCount(1);
  expect((await groupedTracks(page, server.origin))[0].versions).toHaveLength(3);
  for (const path of [join(server.selectedRoot, 'selected.wav'), join(server.selectedRoot, 'third.wav'),
    join(server.secondSelectedRoot, 'second-selected.wav')]) {
    expect(readFileSync(path).equals(original)).toBe(true);
  }
});
