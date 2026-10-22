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
  it('fades a playing song before replacing it and fades in the new selection', async () => {
    const s = setup();
    const fade = deferred<void>();
    s.audio.fadeOut = vi.fn().mockReturnValue(fade.promise);
    s.audio.fadeIn = vi.fn();
    s.controller.setTransitions(true, 500);
    await s.controller.select(track);
    expect(s.audio.fadeIn).toHaveBeenCalledWith(500);
    s.event('playing');
    const changing = s.controller.select({ ...track, sourceTrackId: 'other' });
    expect(s.audio.fadeOut).toHaveBeenCalledWith(500);
    expect(s.api.create).toHaveBeenCalledOnce();
    fade.resolve(); await changing;
    expect(s.api.create).toHaveBeenCalledTimes(2);
    expect(s.audio.fadeIn).toHaveBeenCalledTimes(2);
    s.controller.stop();
  });
  it('a stop during fade cancels the pending selection', async () => {
    const s = setup(); const fade = deferred<void>();
    s.audio.fadeOut = vi.fn().mockReturnValue(fade.promise);
    s.controller.setTransitions(true, 300);
    await s.controller.select(track); s.event('playing');
    const changing = s.controller.select({ ...track, sourceTrackId: 'other' });
    s.controller.stop(); fade.resolve(); await changing;
    expect(s.api.create).toHaveBeenCalledOnce();
    expect(s.controller.state.phase).toBe('idle');
  });
  it('a pause during the outgoing fade leaves the next selection paused', async () => {
    const s = setup(); const fade = deferred<void>();
    s.audio.fadeOut = vi.fn().mockReturnValue(fade.promise);
    s.controller.setTransitions(true, 300);
    await s.controller.select(track); s.event('playing');
    const changing = s.controller.select({ ...track, sourceTrackId: 'other' });
    s.controller.toggle(); fade.resolve(); await changing;
    expect(s.audio.play).toHaveBeenCalledOnce();
    expect(s.controller.state.phase).toBe('paused');
    s.controller.stop();
  });
  it('a valid native seek cancels every pending fading selection before its promise resumes', async () => {
    const s = setup(); const first = deferred<void>(); const second = deferred<void>();
    const cancelled = vi.fn(); s.controller.onSelectionCancelled = cancelled;
    s.audio.fadeOut = vi.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    s.audio.cancelFade = vi.fn(() => { first.resolve(); second.resolve(); });
    s.controller.setTransitions(true, 300);
    await s.controller.select(track); s.event('playing');
    const one = s.controller.select({ ...track, sourceTrackId: 'next' });
    const two = s.controller.select({ ...track, sourceTrackId: 'later' });
    s.controller.seek(10_000);
    await Promise.all([one, two]);
    expect(cancelled).toHaveBeenCalledOnce();
    expect(s.api.create).toHaveBeenCalledOnce();
    expect(s.audio.seek).toHaveBeenCalledWith(10);
    expect(s.controller.state.track?.sourceTrackId).toBe(track.sourceTrackId);
    s.controller.stop();
  });
  it('an invalid native seek leaves the pending selection and fade intact', async () => {
    const s = setup(); const fade = deferred<void>();
    const cancelled = vi.fn(); s.controller.onSelectionCancelled = cancelled;
    s.audio.fadeOut = vi.fn().mockReturnValue(fade.promise); s.audio.cancelFade = vi.fn();
    Object.defineProperty(s.audio, 'seekable', { value: [{ start: 0, end: 5 }] });
    s.controller.setTransitions(true, 300);
    await s.controller.select(track); s.event('playing');
    const changing = s.controller.select({ ...track, sourceTrackId: 'next' });
    s.controller.seek(40_000); s.controller.seek(10_000);
    expect(cancelled).not.toHaveBeenCalled();
    expect(s.audio.cancelFade).not.toHaveBeenCalled();
    fade.resolve(); await changing;
    expect(s.controller.state.track?.sourceTrackId).toBe('next');
    s.controller.stop();
  });
  it('a server seek cancels the pending song and keeps the original session', async () => {
    const descriptor = { ...playback(), seekMode: 'timeRestart' } as Playback;
    const s = setup(vi.fn().mockResolvedValue(descriptor)); const fade = deferred<void>();
    const cancelled = vi.fn(); s.controller.onSelectionCancelled = cancelled;
    s.audio.fadeOut = vi.fn().mockReturnValue(fade.promise);
    s.audio.cancelFade = vi.fn(() => fade.resolve());
    s.api.control.mockResolvedValue({ ...descriptor, attemptId: 'seeked', positionOriginMs: 10_000 });
    s.controller.setTransitions(true, 300);
    await s.controller.select(track); s.event('playing');
    const changing = s.controller.select({ ...track, sourceTrackId: 'next' });
    s.controller.seek(10_000); await changing; await Promise.resolve();
    expect(cancelled).toHaveBeenCalledOnce();
    expect(s.api.create).toHaveBeenCalledOnce();
    expect(s.api.control).toHaveBeenCalledOnce();
    expect(s.controller.state.track?.sourceTrackId).toBe(track.sourceTrackId);
    expect(s.controller.state.playback?.attemptId).toBe('seeked');
    s.controller.stop();
  });
  it('fades a natural ending once and cancels the envelope on a seek', async () => {
    const s = setup();
    s.audio.fadeOut = vi.fn().mockResolvedValue(undefined); s.audio.cancelFade = vi.fn();
    s.controller.setTransitions(true, 500);
    await s.controller.select(track); s.event('playing');
    s.event('timeupdate', 29.6); s.event('timeupdate', 29.8);
    expect(s.audio.fadeOut).toHaveBeenCalledOnce();
    expect(s.audio.fadeOut).toHaveBeenCalledWith(400);
    s.controller.seek(10000);
    expect(s.audio.cancelFade).toHaveBeenCalled();
    expect(s.audio.seek).toHaveBeenCalledWith(10);
    s.controller.stop();
  });
  it('requests local effects with no server gain even when a caller has old preferences', async () => {
    const s = setup();
    await s.controller.select(track, { forceProcessing: true, gainDb: -6, dspExecution: 'server' });
    expect(s.api.create.mock.calls[0][2]).toEqual({ forceProcessing: true, gainDb: 0, dspExecution: 'client' });
    s.controller.stop();
  });
  it('refuses an unconfirmed execution mode or a server effect before attaching audio', async () => {
    for (const response of [
      { ...playback(), dspExecution: 'server' },
      { ...playback(), effectiveProcessing: [{ type: 'gain', execution: 'server', gainDb: -6 }] },
    ]) {
      const s = setup(vi.fn().mockResolvedValue(response));
      await s.controller.select(track);
      expect(s.controller.state.phase).toBe('error');
      expect(s.factory).not.toHaveBeenCalled();
      s.controller.stop();
    }
  });
  it('accepts required server conversion and decryption with local effects', async () => {
    const s = setup(vi.fn().mockResolvedValue({ ...playback(), effectiveProcessing: [
      { type: 'channelMix', execution: 'server' }, { type: 'ncmDecrypt', execution: 'server' },
    ] }));
    await s.controller.select(track);
    expect(s.factory).toHaveBeenCalledOnce();
    s.controller.stop();
  });
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
