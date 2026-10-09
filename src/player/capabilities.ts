import type { Capabilities } from '../api/types';
export function capabilities(audio: Pick<HTMLAudioElement, 'canPlayType'>): Capabilities {
  return { htmlAudio: true, formats: [
    'audio/wav; codecs="1"', 'audio/mpeg', 'audio/ogg; codecs="opus"', 'audio/ogg; codecs="vorbis"',
    'audio/mp4; codecs="mp4a.40.2"', 'audio/flac', 'audio/webm; codecs="opus"',
  ].map((mime) => ({ mime, canPlay: audio.canPlayType(mime) })) };
}
