import { useState } from "react";
import type { MusicAlbum, MusicTrack } from "../../api/music-catalog";
import type { AlbumMergeField, SavedScrapedField, ScrapeCandidate } from "../../api/scrapers";
import { tr, useLocale } from "../../i18n";
import { AlbumCover } from "../library/AlbumCover";
import { albumDate, genreName } from "./AlbumMetadata";

export interface AlbumMergeSnapshot {
  album: MusicAlbum;
  saved: SavedScrapedField[];
  currentTracks: MusicTrack[];
  details: ScrapeCandidate;
  tracks: ScrapeCandidate;
}

export function AlbumMergePreview({ snapshot, saving, locked, merge }: {
  snapshot: AlbumMergeSnapshot; saving: boolean; locked: boolean; merge: (fields: AlbumMergeField[]) => void;
}) {
  const { locale } = useLocale();
  const { album, details, tracks, saved, currentTracks } = snapshot;
  const current = saved.find((entry) => entry.field === "albumDetails")?.item;
  const currentCover = album.coverPath || saved.find((entry) => entry.field === "artwork")?.item.imageUrl;
  const incomingCover = details.imageUrl || tracks.imageUrl;
  const currentDate = album.releaseDate || current?.date;
  const choices: { field: AlbumMergeField; label: string; current?: string | null; incoming?: string; unavailable?: boolean }[] = [
    { field: "name", label: "显示名", current: album.name, incoming: details.album || details.title, unavailable: !(details.album || details.title) },
    { field: "artist", label: "艺人", current: current?.artist, incoming: details.artist },
    { field: "releaseDate", label: "发行日期", current: currentDate, incoming: details.date },
    { field: "publisher", label: "发行商", current: album.publisher || current?.publisher, incoming: details.publisher },
    { field: "genre", label: "音乐风格", current: current?.genre, incoming: details.genre },
    { field: "description", label: "补充信息", current: current?.description, incoming: details.description },
    { field: "cover", label: "封面", current: currentCover, incoming: incomingCover },
    { field: "tracks", label: "曲目表", current: currentTracks.length ? String(currentTracks.length) : undefined,
      incoming: String(tracks.tracks!.length) },
  ];
  const [selected, setSelected] = useState<AlbumMergeField[]>(() => choices
    .filter((item) => !item.unavailable && !item.current && !!item.incoming).map((item) => item.field));
  const normalized = (value: string) => value.normalize("NFKC").trim().toLowerCase();
  const existingTitles = new Set(currentTracks.map((item) => normalized(item.title)));
  const additions = tracks.tracks!.filter((item) => !existingTitles.has(normalized(item.title))).length;
  const display = (field: AlbumMergeField, value?: string | null) => {
    if (!value) return tr("未填写");
    if (field === "releaseDate") return albumDate(value, locale) ?? value;
    if (field === "genre") return genreName(value);
    return value;
  };
  return <div className="album-merge-preview">
    <p className="muted">{tr("勾选要合并的平台资料。已有内容默认保留，确认前不会修改专辑。")}</p>
    <div className="album-compare-heading" aria-hidden="true"><span>{tr("合并字段")}</span><span>{tr("当前资料")}</span><span>{tr("平台新资料")}</span></div>
    {choices.map((item) => <div className="album-compare-row" key={item.field}>
      <label className="album-compare-choice"><input type="checkbox" checked={selected.includes(item.field)}
        disabled={saving || locked || item.unavailable || !item.current && !item.incoming}
        onChange={(event) => setSelected((fields) => event.target.checked ? [...fields, item.field] : fields.filter((field) => field !== item.field))} />
        {tr(item.label)}</label>
      <div className="album-compare-value" role="group" aria-label={`${tr("当前资料")}：${tr(item.label)}`}><span className="album-compare-mobile-label">{tr("当前资料")}</span>
        {item.field === "cover" && item.current ? <AlbumCover coverPath={item.current} name={album.name} />
          : item.field === "tracks" ? <>
            <strong>{tr("{0} 首", { 0: currentTracks.length })}</strong>
            <ol className="album-compare-tracks" aria-label={tr("当前曲目表")}>{currentTracks.map((track) => <li key={track.trackId}>{track.title}</li>)}</ol>
          </> : display(item.field, item.current)}
      </div>
      <div className="album-compare-value" role="group" aria-label={`${tr("平台新资料")}：${tr(item.label)}`}><span className="album-compare-mobile-label">{tr("平台新资料")}</span>
        {item.field === "cover" && item.incoming ? <AlbumCover coverPath={item.incoming} name={album.name} />
          : item.field === "tracks" ? <>
            <strong>{tr("{0} 首", { 0: tracks.tracks!.length })} · {tr("预计新增 {0} 首", { 0: additions })}</strong>
            <ol className="album-compare-tracks album-compare-platform" aria-label={tr("平台曲目表")}>{tracks.tracks!.map((track, index) => <li key={index}>
              <span>{track.disc ? `${track.disc}.${track.number || index + 1}` : track.number || index + 1} {track.title}</span>
              {!existingTitles.has(normalized(track.title)) && <small>{tr("新增")}</small>}
            </li>)}</ol>
          </> : display(item.field, item.incoming)}
        {!item.incoming && item.current && item.field !== "name" && <small className="muted">{tr("平台没有此项，勾选后会清空当前值。")}</small>}
      </div>
    </div>)}
    <p className="muted">{tr("合并曲目表会补齐缺失资料，保留已有音源和额外曲目。")}</p>
    <div className="album-search-actions"><button type="button" className="primary" disabled={saving || !selected.length}
      onClick={() => merge(choices.filter((item) => selected.includes(item.field)).map((item) => item.field))}>{tr(locked ? "重试确认保存" : "合并选中资料")}</button></div>
  </div>;
}
