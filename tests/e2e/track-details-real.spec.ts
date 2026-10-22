import { test, expect } from '@playwright/test';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { duplicateFixture, groupedTracks } from './duplicates-fixture';
import type { DirectoryTestServer } from './directory-server';

let server: DirectoryTestServer | undefined;
test.afterEach(async () => { await server?.stop(); server = undefined; });

test('expanded versions display details from the selected source plugin and reject changed files', async ({ page }, info) => {
  test.setTimeout(180_000);
  const fixture = await duplicateFixture(page);
  server = fixture.server;
  const filePath = join(server.selectedRoot, 'selected.wav');
  const original = readFileSync(filePath);
  await page.reload();
  await page.getByRole('checkbox', { name: '选择 selected.wav', exact: true }).check();
  await page.getByRole('checkbox', { name: '选择 second-selected.wav', exact: true }).check();
  await page.getByRole('button', { name: '合并歌曲', exact: true }).click();
  await page.getByRole('dialog', { name: '合并歌曲', exact: true })
    .getByRole('button', { name: '确认合并', exact: true }).click();
  await expect.poll(async () => (await groupedTracks(page, server!.origin)).length).toBe(2);
  await page.getByRole('button', { name: /^展开 .* 的来源版本$/ }).click();
  const versions = page.getByLabel('来源版本', { exact: true });
  await expect(versions.getByRole('button', { name: /^查看 .* 的详情$/ })).toHaveCount(2);

  for (const [name, root] of [['selected.wav', 'first-root'], ['second-selected.wav', 'second-root']]) {
    const track = fixture.tracks.find(item => item.displayName === name)!;
    const [response] = await Promise.all([
      page.waitForResponse(item => item.url().endsWith(`/source-tracks/${track.sourceTrackId}/details`)),
      versions.getByRole('button', { name: `查看 ${name} 的详情`, exact: true }).click(),
    ]);
    expect(response.status()).toBe(200);
    const details = await response.json();
    expect(details).toMatchObject({ sourceTrackId: track.sourceTrackId, title: name });
    const fields = details.sections.flatMap((section: { fields: { id: string; value: string }[] }) => section.fields);
    expect(fields).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'relativePath', value: name }),
      expect.objectContaining({ id: 'root', value: root }),
      expect.objectContaining({ id: 'size', value: `${original.length} 字节` }),
    ]));
    expect(JSON.stringify(details)).not.toContain('Allowed Music');
    const dialog = page.getByRole('dialog', { name: '来源版本详情', exact: true });
    await expect(dialog).toContainText(name);
    await expect(dialog).toContainText(root);
    await expect(dialog).toContainText('文件信息');
    await dialog.screenshot({ path: info.outputPath(`${root}-details.png`) });
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    await expect(versions.getByRole('button', { name: `查看 ${name} 的详情`, exact: true })).toBeFocused();
  }

  expect(readFileSync(filePath).equals(original)).toBe(true);
  writeFileSync(filePath, Buffer.concat([original, Buffer.from([0])]));
  const track = fixture.tracks.find(item => item.displayName === 'selected.wav')!;
  const response = await page.request.get(`${server.origin}/api/v1/source-tracks/${track.sourceTrackId}/details`);
  expect(response.status()).toBe(409);
  expect(await response.json()).toMatchObject({ error: { code: 'RESOURCE_CHANGED' } });
});
