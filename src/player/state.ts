import type { Playback, SourceTrack } from '../api/types';
export type PlayerPhase = 'idle' | 'resolving' | 'loading' | 'playing' | 'paused' | 'buffering' | 'seeking' | 'recovering' | 'ended' | 'error';
export interface PlayerState {
  phase: PlayerPhase; track: SourceTrack | null; playback: Playback | null; positionMs: number;
  wantsPlay: boolean; message: string | null;
}
export function initialState(): PlayerState { return { phase: 'idle', track: null, playback: null, positionMs: 0, wantsPlay: false, message: null }; }
