import { expect, type Page, type APIRequestContext } from '@playwright/test';
import type { TestServer } from './server';
import { scanFailureMessage, waitForScanJob } from '../fixtures/scan-job';

export async function login(page: Page, server: TestServer): Promise<void> {
  console.log('Opening page for real session login');
  await page.goto(server.origin); await page.getByLabel('管理员登录令牌').fill(server.token);
  await page.getByRole('button', { name: '登录', exact: true }).click(); await expect(page.getByRole('button', { name: '账号菜单' })).toBeVisible();
}
export async function logout(page: Page): Promise<void> {
  await page.getByRole('button', { name: '账号菜单' }).click();
  await page.getByRole('button', { name: '退出登录', exact: true }).click();
}
export async function seekTo(page: Page, seconds: number): Promise<void> {
  const slider = page.getByRole('slider', { name: '曲目进度', exact: true });
  await slider.fill(String(seconds * 1000));
  await slider.dispatchEvent('pointerup');
}
export async function setProcessing(page: Page, enabled: boolean): Promise<void> {
  await page.getByRole('button', { name: '设置', exact: true }).click();
  await page.getByLabel('服务端处理（降低 6 dB，下一首生效）').setChecked(enabled);
  await page.getByRole('link', { name: '曲目列表', exact: true }).click();
}
export async function scan(request: APIRequestContext, origin: string): Promise<void> {
  const session = await (await request.get(`${origin}/api/v1/auth/session`)).json();
  const response = await request.post(`${origin}/api/v1/provider-instances/local/scan-jobs`, {
    headers: { Origin: origin, 'X-CSRF-Token': session.csrfToken, 'Idempotency-Key': crypto.randomUUID() }, data: await scanRequest(request, origin),
  });
  expect(response.ok()).toBeTruthy(); const { jobId } = await response.json();
  const job = await waitScan(request, origin, jobId);
  expect(job.status, scanFailureMessage(job)).toBe('succeeded');
}
export async function waitScan(request: APIRequestContext, origin: string, jobId: string) {
  return waitForScanJob(async (timeout) => {
    const response = await request.get(`${origin}/api/v1/scan-jobs/${encodeURIComponent(jobId)}`, { timeout });
    expect(response.ok()).toBeTruthy(); return response.json();
  }, { onRetry: () => console.log('Scan is waiting for a bounded automatic retry') });
}
export async function scanRequest(request: APIRequestContext, origin: string) {
  const response = await request.get(`${origin}/api/v1/provider-instances`);
  expect(response.ok()).toBeTruthy();
  const providers = await response.json();
  const provider = providers.items.find((item: { id: string }) => item.id === 'local');
  expect(provider.configuration.schemaRevision).toBeTruthy();
  expect(provider.roots.length).toBeGreaterThan(0);
  return { mode: 'full', schemaRevision: provider.configuration.schemaRevision, rootIds: provider.roots.map((root: { id: string }) => root.id), options: {} };
}
export async function waitPlaying(page: Page): Promise<void> {
  await expect.poll(() => page.locator('audio').evaluate((audio: HTMLAudioElement) => ({ paused: audio.paused, time: audio.currentTime, ready: audio.readyState })))
    .toMatchObject({ paused: false });
  await expect.poll(() => page.locator('audio').evaluate((audio: HTMLAudioElement) => audio.currentTime)).toBeGreaterThan(.1);
}

export async function decodedEnergy(page: Page): Promise<number> {
  return (await decodedSignal(page)).rms;
}
export async function decodedSignal(page: Page): Promise<{ rms: number; peakHz: number }> {
  return page.locator('audio').evaluate(async (audio: HTMLAudioElement) => {
    const context = new AudioContext(); await context.resume();
    const source = context.createMediaElementSource(audio); const analyser = context.createAnalyser();
    analyser.fftSize = 2048; source.connect(analyser); analyser.connect(context.destination);
    let maximum = 0; let peakHz = 0; const buffer = new Float32Array(analyser.fftSize);
    const spectrum = new Float32Array(analyser.frequencyBinCount);
    for (let i = 0; i < 20; i++) {
      analyser.getFloatTimeDomainData(buffer);
      maximum = Math.max(maximum, Math.sqrt(buffer.reduce((sum, sample) => sum + sample * sample, 0) / buffer.length));
      analyser.getFloatFrequencyData(spectrum);
      const index = spectrum.reduce((best, value, index) => value > spectrum[best] ? index : best, 0);
      if (spectrum[index] > -80) peakHz = index * context.sampleRate / analyser.fftSize;
      await new Promise((resolve) => setTimeout(resolve, 30));
    }
    source.disconnect(); analyser.disconnect(); await context.close(); return { rms: maximum, peakHz };
  });
}
