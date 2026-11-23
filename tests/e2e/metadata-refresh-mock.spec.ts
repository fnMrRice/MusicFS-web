import { test, expect } from '@playwright/test';
import { preview, type PreviewServer } from 'vite';
import { taskQueueMock } from '../fixtures/task-queue-mock';

let server: PreviewServer;
const origin = 'http://127.0.0.1:18155';
test.beforeAll(async () => { server = await preview({ preview: { host: '127.0.0.1', port: 18155, strictPort: true } }); });
test.afterAll(async () => { await new Promise<void>(resolve => server?.httpServer.close(() => resolve())); });

test('single-folder refresh stays queued through metadata and reload without blocking other folders', async ({ page }, info) => {
  const state = await taskQueueMock(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${origin}/#/settings`);
  const refresh = page.getByRole('button', { name: '刷新目录 Music 的元数据', exact: true });
  await expect(refresh).toHaveText('刷新');
  await refresh.click();
  await expect.poll(() => state.posts.length).toBe(1);
  await expect(page.getByRole('button', { name: '刷新目录 Other 的元数据', exact: true })).toBeEnabled();
  Object.assign(state.tasks[0], { status: 'running', phase: 'metadata', progress: { observed: 2, metadataTotal: 2, metadataCompleted: 1 } });
  state.control.event('activity.changed', { resources: ['tasks'] });
  await page.getByRole('button', { name: '任务队列', exact: true }).click();
  const panel = page.getByRole('region', { name: '任务队列详情' });
  await expect(panel).toContainText('正在更新歌曲信息、封面和歌词 · 1/2');
  expect(await panel.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
  await panel.screenshot({ path: info.outputPath('task-queue-mobile.png') });
  await page.reload();
  await page.getByRole('button', { name: '任务队列', exact: true }).click();
  await expect(panel).toContainText('正在更新歌曲信息、封面和歌词 · 1/2');
  expect(state.posts).toHaveLength(1);
  Object.assign(state.tasks[0], { status: 'succeeded', phase: 'finished', cancellable: false,
    result: { updated: 1, retained: 1, notFound: 0, failed: 0 } });
  state.control.event('activity.changed', { resources: ['tasks'] });
  await expect(panel).toContainText('刷新完成');
  await expect(panel).toContainText('更新 1 · 保留 1 · 未找到 0 · 失败 0');
  expect(state.configWrites).toBe(0);
});

test('metadata partial failures are visible in the task result', async ({ page }) => {
  const state = await taskQueueMock(page);
  await page.goto(`${origin}/#/settings`);
  await page.getByRole('button', { name: '刷新目录 Music 的元数据', exact: true }).click();
  await expect.poll(() => state.tasks.length).toBe(1);
  Object.assign(state.tasks[0], { status: 'failed', phase: 'finished', cancellable: false,
    result: { updated: 1, retained: 0, notFound: 0, failed: 1 } });
  state.control.event('activity.changed', { resources: ['tasks'] });
  await page.getByRole('button', { name: '任务队列', exact: true }).click();
  const panel = page.getByRole('region', { name: '任务队列详情' });
  await expect(panel).toContainText('刷新未完成');
  await expect(panel).toContainText('失败 1');
  await expect(panel).not.toContainText('刷新完成');
});

test('refresh is disabled while the source is unavailable', async ({ page }) => {
  const state = await taskQueueMock(page); state.unavailable = true;
  await page.goto(`${origin}/#/settings`);
  await expect(page.getByRole('button', { name: '刷新目录 Music 的元数据', exact: true })).toBeDisabled();
  await expect(page.getByRole('button', { name: '刷新全部目录', exact: true })).toBeDisabled();
  expect(state.posts).toHaveLength(0);
});

test('unavailable task results remain an error rather than refresh success', async ({ page }) => {
  const state = await taskQueueMock(page); state.listError = true;
  await page.goto(`${origin}/#/settings`);
  await page.getByRole('button', { name: '任务队列', exact: true }).click();
  const panel = page.getByRole('region', { name: '任务队列详情' });
  await expect(panel.getByRole('alert')).toBeVisible();
  await expect(panel).not.toContainText('刷新完成');
});
