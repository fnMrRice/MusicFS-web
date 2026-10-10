import type { Provider } from '../api/types';

export function scanStatusMessage(provider: Pick<Provider, 'availability' | 'scanState'>): string | null {
  if (provider.scanState === 'paused') return '扫描已暂停，不会自动继续；保留上次成功扫描的内容。请处理来源或权限问题后重新提交扫描。';
  if (provider.scanState === 'retry_wait') return '扫描暂时失败，正在等待自动重试；保留上次成功扫描的内容，请稍后刷新。';
  if (!['available', 'online'].includes(provider.availability)) return '来源暂不可用；保留上次成功扫描的内容。';
  if (['idle', 'queued', 'pending', 'running', 'never'].includes(provider.scanState ?? '')) return '来源扫描尚未完成，请稍后刷新。';
  if (provider.scanState === 'failed') return '最近扫描失败；保留上次成功扫描的内容，请检查 Server 音乐目录后重新扫描。';
  return null;
}
