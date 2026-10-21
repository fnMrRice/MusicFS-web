import { describe, expect, it, vi } from 'vitest';
import { PlayerController } from '../../../src/player/controller';
import type { AudioPort, MediaObservation } from '../../../src/player/audio-adapter';
import type { Playback } from '../../../src/api/types';
import { deferred, playback, track } from '../../fixtures/dto';
import { ApiError } from '../../../src/api/client';

function setup(create = vi.fn().mockResolvedValue(playback())) {
  let observe: (event: MediaObservation) => void = () => {};
  const audio: AudioPort = { play: vi.fn().mockResolvedValue(undefined), pause: vi.fn(), destroy: vi.fn(), seek: vi.fn(), seconds: 0, seekable: [{ start: 0, end: 30 }] };
  const api = { create, close: vi.fn().mockResolvedValue(undefined), control: vi.fn().mockResolvedValue(playback('a2')) };
  const factory = vi.fn((_url: string, callback: typeof observe) => { observe = callback; return audio; });
  const controller = new PlayerController(api, factory, { htmlAudio: true, formats: [] });
  return { controller, api, audio, factory, event: (type: MediaObservation['type'], seconds = 0, paused = false) => observe({ type, seconds, paused }) };
}
describe('Player controller (Mock media; not decoder validation)', () => {
  it('shows playback-specific guidance when a required decoder is unavailable', async () => {
    const s = setup(vi.fn().mockRejectedValue(new ApiError('UNSUPPORTED', 'NCM decryption plugin is unavailable', 415)));
    await s.controller.select(track);
    expect(s.controller.state.phase).toBe('error');
    expect(s.controller.state.message).toContain('解密或转码');
    expect(s.controller.state.message).toContain('插件是否已启用');
    expect(s.controller.state.message).toContain('音频文件是否完整');
    expect(s.factory).not.toHaveBeenCalled();
    expect(s.api.create).toHaveBeenCalledOnce();
  });
  it('only the latest song is attached and late sessions are closed', async () => {
    const old = deferred<Playback>(); const fresh = deferred<Playback>();
    const s = setup(vi.fn().mockReturnValueOnce(old.promise).mockReturnValueOnce(fresh.promise));
    const first = s.controller.select(track); const second = s.controller.select({ ...track, sourceTrackId: 'other' });
    fresh.resolve({ ...playback('new'), sessionId: 'new-session' }); await second;
    old.resolve(playback('old')); await first;
    expect(s.factory).toHaveBeenCalledOnce(); expect(s.api.close).toHaveBeenCalledWith('session-1');
    expect(s.controller.state.playback?.attemptId).toBe('new');
  });
  it('stopping while loading prevents a late response from playing', async () => {
    const pending = deferred<Playback>(); const s = setup(vi.fn().mockReturnValue(pending.promise));
    const load = s.controller.select(track); s.controller.stop(); pending.resolve(playback()); await load;
    expect(s.factory).not.toHaveBeenCalled(); expect(s.controller.state.phase).toBe('idle');
  });
  it('waits for playing events and honors native pause and ended without recovery', async () => {
    const s = setup(); await s.controller.select(track); expect(s.controller.state.phase).toBe('loading');
    s.event('playing'); expect(s.controller.state.phase).toBe('playing');
    s.event('pause', 2, true); expect(s.controller.state.wantsPlay).toBe(false);
    s.event('ended', 30, true); expect(s.api.control).not.toHaveBeenCalled(); s.controller.stop();
  });
  it('does not seek outside server and browser ranges', async () => {
    const s = setup(); await s.controller.select(track); s.controller.seek(40_000); expect(s.audio.seek).not.toHaveBeenCalled();
    s.controller.seek(10_000); expect(s.audio.seek).toHaveBeenCalledWith(10); s.controller.stop();
  });
  it('ignores old media callbacks after stop', async () => {
    const s = setup(); await s.controller.select(track); s.controller.stop(); s.event('playing');
    expect(s.controller.state.phase).toBe('idle');
  });
  it('autoplay denial preserves the current session without reporting source failure', async () => {
    const s = setup(); vi.mocked(s.audio.play).mockRejectedValueOnce(new DOMException('Gesture required', 'NotAllowedError'));
    await s.controller.select(track); await Promise.resolve();
    expect(s.controller.state.phase).toBe('paused'); expect(s.controller.state.playback).not.toBeNull();
    expect(s.api.control).not.toHaveBeenCalled(); s.controller.stop();
  });
  it('processed seek while paused reloads without replaying or setting absolute output time', async () => {
    const descriptor = { ...playback(), deliveryMode: 'processed', seekMode: 'timeRestart' } as Playback;
    const s = setup(vi.fn().mockResolvedValue(descriptor));
    s.api.control.mockResolvedValue({ ...descriptor, attemptId: 'a2', positionOriginMs: 12_000 });
    await s.controller.select(track); s.event('pause', 1, true); s.controller.seek(12_000);
    await Promise.resolve(); await Promise.resolve();
    expect(s.controller.state.positionMs).toBe(12_000); expect(s.controller.state.phase).toBe('paused');
    expect(s.audio.play).toHaveBeenCalledOnce(); expect(s.audio.seek).not.toHaveBeenCalled(); s.controller.stop();
  });
  it('custom pause and volume survive a processed replacement', async () => {
    const descriptor = { ...playback(), seekMode: 'timeRestart' } as Playback;
    const s = setup(vi.fn().mockResolvedValue(descriptor)); s.audio.setVolume = vi.fn();
    s.controller.setVolume(.35); await s.controller.select(track);
    expect(s.audio.setVolume).toHaveBeenCalledWith(.35);
    s.controller.toggle(); expect(s.audio.pause).toHaveBeenCalledOnce();
    expect(s.controller.state.wantsPlay).toBe(false);
    s.api.control.mockResolvedValue({ ...descriptor, attemptId: 'next', positionOriginMs: 4000 });
    s.controller.seek(4000); await Promise.resolve(); await Promise.resolve();
    expect(s.audio.play).toHaveBeenCalledOnce(); expect(s.audio.setVolume).toHaveBeenLastCalledWith(.35);
    s.controller.toggle(); expect(s.audio.play).toHaveBeenCalledTimes(2); s.controller.stop();
  });
});
