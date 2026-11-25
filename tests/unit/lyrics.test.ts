import { expect, it } from 'vitest';
import { currentLyricTime, parseLyrics } from '../../src/components/lyrics';

it('reads NetEase credits with standard JSON escapes and escaped URL colons', () => {
  const path = 'p1.music.126.net/artist.jpg';
  const first = String.raw`{"t":0,"c":[{"tx":"作词: "},{"tx":"兰音Reine","li":"http\://${path}","or":"orpheus\://nm/artist/home?id=46424022&type=artist"}]}` + '\\';
  const second = String.raw`{"t":1000,"c":[{"tx":"作曲: "},{"tx":"\u5170音\"Reine\"","li":"https:\/\/p1.music.126.net\/artist.jpg","or":"orpheus:\/\/nm\/artist\/home?id=46424022"}]}`;
  const { lines, times } = parseLyrics(`${first}\r\n${second}`);

  expect(times).toEqual([0, 1000]);
  expect(lines.map(line => line.text)).toEqual(['作词: 兰音Reine', '作曲: 兰音"Reine"']);
  for (const line of lines) {
    expect(line.credits?.[1]).toMatchObject({ image: `https://${path}`, href: 'https://music.163.com/artist?id=46424022' });
  }
});

it('keeps malformed JSON verbatim and preserves credit text when URLs are invalid', () => {
  const broken = '{"t":0,"c":[';
  const credit = JSON.stringify({ t: 500, c: [{ tx: '演唱者', li: 'https://p1.music.126.net.invalid/photo', or: 'orpheus://nm/artist/home?id=not-an-id' }] });
  const { lines, times } = parseLyrics([broken, '原样保留的歌词', credit].join('\n'));

  expect(lines.map(line => line.text)).toEqual([broken, '原样保留的歌词', '演唱者']);
  expect(times).toEqual([500]);
  const part = lines[2].credits?.[0];
  expect(part?.text).toBe('演唱者');
  expect(part?.image).toBeUndefined();
  expect(part?.href).toBeUndefined();
});

it('retains repeated LRC timestamps and groups a translation with its original line', () => {
  const { lines, times } = parseLyrics('[00:01.2][00:03.025]原文\n[00:03.025]译文');
  expect(times).toEqual([1200, 3025]);
  expect(lines).toMatchObject([
    { text: '原文', times: [1200, 3025] },
    { text: '译文', times: [3025] },
  ]);
});

it('selects cues before and after a backward seek using an offset declared at the end', () => {
  const { times, offset } = parseLyrics('[00:05]后一句\n[00:01.2]第一句\n[offset:+125]');
  expect(offset).toBe(125);
  const at = (positionMs: number) => currentLyricTime(times, positionMs + offset);
  expect(at(1074)).toBeUndefined();
  expect(at(1075)).toBe(1200);
  expect(at(4875)).toBe(5000);
  expect(at(4874)).toBe(1200);
});
