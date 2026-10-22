import { instanceIds } from "../fixtures/plugins";
import { expect, test, type Page, type TestInfo } from '@playwright/test';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { Playback } from '../../src/api/types';
import { decodedSignal, login, logout, seekTo, scan, waitPlaying } from './helpers';
import { startServer, type TestServer } from './server';

let server: TestServer;
test.beforeAll(async () => { test.setTimeout(120_000); server = await startServer({ ncm: true }); });
test.afterAll(async () => { await server?.stop(); });
test.beforeEach(async ({ page }) => {
  await login(page, server); await scan(page.request, server.origin);
  await page.getByRole('button', { name: '刷新列表' }).click();
  await expect(page.getByRole('button', { name: '播放 synthetic-mp3.ncm', exact: true })).toBeVisible();
});

async function choose(page: Page, filename: string): Promise<Playback> {
  const [response] = await Promise.all([
    page.waitForResponse((response) => response.url().endsWith('/playback/sessions') && response.request().method() === 'POST'),
    page.getByRole('button', { name: `播放 ${filename}`, exact: true }).click(),
  ]);
  expect(response.ok()).toBeTruthy(); return response.json();
}
async function evidence(info: TestInfo, name: string, details: Record<string, unknown>): Promise<void> {
  const report = { ...details, fixtureManifest: JSON.parse(readFileSync(join(server.directory, 'music', 'ncm-fixtures.json'), 'utf8')),
    mediaSource: 'Project CC0 synthetic audio; independently wrapped NCM', physicalListening: 'Not performed' };
  writeFileSync(join(server.directory, name), JSON.stringify(report, null, 2));
  await info.attach(name, { body: JSON.stringify(report, null, 2), contentType: 'application/json' });
}

test('NCM MP3 decrypts to exact Range bytes and native browser audio without DSP', async ({ page, browser }, info) => {
  const descriptor = await choose(page, 'synthetic-mp3.ncm');
  expect(descriptor).toMatchObject({ deliveryMode: 'proxy', seekMode: 'byteRange', outputProfile: { mime: 'audio/mpeg', codec: 'mp3' } });
  expect(descriptor.effectiveProcessing).toEqual([{ type: 'ncmDecrypt', gainDb: 0, version: '1', execution: 'server' }]);
  await expect(page.locator('.player-status')).toContainText('NCM → MP3 · ');
  await expect(page.locator('.player-status')).toContainText('kbps');
  await waitPlaying(page);
  const original = readFileSync(resolve(import.meta.dirname, '../../../server/tests/testdata/audio/vbr-untagged.mp3'));
  const head = await page.request.head(`${server.origin}${descriptor.streamUrl}`);
  expect(head.status()).toBe(200); expect(Number(head.headers()['content-length'])).toBe(original.length);
  const range = await page.request.get(`${server.origin}${descriptor.streamUrl}`, { headers: { Range: 'bytes=257-768' } });
  expect(range.status()).toBe(206); expect(range.headers()['content-range']).toBe(`bytes 257-768/${original.length}`);
  expect(await range.body()).toEqual(original.subarray(257, 769));
  const complete = await page.request.get(`${server.origin}${descriptor.streamUrl}`);
  const digest = createHash('sha512').update(await complete.body()).digest('hex');
  expect(digest).toBe(createHash('sha512').update(original).digest('hex'));
  await seekTo(page, 4.5);
  await expect.poll(() => page.locator('audio').evaluate((audio: HTMLAudioElement) => audio.currentTime)).toBeGreaterThanOrEqual(4.3);
  const signal = await decodedSignal(page); expect(signal.rms).toBeGreaterThan(.01);
  await page.getByRole('region', { name: '播放器', exact: true }).screenshot({ path: info.outputPath('ncm-mp3-player.png') });
  await logout(page); await expect(page.locator('audio')).toHaveCount(0);
  await evidence(info, 'ncm-mp3-evidence.json', { browser: browser.version(), descriptor, sourceSha512: digest,
    range: range.headers()['content-range'], decodedSignal: signal, seekTargetMs: 4500 });
});

