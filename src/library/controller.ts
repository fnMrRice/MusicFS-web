import { LibraryApi } from '../api/library';
import { errorMessage } from '../api/client';
import type { Provider } from '../api/types';
import { FileListView } from '../ui/file-list';
import { LibraryState } from './state';

export class LibraryController {
  readonly state: LibraryState;
  private providers: Provider[] = [];
  private generation = 0;
  constructor(private api: LibraryApi, readonly view: FileListView) {
    this.state = new LibraryState((...args) => api.page(...args));
    this.state.onChange = () => this.render();
    view.providers.onchange = () => { void this.state.select(view.providers.value); };
    view.refresh.onclick = () => { void this.open(); };
    view.more.onclick = () => { void this.state.more(); };
  }
  async open(): Promise<void> {
    const generation = ++this.generation; this.view.status.textContent = '正在读取来源…';
    try {
      const providers = await this.api.providers(); if (generation !== this.generation) return;
      const previous = this.view.providers.value; this.providers = providers; this.view.setProviders(providers);
      if (providers.some((p) => p.id === previous)) this.view.providers.value = previous;
      if (!providers.length) { this.view.status.textContent = '暂无已配置的音乐来源，请在 Server 配置音乐目录。'; return; }
      await this.state.select(this.view.providers.value);
    } catch (error) { if (generation === this.generation) this.view.status.textContent = errorMessage(error); }
  }
  clear(): void { ++this.generation; this.providers = []; this.state.clear(); this.view.setProviders([]); }
  private render(): void {
    const state = this.state.snapshot; this.view.render(state.items);
    this.view.more.hidden = !state.cursor; this.view.more.disabled = state.loading;
    const provider = this.providers.find((p) => p.id === this.view.providers.value);
    this.view.status.textContent = state.error ?? (state.loading ? '正在刷新…' : `${state.items.length} 个文件`);
    if (state.stale) this.view.status.textContent += ' 内容可能不是最新。';
    if (!state.loading && !state.error && provider) {
      if (!['available', 'online'].includes(provider.availability)) this.view.status.textContent = '来源暂不可用；保留上次成功扫描的内容。';
      else if (['pending', 'running', 'never'].includes(provider.scanState ?? '')) this.view.status.textContent = '来源扫描尚未完成，请稍后刷新。';
      else if (!state.items.length) this.view.status.textContent = '音乐库为空。';
    }
  }
}
