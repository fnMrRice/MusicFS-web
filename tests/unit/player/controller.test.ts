import { describe, expect, it, vi } from 'vitest';
import { PlayerController } from '../../../src/player/controller';
import type { AudioPort, MediaObservation } from '../../../src/player/audio-adapter';
import type { Playback } from '../../../src/api/types';
import { deferred, playback, track } from '../../fixtures/dto';
import { ApiError } from '../../../src/api/client';

function setup(create = vi.fn().mockResolvedValue(playback())) {
  let observe: (event: MediaObservation) => void = () => {};
  const audio: AudioPort = { play: vi.fn().mockResolvedValue(undefined), pause: vi.fn(), destroy: vi.fn(), seek: vi.fn(), seconds: 0, seekable: [{ start: 0, end: 30 }] };
  const api = { create, close: vi.fn().mockResolvedValue(undefined), control: vi.fn().mockResolvedValue(playback('a2')), outputProfile: vi.fn() };
  const factory = vi.fn((_url: string, callback: typeof observe) => { observe = callback; return audio; });
  const controller = new PlayerController(api, factory, { htmlAudio: true, formats: [] });
  return { controller, api, audio, factory, event: (type: MediaObservation['type'], seconds = 0, paused = false, readyToPlay = false) => observe({ type, seconds, paused, readyToPlay }) };
}
describe('Player controller (Mock media; not decoder validation)', () => {
  it('reads late channels once for the playing attempt without reloading audio or updating another track', async () => {
    const first = { ...playback(), outputProfilePending: true };
    const other = { ...playback('new'), outputProfilePending: true };
    const s = setup(vi.fn().mockResolvedValueOnce(first).mockResolvedValueOnce(other));
    const delayed = deferred<Playback['outputProfile']>();
    s.api.outputProfile.mockReturnValueOnce(delayed.promise).mockResolvedValueOnce({ ...other.outputProfile, channels: 1 });
    s.audio.setSourceChannels = vi.fn();
    await s.controller.select(track);
    s.event('loadedmetadata'); s.event('loadedmetadata');
    expect(s.api.outputProfile).toHaveBeenCalledExactlyOnceWith(first.sessionId, first.attemptId, expect.any(AbortSignal));
    await s.controller.select(track);
    delayed.resolve({ ...first.outputProfile, channels: 6 });
    await Promise.resolve();
    expect(s.audio.setSourceChannels).not.toHaveBeenCalled();
    s.event('loadedmetadata'); await Promise.resolve();
    expect(s.controller.state.playback?.outputProfile.channels).toBe(1);
    expect(s.audio.setSourceChannels).toHaveBeenCalledExactlyOnceWith(1);
    expect(s.factory).toHaveBeenCalledTimes(2);
    s.controller.stop();
  });
  it('rechecks a slow channel probe only once as playback advances', async () => {
    vi.useFakeTimers();
    const descriptor = { ...playback(), outputProfilePending: true };
    const s = setup(vi.fn().mockResolvedValue(descriptor));
    s.api.outputProfile.mockResolvedValue(descriptor.outputProfile);
    try {
      await s.controller.select(track);
      s.event('loadedmetadata'); await Promise.resolve();
      s.event('timeupdate', 1);
      expect(s.api.outputProfile).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(2000);
      s.event('timeupdate', 3); await Promise.resolve();
      await vi.advanceTimersByTimeAsync(2000);
      s.event('timeupdate', 5);
      expect(s.api.outputProfile).toHaveBeenCalledTimes(2);
      expect(s.controller.state.playback?.outputProfile.channels).toBeUndefined();
    } finally {
      s.controller.stop(); vi.useRealTimers();
    }
  });
  it('starts a new session on demand after restoring a paused track on an existing player', async () => {
    const s = setup();
    await s.controller.select(track);
    s.event('playing', 10);
    s.controller.restorePaused(track);
    expect(s.controller.state).toMatchObject({ track, phase: 'paused', playback: null, positionMs: 0, wantsPlay: false });
    expect(s.api.create).toHaveBeenCalledTimes(1);
    s.controller.toggle();
    await vi.waitFor(() => expect(s.audio.play).toHaveBeenCalledTimes(2));
    expect(s.api.create).toHaveBeenCalledTimes(2);
    s.controller.stop();
  });
  it('reports history once after the active media attempt actually starts playing', async () => {
    const s = setup();
    const reported = vi.fn().mockResolvedValue(undefined);
    s.controller.onPlaybackStarted = reported;
    await s.controller.select(track);
    s.event('waiting');
    expect(reported).not.toHaveBeenCalled();
    s.event('playing');
    s.event('pause');
    s.event('playing');
    expect(reported).toHaveBeenCalledTimes(1);
    expect(reported.mock.calls[0][0]).toMatchObject({sessionId: 'session-1', attemptId: 'a1', sourceTrackId: track.sourceTrackId});
    s.controller.stop();
    s.event('playing');
    expect(reported).toHaveBeenCalledTimes(1);
  });
  it('fades a playing song before replacing it and fades in the new selection', async () => {
    const s = setup();
    const fade = deferred<void>();
    s.audio.fadeOut = vi.fn().mockReturnValue(fade.promise);
    s.audio.fadeIn = vi.fn();
    s.controller.setTransitions({ enabled: true, trackMs: 500, seekMs: 0, pauseMs: 0 });
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
    s.controller.setTransitions({ enabled: true, trackMs: 300, seekMs: 0, pauseMs: 0 });
    await s.controller.select(track); s.event('playing');
    const changing = s.controller.select({ ...track, sourceTrackId: 'other' });
    s.controller.stop(); fade.resolve(); await changing;
    expect(s.api.create).toHaveBeenCalledOnce();
    expect(s.controller.state.phase).toBe('idle');
  });
  it('a pause during the outgoing fade leaves the next selection paused', async () => {
    const s = setup(); const fade = deferred<void>();
    s.audio.fadeOut = vi.fn().mockReturnValue(fade.promise);
    s.audio.fadeIn = vi.fn();
    s.controller.setTransitions({ enabled: true, trackMs: 300, seekMs: 0, pauseMs: 0 });
    await s.controller.select(track); s.event('playing');
    const changing = s.controller.select({ ...track, sourceTrackId: 'other' });
    s.controller.toggle(); fade.resolve(); await changing;
    expect(s.audio.play).toHaveBeenCalledOnce();
    expect(s.controller.state.phase).toBe('paused');
    s.controller.toggle();
    expect(s.audio.fadeIn).toHaveBeenCalledTimes(1);
    s.controller.stop();
  });
  it('uses the pause duration before pausing and when resuming the same audio', async () => {
    const s = setup(), fade = deferred<void>();
    s.audio.fadeOut = vi.fn().mockReturnValue(fade.promise);
    s.audio.fadeIn = vi.fn();
    s.controller.setTransitions({ enabled: true, trackMs: 190, pauseMs: 815, seekMs: 930 });
    await s.controller.select(track); s.event('playing');
    expect(s.audio.fadeIn).toHaveBeenCalledWith(190);
    s.controller.toggle();
    expect(s.audio.fadeOut).toHaveBeenCalledWith(815);
    expect(s.audio.pause).not.toHaveBeenCalled();
    s.event('playing'); s.event('ended', 30, true);
    expect(s.controller.state.phase).toBe('paused');
    fade.resolve(); await fade.promise;
    expect(s.audio.pause).toHaveBeenCalledOnce();
    s.controller.toggle();
    expect(s.audio.fadeIn).toHaveBeenLastCalledWith(815);
    expect(s.audio.play).toHaveBeenCalledTimes(2);
    expect(s.api.create).toHaveBeenCalledOnce();
    s.controller.stop();
  });
  it('reverses an unfinished pause from its current gain and ignores the cancelled completion', async () => {
    const s = setup(), fade = deferred<void>();
    s.audio.fadeOut = vi.fn().mockReturnValue(fade.promise);
    s.audio.fadeIn = vi.fn();
    await s.controller.select(track); s.event('playing');
    s.controller.toggle(); s.controller.toggle();
    expect(s.audio.fadeIn).toHaveBeenLastCalledWith(300, true);
    fade.resolve(); await fade.promise;
    expect(s.audio.pause).not.toHaveBeenCalled();
    expect(s.controller.state.phase).toBe('playing');
    s.controller.stop();
  });
  it('disabling fades completes an active pause and skips the resume envelope', async () => {
    const s = setup(), fade = deferred<void>();
    s.audio.fadeOut = vi.fn().mockReturnValue(fade.promise);
    s.audio.fadeIn = vi.fn();
    await s.controller.select(track); s.event('playing'); s.controller.toggle();
    s.controller.setTransitions({ enabled: false, trackMs: 300, pauseMs: 300, seekMs: 300 });
    expect(s.audio.pause).toHaveBeenCalledOnce();
    s.controller.toggle(); fade.resolve(); await fade.promise;
    expect(s.audio.fadeIn).toHaveBeenCalledTimes(1);
    expect(s.audio.pause).toHaveBeenCalledOnce();
    s.controller.stop();
  });
  it('observes native playback after a completed user pause', async () => {
    const s = setup();
    await s.controller.select(track); s.event('playing'); s.controller.toggle();
    s.event('pause', 2, true); s.event('playing', 2);
    expect(s.controller.state.wantsPlay).toBe(true);
    s.event('ended', 30, true);
    expect(s.controller.state.phase).toBe('ended');
    s.controller.stop();
  });
  it('a valid native seek cancels every pending fading selection before its promise resumes', async () => {
    const s = setup(); const first = deferred<void>(); const second = deferred<void>();
    const cancelled = vi.fn(); s.controller.onSelectionCancelled = cancelled;
    s.audio.fadeOut = vi.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    s.audio.cancelFade = vi.fn(() => { first.resolve(); second.resolve(); });
    s.controller.setTransitions({ enabled: true, trackMs: 300, seekMs: 0, pauseMs: 0 });
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
    s.controller.setTransitions({ enabled: true, trackMs: 300, seekMs: 0, pauseMs: 0 });
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
    s.controller.setTransitions({ enabled: true, trackMs: 300, seekMs: 0, pauseMs: 0 });
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
    s.controller.setTransitions({ enabled: true, trackMs: 500, seekMs: 0, pauseMs: 0 });
    await s.controller.select(track); s.event('playing');
    s.event('timeupdate', 29.6); s.event('timeupdate', 29.8);
    expect(s.audio.fadeOut).toHaveBeenCalledOnce();
    expect(s.audio.fadeOut).toHaveBeenCalledWith(400);
    s.controller.seek(10000);
    expect(s.audio.cancelFade).toHaveBeenCalled();
    expect(s.audio.seek).toHaveBeenCalledWith(10);
    s.controller.stop();
  });
  it.each(['byteRange', 'timeRestart'] as const)('fades before a %s seek and arms the incoming output independently of track fades', async (seekMode) => {
    const descriptor = { ...playback(), seekMode };
    const s = setup(vi.fn().mockResolvedValue(descriptor));
    const outgoing = deferred<void>();
    s.audio.fadeOut = vi.fn().mockReturnValue(outgoing.promise);
    s.audio.fadeIn = vi.fn();
    s.controller.setTransitions({ enabled: true, trackMs: 0, seekMs: 450, pauseMs: 0 });
    await s.controller.select(track); s.event('playing');
    expect(s.audio.fadeIn).not.toHaveBeenCalled();
    const seeking = s.controller.seek(10_000);
    expect(s.audio.fadeOut).toHaveBeenCalledWith(450);
    expect(s.audio.seek).not.toHaveBeenCalled();
    expect(s.api.control).not.toHaveBeenCalled();
    outgoing.resolve(); await seeking; await Promise.resolve();
    if (seekMode === 'byteRange') expect(s.audio.seek).toHaveBeenCalledWith(10);
    else expect(s.api.control).toHaveBeenCalledOnce();
    expect(s.audio.fadeIn).toHaveBeenCalledExactlyOnceWith(450);
    s.controller.stop();
  });
  it('enables both fades by default and applies only the latest seek after rapid jumps', async () => {
    const s = setup(); const first = deferred<void>(); const last = deferred<void>();
    s.audio.fadeOut = vi.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(last.promise);
    s.audio.fadeIn = vi.fn();
    await s.controller.select(track); s.event('playing');
    expect(s.audio.fadeIn).toHaveBeenCalledExactlyOnceWith(300);
    const one = s.controller.seek(10_000), two = s.controller.seek(15_000);
    expect(s.audio.fadeOut).toHaveBeenCalledWith(300);
    first.resolve(); await one;
    expect(s.audio.seek).not.toHaveBeenCalled();
    last.resolve(); await two;
    expect(s.audio.seek).toHaveBeenCalledExactlyOnceWith(15);
    expect(s.audio.fadeIn).toHaveBeenCalledTimes(2);
    s.controller.stop();
  });
  it('keeps playing from a buffered native seek without another playing event', async () => {
    vi.useFakeTimers();
    const s = setup();
    try {
      s.audio.fadeOut = vi.fn().mockResolvedValue(undefined);
      await s.controller.select(track); s.event('playing');
      await s.controller.seek(10_000);
      s.event('seeking'); s.event('waiting'); s.event('seeked', 10, false, true);
      expect(s.controller.state.phase).toBe('playing');
      await vi.advanceTimersByTimeAsync(10_000);
      expect(s.api.control).not.toHaveBeenCalled();
      await s.controller.seek(12_000);
      expect(s.audio.fadeOut).toHaveBeenCalledTimes(2);
    } finally { s.controller.stop(); vi.useRealTimers(); }
  });
  it.each(['byteRange', 'timeRestart'] as const)('finishing the old audio during a %s seek preserves the requested position and play intent', async (seekMode) => {
    const s = setup(vi.fn().mockResolvedValue({ ...playback(), seekMode }));
    const fade = deferred<void>();
    s.audio.fadeOut = vi.fn().mockReturnValue(fade.promise);
    await s.controller.select(track); s.event('playing');
    const seeking = s.controller.seek(10_000);
    Object.defineProperty(s.audio, 'ended', { value: true });
    s.event('pause', 30, true); s.event('ended', 30, true);
    expect(s.controller.state.phase).not.toBe('ended');
    fade.resolve(); await seeking; await Promise.resolve();
    expect(s.controller.state.wantsPlay).toBe(true);
    expect(s.audio.play).toHaveBeenCalledTimes(2);
    if (seekMode === 'byteRange') expect(s.audio.seek).toHaveBeenCalledWith(10);
    else expect(s.api.control).toHaveBeenCalledOnce();
    s.controller.stop();
  });
  it('never applies a fading seek after switching tracks or stopping', async () => {
    const s = setup(); const one = deferred<void>(), two = deferred<void>();
    s.audio.fadeOut = vi.fn().mockReturnValueOnce(one.promise).mockReturnValueOnce(two.promise);
    s.controller.setTransitions({ enabled: true, trackMs: 0, seekMs: 300, pauseMs: 0 });
    await s.controller.select(track); s.event('playing');
    const first = s.controller.seek(10_000);
    await s.controller.select({ ...track, sourceTrackId: 'next' }); s.event('playing');
    one.resolve(); await first;
    const second = s.controller.seek(12_000);
    s.controller.stop(); two.resolve(); await second;
    expect(s.audio.seek).not.toHaveBeenCalled();
  });
  it('keeps a paused seek immediate and does not arm a fade-in after pausing during fade-out', async () => {
    const s = setup(); const outgoing = deferred<void>();
    s.audio.fadeOut = vi.fn().mockReturnValue(outgoing.promise);
    s.audio.fadeIn = vi.fn();
    s.controller.setTransitions({ enabled: true, trackMs: 0, seekMs: 300, pauseMs: 0 });
    await s.controller.select(track); s.event('playing');
    const seeking = s.controller.seek(10_000);
    s.controller.toggle(); outgoing.resolve(); await seeking;
    await s.controller.seek(12_000);
    expect(s.audio.fadeOut).toHaveBeenCalledOnce();
    expect(s.audio.fadeIn).not.toHaveBeenCalled();
    expect(s.audio.seek).toHaveBeenLastCalledWith(12);
    expect(s.controller.state.wantsPlay).toBe(false);
    s.controller.stop();
  });
  it('requests local effects with no server gain even when a caller has old preferences', async () => {
    const s = setup();
    await s.controller.select(track, { forceProcessing: true, gainDb: -6, dspExecution: 'server' });
    expect(s.api.create.mock.calls[0][2]).toEqual({ forceProcessing: true, gainDb: 0, dspExecution: 'client' });
    s.controller.stop();
  });
  it('refuses unconfirmed execution, server effects and both channel mix names before attaching audio', async () => {
    for (const response of [
      { ...playback(), dspExecution: 'server' },
      { ...playback(), effectiveProcessing: [{ type: 'gain', execution: 'server', gainDb: -6 }] },
      { ...playback(), effectiveProcessing: [{ type: 'channelMix', execution: 'server', parameters: { outputChannels: 6 } }] },
      { ...playback(), effectiveProcessing: [{ type: 'channelmix', execution: 'server', parameters: { outputChannels: 8 } }] },
    ]) {
      const s = setup(vi.fn().mockResolvedValue(response));
      await s.controller.select(track);
      expect(s.controller.state.phase).toBe('error');
      expect(s.controller.state.message).toContain('音效或输出声道');
      expect(s.factory).not.toHaveBeenCalled();
      s.controller.stop();
    }
  });
  it('accepts format transcoding and decryption without server effects or channel mixing', async () => {
    const s = setup(vi.fn().mockResolvedValue({ ...playback(), effectiveProcessing: [
      { type: 'transcode', execution: 'server' }, { type: 'ncmDecrypt', execution: 'server' },
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

  it('reports a real media failure while an online seek waits and leaves normal buffering recovery available', async () => {
    vi.useFakeTimers();
    const descriptor = { ...playback(), seekableRange: { startMs: 0, endMs: 30_000, growing: true } };
    const s = setup(vi.fn().mockResolvedValue(descriptor));
    try {
      await s.controller.select(track);
      await s.controller.seek(20_000);
      s.event('seeking'); s.event('waiting');
      s.event('error');
      expect(s.controller.state.phase).toBe('error');
      expect(s.audio.destroy).toHaveBeenCalledTimes(1);
      expect(s.api.control).not.toHaveBeenCalled();
      await s.controller.select(track);
      s.event('stalled');
      await vi.advanceTimersByTimeAsync(10_000);
      expect(s.api.control).toHaveBeenCalledOnce();
    } finally {
      s.controller.stop(); vi.useRealTimers();
    }
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