test('NCM FLAC uses browser capabilities to deliver exact FLAC bytes and native seeking', async ({ page, browser }, info) => {
  const [request, descriptor] = await Promise.all([
    page.waitForRequest((request) => request.url().endsWith('/playback/sessions') && request.method() === 'POST'),
    choose(page, 'synthetic-flac.ncm'),
  ]);
  const formats = request.postDataJSON().capabilities.formats;
  expect(formats.find((format: { mime: string }) => format.mime === 'audio/flac').canPlay).toMatch(/^(maybe|probably)$/);
  expect(descriptor).toMatchObject({ deliveryMode: 'proxy', seekMode: 'byteRange',
    outputProfile: { mime: 'audio/flac', codec: 'flac', bitrateBps: 116162, channels: 2, sampleRate: 48000 } });
  expect(descriptor.effectiveProcessing).toEqual([{ type: 'ncmDecrypt', gainDb: 0, version: '1', execution: 'server' }]);
  await expect(page.locator('.player-status')).toHaveText('NCM → FLAC · 116.2 kbps · 2 声道');
  await expect(page.locator('.player-status')).toHaveAttribute('title', /来源码率：116.2 kbps\n发送码率：116.2 kbps/);
  await waitPlaying(page);
  const original = readFileSync(resolve(import.meta.dirname, '../../../server/tests/testdata/audio/lossless.flac'));
  const range = await page.request.get(`${server.origin}${descriptor.streamUrl}`, { headers: { Range: 'bytes=257-768' } });
  expect(range.status()).toBe(206); expect(range.headers()['content-range']).toBe(`bytes 257-768/${original.length}`);
  expect(await range.body()).toEqual(original.subarray(257, 769));
  const complete = await page.request.get(`${server.origin}${descriptor.streamUrl}`);
  expect(complete.headers()['content-type']).toBe('audio/flac');
  const digest = createHash('sha512').update(await complete.body()).digest('hex');
  expect(digest).toBe(createHash('sha512').update(original).digest('hex'));
  await seekTo(page, 4);
  await expect.poll(() => page.locator('audio').evaluate((audio: HTMLAudioElement) => audio.currentTime)).toBeGreaterThanOrEqual(3.8);
  expect(await page.locator('audio').getAttribute('src')).toContain(descriptor.streamUrl);
  const signal = await decodedSignal(page); expect(signal.rms).toBeGreaterThan(.01);
  expect(signal.peakHz).toBeGreaterThan(600); expect(signal.peakHz).toBeLessThan(700);
  await page.getByRole('region', { name: '播放器', exact: true }).screenshot({ path: info.outputPath('ncm-flac-original-player.png') });
  await logout(page); await expect(page.locator('audio')).toHaveCount(0);
  await evidence(info, 'ncm-flac-original-evidence.json', { browser: browser.version(), formats, descriptor,
    sourceSha512: digest, range: range.headers()['content-range'], decodedSignal: signal, seekTargetMs: 4000 });
});

