import { test, expect } from '@playwright/test';
import { basename } from 'node:path';
import { startDirectoryServer, type DirectoryTestServer } from './directory-server';
import { login } from './helpers';
import { instanceIds } from '../fixtures/plugins';

let server: DirectoryTestServer;
test.beforeAll(async () => {
  test.setTimeout(120_000);
  server = await startDirectoryServer();
});
test.afterAll(async () => { await server?.stop(); });

test('manual scan imports configured folders and refreshes the cached library', async ({ page }, info) => {
  await login(page, server);
  await page.getByRole('link', { name: '曲目列表', exact: true }).click();
  await expect(page.getByText('音乐库还很安静', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '设置', exact: true }).click();
  await expect(page.getByRole('button', { name: '扫描音乐', exact: true })).toBeDisabled();

  const api = page.request;
  const path = `${server.origin}/api/v1/admin/plugin-instances/${instanceIds.local}/configuration`;
  const config = await (await api.get(path)).json();
  const session = await (await api.get(`${server.origin}/api/v1/auth/session`)).json();
  const options = { recursive: false, maxDepth: 0, importLyrics: false, excludePatterns: [], skipHidden: true, respectNoMedia: true };
  const response = await api.put(path, {
    headers: { Origin: server.origin, 'X-CSRF-Token': session.csrfToken, 'If-Match': config.revision, 'Idempotency-Key': crypto.randomUUID() },
    data: { musicRoots: [
      { id: 'first-root', name: basename(server.selectedRoot), path: server.selectedRoot, importDefaults: options },
      { id: 'second-root', name: basename(server.secondSelectedRoot), path: server.secondSelectedRoot, importDefaults: { ...options, recursive: true } },
    ] },
  });
  expect(response.status()).toBe(202);
  const operation = await response.json();
  await expect.poll(async () => (await (await api.get(`${server.origin}/api/v1/admin/plugin-operations/${operation.operationId}`)).json()).status).toBe('succeeded');
  await expect(page.getByRole('button', { name: '扫描音乐', exact: true })).toBeEnabled();
  const [submitted] = await Promise.all([
    page.waitForResponse(response => response.url().endsWith(`/provider-instances/${instanceIds.local}/scan-jobs`) && response.request().method() === 'POST'),
    page.getByRole('button', { name: '扫描音乐', exact: true }).click(),
  ]);
  expect(submitted.status()).toBe(202);
  expect(submitted.request().postDataJSON()).toEqual({
    mode: 'full', schemaRevision: 'local-import-v5', rootIds: ['first-root', 'second-root'], options: {},
  });
  await expect(page.getByRole('status').filter({ hasText: '扫描完成' })).toContainText('3');
  await page.locator('.local-music-source').screenshot({ path: info.outputPath('manual-scan-success.png') });
  const tracks = await (await api.get(`${server.origin}/api/v1/source-tracks`)).json();
  expect(tracks.items.map((track: { displayName: string }) => track.displayName).sort()).toEqual(['second-depth-one.wav', 'second-selected.wav', 'selected.wav']);
  await page.getByRole('link', { name: '曲目列表', exact: true }).click();
  for (const name of ['selected.wav', 'second-selected.wav', 'second-depth-one.wav']) {
    await expect(page.getByText(name, { exact: true }).first()).toBeVisible();
  }
  await expect(page.getByText('音乐库还很安静', { exact: true })).toHaveCount(0);
});
