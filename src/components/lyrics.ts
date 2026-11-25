interface CreditPart {
  text: string;
  image?: string;
  href?: string;
}

interface LyricLine {
  source: string;
  text: string;
  times: number[];
  credits?: CreditPart[];
}

function readUrl(value: unknown): URL | undefined {
  if (typeof value !== "string") return;
  try {
    return new URL(value);
  } catch {
    return undefined;
  }
}

function creditImage(value: unknown) {
  const url = readUrl(value);
  if (!url || !["http:", "https:"].includes(url.protocol) || !url.hostname.endsWith(".music.126.net")
    || url.username || url.password || url.port) return;
  url.protocol = "https:";
  return url.href;
}

function artistPage(value: unknown) {
  const url = readUrl(value);
  if (!url || url.protocol !== "orpheus:" || url.host !== "nm" || url.pathname !== "/artist/home") return;
  const id = url.searchParams.get("id");
  if (id && /^[1-9]\d{0,19}$/.test(id)) return `https://music.163.com/artist?id=${id}`;
}

function neteaseCredit(source: string): LyricLine | undefined {
  const trimmed = source.trim();
  if (!trimmed.startsWith("{")) return;
  // 部分歌词在行尾保留续行符，或在网址的冒号前多写了反斜线。
  const json = trimmed.replace(/\\$/, "")
    .replace(/("(?:li|or)"\s*:\s*"(?:https?|orpheus))\\+:(?=\/\/)/gi, "$1:");
  let row;
  try {
    row = JSON.parse(json);
  } catch {
    return;
  }
  if (!Number.isSafeInteger(row?.t) || row.t < 0 || !Array.isArray(row.c)) return;
  const credits: CreditPart[] = [];
  for (const part of row.c) {
    if (typeof part?.tx === "string") {
      credits.push({ text: part.tx, image: creditImage(part.li), href: artistPage(part.or) });
    }
  }
  if (!credits.length) return;
  return { source, text: credits.map(part => part.text).join(""), times: [row.t], credits };
}

const lrcTimestamp = /^\[(\d{1,3}):([0-5]\d)(?:[.:](\d{1,3}))?\]/;
const lrcOffset = /^\s*\[offset:\s*([+-]?\d+)\s*\]\s*$/i;

function parseLine(source: string): LyricLine {
  const credit = neteaseCredit(source);
  if (credit) return credit;
  let text = source.trimStart();
  const times: number[] = [];
  for (let tag = lrcTimestamp.exec(text); tag; tag = lrcTimestamp.exec(text)) {
    const ms = Number(tag[1]) * 60000 + Number(tag[2]) * 1000 + Number((tag[3] ?? "").padEnd(3, "0"));
    times.push(ms);
    text = text.slice(tag[0].length);
  }
  return { source, text: times.length ? text : source, times };
}

export function parseLyrics(text: string) {
  const lines = text.split(/\r\n|[\r\n]/).map(parseLine);
  const times = [...new Set(lines.flatMap(line => line.times))].sort((a, b) => a - b);
  const offsetLine = lines.find(line => lrcOffset.test(line.source));
  const offset = offsetLine ? Number(lrcOffset.exec(offsetLine.source)?.[1]) : 0;
  return { lines, times, offset: Number.isSafeInteger(offset) ? offset : 0, offsetLine };
}

export function currentLyricTime(times: number[], positionMs: number): number | undefined {
  let start = 0, end = times.length;
  while (start < end) {
    const middle = Math.floor((start + end) / 2);
    if (times[middle] <= positionMs) start = middle + 1;
    else end = middle;
  }
  return times[start - 1];
}