test('unsupported FLAC converts at the nearest MP3 bitrate and timeRestart reaches the real marker', async ({ page, browser }, info) => {
  await page.addInitScript(() => {
    const original = HTMLMediaElement.prototype.canPlayType;
    HTMLMediaElement.prototype.canPlayType = function (mime: string) {
      return mime.split(';')[0]?.trim().toLowerCase() === 'audio/flac' ? '' : original.call(this, mime);
    };
  });
  await page.reload();
  const [request, descriptor] = await Promise.all([
    page.waitForRequest((request) => request.url().endsWith('/playback/sessions') && request.method() === 'POST'),
    choose(page, 'synthetic-flac.ncm'),
  ]);
  const formats = request.postDataJSON().capabilities.formats;
  expect(formats).toContainEqual({ mime: 'audio/flac', canPlay: '' });
  expect(descriptor).toMatchObject({ deliveryMode: 'processed', seekMode: 'timeRestart', outputProfile: { mime: 'audio/mpeg', codec: 'mp3' } });
  expect(descriptor.effectiveProcessing).toContainEqual({ type: 'ncmDecrypt', gainDb: 0, version: '1', execution: 'server' });
  expect(descriptor.outputProfile.bitrateBps).toBe(112000);
  await expect(page.locator('.player-status')).toHaveText('NCM → FLAC → MP3 · 112 kbps · 2 声道');
  await expect(page.locator('.player-status')).toHaveAttribute('title', /来源码率：116.2 kbps\n发送码率：112 kbps/);
  await waitPlaying(page);
  const [response] = await Promise.all([
    page.waitForResponse((response) => response.url().endsWith('/seek') && response.ok()),
    (async () => { await seekTo(page, 4); })(),
  ]);
  const located: Playback = await response.json();
  expect(located.outputProfile).toEqual(descriptor.outputProfile);
  expect(located.positionOriginMs).toBe(4000); expect(located.attemptId).not.toBe(descriptor.attemptId);
  expect(located.streamUrl).not.toBe(descriptor.streamUrl); await waitPlaying(page);
  expect(await page.locator('audio').evaluate((audio: HTMLAudioElement) => audio.currentTime)).toBeLessThan(2);
  const signal = await decodedSignal(page); expect(signal.rms).toBeGreaterThan(.01);
  expect(signal.peakHz).toBeGreaterThan(600); expect(signal.peakHz).toBeLessThan(700);
  await page.getByRole('region', { name: '播放器', exact: true }).screenshot({ path: info.outputPath('ncm-flac-player.png') });
  await logout(page); await expect(page.locator('audio')).toHaveCount(0);
  await evidence(info, 'ncm-flac-evidence.json', { browser: browser.version(), formats, descriptor, located, decodedSignal: signal });
});

test('malformed NCM fails explicitly and does not prevent original WAV playback', async ({ page, browser }, info) => {
  const session = await (await page.request.get(`${server.origin}/api/v1/auth/session`)).json();
  const tracks = await (await page.request.get(`${server.origin}/api/v1/source-tracks?providerInstanceId=${instanceIds.local}&limit=100`)).json();
  const invalid = tracks.items.find((track: { displayName: string }) => track.displayName === 'corrupt.ncm');
  expect(invalid).toBeDefined();
  const rejected = await page.request.post(`${server.origin}/api/v1/playback/sessions`, {
    headers: { Origin: server.origin, 'X-CSRF-Token': session.csrfToken, 'Idempotency-Key': crypto.randomUUID() },
    data: { sourceTrackId: invalid.sourceTrackId, capabilities: { htmlAudio: true, formats: [{ mime: 'audio/mpeg', canPlay: 'probably' }] }, preferences: { forceProcessing: false, gainDb: 0 } },
  });
  expect(rejected.status()).toBe(415); const error = await rejected.json();
  expect(error.error.code).toBe('UNSUPPORTED'); expect(error.error.requestId).toBeTruthy();
  expect(JSON.stringify(error)).not.toContain(server.directory);
  const invalidButton = page.getByRole('button', { name: '播放 corrupt.ncm', exact: true });
  const selectable = await invalidButton.isEnabled();
  if (selectable) {
    await invalidButton.click(); await expect(page.getByRole('button', { name: '从头播放', exact: true })).toBeVisible();
    await expect(page.locator('audio')).toHaveCount(0);
  }
  const descriptor = await choose(page, 'markers.wav');
  expect(descriptor).toMatchObject({ deliveryMode: 'proxy', seekMode: 'byteRange', effectiveProcessing: [] }); await waitPlaying(page);
  const signal = await decodedSignal(page); expect(signal.rms).toBeGreaterThan(.01);
  await expect(page.getByRole('region', { name: '播放器', exact: true })).not.toContainText('服务端解密');
  await logout(page); await expect(page.locator('audio')).toHaveCount(0);
  await evidence(info, 'ncm-error-evidence.json', { browser: browser.version(), status: rejected.status(), code: error.error.code,
    errorShownByWeb: selectable, invalidAvailability: invalid.availability, recoveredOriginal: descriptor, decodedSignal: signal });
});
