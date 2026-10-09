import type { Provider, SourceTrack } from '../api/types';
import { element } from './layout';

export class FileListView {
  readonly providers = element('select');
  readonly refresh = element('button', '刷新列表');
  readonly more = element('button', '加载更多');
  readonly status = element('p');
  private rows = element('tbody');
  onPlay: ((track: SourceTrack) => void) | null = null;
  constructor(root: HTMLElement) {
    const title = element('h2', '音乐文件');
    const label = element('label', '来源'); this.providers.id = 'provider'; label.htmlFor = this.providers.id;
    const tools = element('div'); tools.className = 'toolbar'; tools.append(label, this.providers, this.refresh);
    this.status.setAttribute('role', 'status');
    const table = element('table'); const head = element('thead'); const row = element('tr');
    for (const text of ['名称', '时长 / 格式 / 码率', '可用性', '操作']) row.append(element('th', text));
    head.append(row); table.append(head, this.rows); root.append(title, tools, this.status, table, this.more);
    this.more.hidden = true;
  }
  setProviders(providers: Provider[]): void {
    this.providers.replaceChildren(...providers.map((provider) => { const option = element('option', provider.name); option.value = provider.id; return option; }));
  }
  render(items: SourceTrack[]): void {
    this.rows.replaceChildren(...items.map((track) => {
      const row = element('tr');
      const duration = track.durationMs === null ? '时长未知' : `${Math.round(track.durationMs / 1000)} 秒`;
      const bitrate = track.bitrateBps === null ? '码率未知' : `${Math.round(track.bitrateBps / 1000)} kbps`;
      const button = element('button', '播放'); button.type = 'button'; button.setAttribute('aria-label', `播放 ${track.displayName}`);
      button.disabled = !['available', 'online'].includes(track.availability);
      button.onclick = () => this.onPlay?.(track);
      const action = element('td'); action.append(button);
      row.append(element('td', track.title || track.displayName), element('td', `${duration} / ${track.codec ?? '格式未知'} / ${bitrate}`),
        element('td', track.availability === 'available' ? '可播放' : track.availability === 'missing' ? '文件缺失' : '暂不可用'), action);
      return row;
    }));
  }
}
