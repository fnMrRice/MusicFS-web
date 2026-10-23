import { observeControl } from "../fixtures/control-probe";
import { instanceIds } from "../fixtures/plugins";
import { expect, type Page, type APIRequestContext } from '@playwright/test';
import type { TestServer } from './server';
import { scanFailureMessage, waitForScanJob } from '../fixtures/scan-job';
import { installAudioProbe, outputSignal } from '../fixtures/audio-probe';

export async function login(page: Page, server: TestServer): Promise<void> {
  observeControl(page);
  await installAudioProbe(page);
  console.log('Opening page for real session login');
  await page.goto(server.origin); await page.getByLabel('管理员登录令牌').fill(server.token);
  await page.getByRole('button', { name: '登录', exact: true }).click(); await expect(page.getByRole('button', { name: '账号菜单' })).toBeVisible();
}
export async function logout(page: Page): Promise<void> {
  await page.getByRole('button', { name: '账号菜单' }).click();
  await page.getByRole('region', { name: '账号操作', exact: true }).getByRole('button', { name: '退出登录', exact: true }).click();
}
export async function seekTo(page: Page, seconds: number): Promise<void> {
  const slider = page.getByRole('slider', { name: '曲目进度', exact: true });
  await slider.fill(String(seconds * 1000));
  await slider.dispatchEvent('pointerup');
}
export async function setProcessing(page: Page, enabled: boolean): Promise<void> {
  await page.getByRole('button', { name: '设置', exact: true }).click();
  await page.getByRole('navigation', { name: '设置分类', exact: true }).getByRole('button', { name: '播放配置', exact: true }).click();
  await page.getByLabel('强制服务端转码（下一首生效）').setChecked(enabled);
  const expand = page.getByRole('button', { name: '展开作品库', exact: true });
  if (await expand.isVisible()) await expand.click();
  await page.getByRole('link', { name: '曲目列表', exact: true }).click();
}
export async function scan(request: APIRequestContext, origin: string): Promise<void> {
  const session = await (await request.get(`${origin}/api/v1/auth/session`)).json();
  const response = await request.post(`${origin}/api/v1/provider-instances/${instanceIds.local}/scan-jobs`, {
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
  const provider = providers.items.find((item: { id: string }) => item.id === instanceIds.local);
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
  return outputSignal(page);
}
