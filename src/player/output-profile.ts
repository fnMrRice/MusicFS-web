import type { PlaybackApi } from '../api/playback';
import type { OutputProfile, Playback } from '../api/types';
import type { MediaEvent } from './audio-adapter';

// 在线源可能要到媒体首段读完才知道声道。只查询当前播放的资料，不重新请求音频。
export function observeOutputProfile(api: Pick<PlaybackApi, 'outputProfile'>, playback: Playback, signal: AbortSignal | undefined,
  apply: (profile: OutputProfile & { channels: number }) => void) {
  let trigger: MediaEvent | undefined = playback.outputProfilePending === true && !playback.outputProfile.channels ? 'loadedmetadata' : undefined;
  let retryAt = 0;
  return (event: MediaEvent) => {
    if (event !== trigger || Date.now() < retryAt || signal?.aborted) return;
    trigger = undefined;
    void api.outputProfile(playback.sessionId, playback.attemptId, signal).then(profile => {
      if (signal?.aborted) return;
      if (profile.channels) {
        apply({ ...profile, channels: profile.channels });
      } else if (event === 'loadedmetadata') {
        // 慢速流首次探测还未完成时，播放期间最多补读一次。
        retryAt = Date.now() + 2000;
        trigger = 'timeupdate';
      }
    }).catch(() => { /* 补充资料暂不可用时继续播放。 */ });
  };
}
