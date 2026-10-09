import type { PlayerState } from '../player/state';
import { element } from './layout';

export class PlayerView {
  readonly audioRoot = element('div');
  readonly stop = element('button', '停止');
  readonly position = element('input');
  readonly jump = element('button', '跳转');
  readonly status = element('p');
  readonly processing = element('input');
  readonly restart = element('button', '从头播放');
  private title = element('p', '尚未选择歌曲');
  private progress = element('p');
  private note = element('p');
  constructor(root: HTMLElement) {
    const tools = element('div'); tools.className = 'toolbar';
    const label = element('label', '曲目位置（秒）'); this.position.id = 'position'; label.htmlFor = this.position.id;
    this.position.type = 'number'; this.position.min = '0'; this.position.step = '0.1'; this.position.value = '0';
    tools.append(label, this.position, this.jump, this.restart, this.stop); this.status.setAttribute('role', 'status'); this.note.className = 'muted';
    const processingLabel = element('label', '服务端处理（降低 6 dB，下一首生效）'); this.processing.type = 'checkbox'; this.processing.id = 'processing'; processingLabel.htmlFor = this.processing.id;
    const processingRow = element('div'); processingRow.append(this.processing, processingLabel);
    root.append(element('h2', '播放器'), processingRow, this.title, this.status, this.progress, this.audioRoot, tools, this.note);
  }
  render(state: PlayerState): void {
    const names: Record<string, string> = { idle: '请选择歌曲', resolving: '正在准备…', loading: '正在加载…', playing: '播放中', paused: '已暂停', buffering: '正在缓冲…', seeking: '正在定位…', recovering: '正在恢复…', ended: '播放结束', error: '播放失败' };
    this.title.textContent = state.track?.displayName ?? '尚未选择歌曲';
    this.status.textContent = state.message ?? names[state.phase];
    this.progress.textContent = `曲目位置：${(state.positionMs / 1000).toFixed(1)} 秒`;
    this.stop.disabled = state.phase === 'idle'; this.jump.disabled = !state.playback || state.playback.seekMode === 'none';
    this.restart.hidden = state.phase !== 'error';
    this.position.disabled = this.jump.disabled;
    if (state.playback?.seekableRange) {
      this.position.min = String(state.playback.seekableRange.startMs / 1000);
      this.position.max = String(state.playback.seekableRange.endMs / 1000);
    } else this.position.removeAttribute('max');
    this.note.textContent = state.playback?.deliveryMode === 'processed' ? '服务端处理输出；原生时间轴表示当前输出片段，整首曲目定位请使用上方跳转。' : '原生音频控件可播放、暂停及调整音量。';
  }
}
