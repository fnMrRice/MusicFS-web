import { waitControlRequest } from "../fixtures/control-probe";
import { test, expect, type Page } from '@playwright/test';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { SourceTrack } from '../../src/api/types';
import { duplicateFixture } from './duplicates-fixture';
import type { DirectoryTestServer } from './directory-server';
import { scan, waitPlaying } from './helpers';

let server: DirectoryTestServer | undefined;
test.afterEach(async () => { await server?.stop(); server = undefined; });

// 三份独立合成音频：低码率、较高码率，以及同码率但多一个合法 JUNK 块的较大文件。
function wave(rate: number, channels: number, padding = 0): Buffer {
  const samples = rate * 6;
  const dataSize = samples * channels * 2;
  const bytes = Buffer.alloc(44 + dataSize + (padding ? 8 + padding : 0));
  bytes.write('RIFF'); bytes.writeUInt32LE(bytes.length - 8, 4); bytes.write('WAVEfmt ', 8);
  bytes.writeUInt32LE(16, 16); bytes.writeUInt16LE(1, 20); bytes.writeUInt16LE(channels, 22);
  bytes.writeUInt32LE(rate, 24); bytes.writeUInt32LE(rate * channels * 2, 28);
  bytes.writeUInt16LE(channels * 2, 32); bytes.writeUInt16LE(16, 34);
  bytes.write('data', 36); bytes.writeUInt32LE(dataSize, 40);
  for (let i = 0; i < samples; i++) for (let c = 0; c < channels; c++)
    bytes.writeInt16LE(Math.round(Math.sin(i * 2 * Math.PI * 440 / rate) * 6000), 44 + (i * channels + c) * 2);
  if (padding) { bytes.write('JUNK', 44 + dataSize); bytes.writeUInt32LE(padding, 48 + dataSize); }
  return bytes;
}

async function grouped(page: Page): Promise<SourceTrack> {
  const response = await page.request.get(`${server!.origin}/api/v1/source-tracks?groupBy=recording`);
  expect(response.ok()).toBe(true);
  const result = await response.json();
  expect(result.items).toHaveLength(1);
  return result.items[0];
}

async function playDefault(page: Page, expected: SourceTrack) {
  const [request] = await Promise.all([
    waitControlRequest(page, request => request.url().endsWith('/playback/sessions') && request.method() === 'POST'),
    page.locator('.tracks td.track-actions-cell').getByRole('button', { name: /^播放 / }).click(),
  ]);
  expect(request.postDataJSON().sourceTrackId).toBe(expected.sourceTrackId);
  await waitPlaying(page);
  await page.getByRole('button', { name: '暂停', exact: true }).click();
  await expect.poll(() => page.locator('audio').evaluate((audio: HTMLAudioElement) => audio.paused)).toBe(true);
}

test('automatic quality choice, manual override and clearing survive refresh and restart', async ({ page }, info) => {
  test.setTimeout(180_000);
  const fixture = await duplicateFixture(page, { audioTools: true });
  server = fixture.server;
  // Windows 上初次扫描的音频探测可能正在短暂持有样本文件。
  for (const [path, data] of [
    [join(server.selectedRoot, 'selected.wav'), wave(22050, 1)],
    [join(server.secondSelectedRoot, 'second-selected.wav'), wave(48000, 2)],
    [join(server.selectedRoot, 'third.wav'), wave(48000, 2, 4096)],
  ] as const) {
    await expect(() => writeFileSync(path, data)).toPass({ timeout: 5000 });
  }
  await scan(page.request, server.origin);
  const tracks = (await (await page.request.get(`${server.origin}/api/v1/source-tracks`)).json()).items as SourceTrack[];
  const low = tracks.find(track => track.displayName === 'selected.wav')!;
  const high = tracks.find(track => track.displayName === 'third.wav')!;
  expect(low.bitrateBps).toBe(352800); expect(high.bitrateBps).toBe(1536000);
  const session = await (await page.request.get(`${server.origin}/api/v1/auth/session`)).json();
  const revision = await (await page.request.get(`${server.origin}/api/v1/matching/revision`)).json();
  const merged = await page.request.post(`${server.origin}/api/v1/matching/links`, {
    headers: { Origin: server.origin, 'X-CSRF-Token': session.csrfToken, 'Idempotency-Key': crypto.randomUUID() },
    data: { expectedRevision: revision.revision, sourceTrackIds: tracks.map(track => track.sourceTrackId), targetRecordingId: null },
  });
  expect(merged.ok()).toBe(true);
  expect(await grouped(page)).toMatchObject({ sourceTrackId: high.sourceTrackId, manualSourceTrackId: null });
  expect((await grouped(page)).versions?.map(track => track.displayName)).toEqual(['third.wav', 'second-selected.wav', 'selected.wav']);
  await page.reload();
  await playDefault(page, high);
  await page.getByRole('button', { name: /^展开 .* 的来源版本$/ }).click();
  const versions = page.getByLabel('来源版本', { exact: true });
  await expect(versions).toContainText('自动默认');
  await expect(versions).toContainText('1536 kbps');
  await versions.getByRole('button', { name: 'selected.wav 的更多操作', exact: true }).click();
  const [saved] = await Promise.all([
    page.waitForResponse(response => response.url().endsWith('/matching/default-source') && response.request().method() === 'POST'),
    page.getByRole('menuitem', { name: '设为默认', exact: true }).click(),
  ]);
  expect(saved.ok()).toBe(true);
  expect(saved.request().postDataJSON().sourceTrackId).toBe(low.sourceTrackId);
  await expect(versions).toBeVisible();
  await expect(versions).toContainText('手动默认');
  await expect.poll(async () => (await grouped(page)).sourceTrackId).toBe(low.sourceTrackId);
  await playDefault(page, low);
  await page.screenshot({ path: info.outputPath('manual-default-version.png') });
  await server.restart(); await page.reload();
  expect(await grouped(page)).toMatchObject({ sourceTrackId: low.sourceTrackId, manualSourceTrackId: low.sourceTrackId });
  await page.getByRole('button', { name: /^展开 .* 的来源版本$/ }).click();
  await expect(versions).toContainText('手动默认');
  await versions.getByRole('button', { name: 'selected.wav 的更多操作', exact: true }).click();
  const [cleared] = await Promise.all([
    page.waitForResponse(response => response.url().endsWith('/matching/default-source') && response.request().method() === 'POST'),
    page.getByRole('menuitem', { name: '取消默认', exact: true }).click(),
  ]);
  expect(cleared.ok()).toBe(true); expect(cleared.request().postDataJSON().sourceTrackId).toBeNull();
  await expect(versions).toBeVisible(); await expect(versions).toContainText('自动默认');
  await expect.poll(async () => (await grouped(page)).sourceTrackId).toBe(high.sourceTrackId);
  await playDefault(page, high);
  await page.reload();
  expect(await grouped(page)).toMatchObject({ sourceTrackId: high.sourceTrackId, manualSourceTrackId: null });
  await page.getByRole('button', { name: /^展开 .* 的来源版本$/ }).click();
  await page.screenshot({ path: info.outputPath('automatic-default-version.png') });
});
