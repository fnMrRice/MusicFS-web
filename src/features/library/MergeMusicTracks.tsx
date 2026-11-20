import { useMemo, useRef, useState } from "react";
import { ApiError, errorMessage } from "../../api/client";
import { MusicCatalogApi, type MusicTrack } from "../../api/music-catalog";
import { useServices } from "../../app/services";
import { Modal } from "../../components/Modal";
import { ErrorNotice } from "../../components/ui";
import { tr } from "../../i18n";
import { albumMergeDefaults } from "./album-merge-metadata";
import { TrackMetadataFields } from "./TrackMetadataFields";
import { toTrackMetadata, trackMetadataDraft, trackMetadataLabels, validTrackMetadata, type TrackMetadataDraft } from "./track-metadata-draft";

type Field = keyof TrackMetadataDraft;
const fields = Object.keys(trackMetadataLabels) as Field[];

function displayValue(value: TrackMetadataDraft[Field]): string {
  return (Array.isArray(value) ? value.map(entry => `${entry.title} (${entry.language})`).join(" / ") : value.replaceAll("\n", " / ")) || tr("未填写");
}

export function MergeMusicTracks({ albumId, albumRevision, matchingRevision, tracks, close, applied }: {
  albumId: string; albumRevision: number; matchingRevision: number; tracks: MusicTrack[];
  close: () => void; applied: () => void;
}) {
  const { client } = useServices();
  const api = useMemo(() => new MusicCatalogApi(client), [client]);
  const [target, setTarget] = useState(tracks.find(track => track.selectedSource) ?? tracks[0]);
  const options = useMemo(() => tracks.map(track => ({ track, draft: trackMetadataDraft(track) })), [tracks]);
  const [sources, setSources] = useState<Partial<Record<Field, string>>>({});
  const [edits, setEdits] = useState<Partial<TrackMetadataDraft>>({});
  const defaults = useMemo(() => albumMergeDefaults(tracks, target, edits.title), [tracks, target, edits.title]);
  const draft = { ...defaults, ...edits };
  const [busy, setBusy] = useState(false);
  const [retryKey, setRetryKey] = useState<string>();
  const [error, setError] = useState<string | null>(null);
  const [conflict, setConflict] = useState(false);
  const lock = useRef(false);
  const unavailable = tracks.some(track => !track.revision) || tracks.length > 64;
  const locked = busy || conflict || !!retryKey;

  function choose(field: Field, sourceId: string) {
    const chosen = options.find(item => `track:${item.track.trackId}` === sourceId);
    setSources({ ...sources, [field]: sourceId });
    const updated = { ...edits };
    if (chosen) Object.assign(updated, { [field]: chosen.draft[field] });
    else delete updated[field];
    setEdits(updated);
  }

  function edit(next: TrackMetadataDraft) {
    const field = fields.find(key => draft[key] !== next[key]);
    if (!field) return;
    setEdits({ ...edits, [field]: next[field] });
    setSources({ ...sources, [field]: "custom" });
  }

  function sourceControl(field: Field) {
    const selected = sources[field] ?? "";
    return <select aria-label={tr("{0}取值来源", { 0: tr(trackMetadataLabels[field]) })}
      className="track-merge-source" value={selected} onChange={event => choose(field, event.target.value)}>
      <option value="">{tr("自动合并")}</option>
      {options.map(({ track, draft: value }, index) => <option key={track.trackId} value={`track:${track.trackId}`}>
        {index + 1}. {track.title} · {displayValue(value[field])}
      </option>)}
      {selected === "custom" && <option value="custom">{tr("自定义")}</option>}
    </select>;
  }

  async function save() {
    if (lock.current || conflict || unavailable || !validTrackMetadata(draft)) return;
    lock.current = true; setBusy(true); setError(null);
    const key = retryKey ?? crypto.randomUUID();
    try {
      await api.mergeAlbumTracks(albumId, albumRevision, matchingRevision, target.trackId, tracks, key, toTrackMetadata(draft));
      applied();
    } catch (cause) {
      const uncertain = cause instanceof ApiError && (cause.status === 0 || cause.status >= 500 || cause.code === "INVALID_RESPONSE");
      setRetryKey(uncertain ? key : undefined);
      setConflict(cause instanceof ApiError && cause.status === 409);
      setError(cause instanceof ApiError && cause.code === "ALBUM_TRACK_SLOT_CONFLICT" ? tr("所选歌曲在另一张专辑中占用不同曲序，请先核对那张专辑。")
        : uncertain ? tr("保存结果待确认，请重试或关闭后刷新。") : errorMessage(cause));
    } finally { lock.current = false; setBusy(false); }
  }
  return <Modal title={tr("合并歌曲")} close={() => { if (!lock.current) close(); }}>
    <fieldset disabled={locked}><legend>{tr("保留的曲目")}</legend>
      {tracks.map(track => <label className="check-label" key={track.trackId}>
        <input type="radio" name="merge-primary-track" checked={target.trackId === track.trackId}
          onChange={() => setTarget(track)} />
        {track.title} · {track.selectedSource ? tr("{0} 个来源版本", {0: track.selectedSource.versions?.length ?? 1}) : tr("暂无来源")}
      </label>)}
    </fieldset>
    <h3>{tr("合并后的元数据")}</h3>
    <p className="muted">{tr("每项可选用任一曲目的值，也可以直接编辑。")}</p>
    <TrackMetadataFields draft={draft} onChange={edit} disabled={locked} fieldControl={sourceControl} />
    {unavailable && <p role="status">{tr("请刷新专辑后重新选择，单次最多合并 64 首。")}</p>}
    <ErrorNotice error={error} />
    <div className="list-actions">
      {conflict ? <button onClick={applied}>{tr("刷新列表并重新选择")}</button>
        : <button className="primary" disabled={busy || unavailable || !validTrackMetadata(draft)} onClick={() => void save()}>
          {tr(retryKey ? "重试确认保存" : "确认合并")}</button>}
      <button disabled={busy} onClick={close}>{tr("取消")}</button>
    </div>
  </Modal>;
}
