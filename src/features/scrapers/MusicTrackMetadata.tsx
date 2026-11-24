import { useMemo, useState } from "react";
import { ApiError } from "../../api/client";
import { mergeScrapedTitles, validLocalizedNames } from "../../api/localized-titles";
import type { MusicTrack } from "../../api/music-catalog";
import { ScrapersApi, type ScrapeCandidate } from "../../api/scrapers";
import { useServices } from "../../app/services";
import { Modal } from "../../components/Modal";
import { useResource } from "../../components/query";
import { ErrorNotice } from "../../components/ui";
import { useSourceName } from "../../components/use-source-name";
import { tr } from "../../i18n";
import { TrackMetadataEditor, unavailableTrackMessage } from "../library/TrackMetadataEditor";
import { ScraperSearch } from "./ScraperSearch";

export function MusicTrackMetadata({ trackId, bySource, mode, close, applied }: {
  trackId: string; bySource: boolean; mode: "search" | "edit"; close: () => void; applied?: () => void;
}) {
  const services = useServices();
  const [saving, setSaving] = useState(false);
  const track = useResource(`music-track-metadata:${bySource}:${trackId}`, async signal => {
    try {
      const item = await services.musicCatalog.track(trackId, signal, bySource);
      if (!Number.isSafeInteger(item.revision) || Number(item.revision) < 1)
        throw new ApiError("INVALID_RESPONSE", "Missing music track revision");
      return { item, unavailable: null };
    } catch (cause) {
      const unavailable = unavailableTrackMessage(cause);
      if (!unavailable) throw cause;
      return { item: null, unavailable };
    }
  });
  function finish() {
    services.invalidateLibraries(); applied?.(); close();
  }
  const item = track.data?.item;
  return <Modal title={tr(mode === "search" ? "搜索在线资料" : "编辑曲目元数据")} close={() => { if (!saving) close(); }}>
    {track.loading && <p role="status">{tr("正在加载…")}</p>}
    <ErrorNotice error={track.error} retry={track.reload} />
    {track.data?.unavailable && <>
      <ErrorNotice error={track.data.unavailable} />
      <button type="button" onClick={finish}>{tr("刷新列表并重新选择")}</button>
    </>}
    {item && <>
      {mode === "edit" ? <TrackMetadataEditor key={item.revision} track={item}
        busyChanged={setSaving} applied={finish} refresh={track.reload} />
        : <><p><strong>{item.title}</strong></p>
          <MusicTrackSearch track={item} finished={finish} refresh={track.reload} savingChanged={setSaving} /></>}
    </>}
  </Modal>;
}

function MusicTrackSearch({ track, finished, refresh, savingChanged }: {
  track: MusicTrack; finished: () => void; refresh: () => void; savingChanged: (busy: boolean) => void;
}) {
  const services = useServices();
  const api = useMemo(() => new ScrapersApi(services.client), [services]);
  const sourceName = useSourceName();
  const versions = (track.selectedSource?.versions ?? []).filter(source => source.assetId);
  const [sourceId, chooseSource] = useState(versions.length === 1 ? versions[0].sourceTrackId : "");
  const [field, setField] = useState("");
  const version = versions.find(source => source.sourceTrackId === sourceId);
  const mediaSourceId = (field === "lyrics" || field === "artwork") && version ? sourceId : "";
  const media = useResource(`music-track-media:${mediaSourceId}`, signal => mediaSourceId ? api.trackTarget(mediaSourceId, signal) : Promise.resolve(null));
  const selection = version && media.data?.target.sourceTrackId === sourceId && media.data.target.assetId === version.assetId ? media.data : null;
  const names = track.localizedTitles ?? [];
  const titlesWith = (candidate: ScrapeCandidate) => mergeScrapedTitles(track.title, names, candidate);
  return <ScraperSearch preferredField="trackDetails" allowedFields={["trackDetails", "lyrics", "artwork"]} sourceTrackId={sourceId || undefined}
    titleOptions={names} initial={{ title: track.title, artist: track.artists.map(artist => artist.name).join(", "),
      album: track.albums[0]?.name, duration: track.selectedSource?.durationMs ? track.selectedSource.durationMs / 1000 : undefined }}
    fieldChanged={setField} fieldControls={field => field === "trackDetails" ? undefined : <>
      {versions.length > 1 ? <label>{tr("保存到来源版本")}<select aria-label={tr("保存到来源版本")} value={sourceId} onChange={event => chooseSource(event.target.value)}>
        <option value="">{tr("选择来源版本")}</option>
        {versions.map(source => <option key={source.sourceTrackId} value={source.sourceTrackId}>
          {source.displayName} · {sourceName(source.providerInstanceId)}
        </option>)}
      </select></label> : <p className="muted">{version ? tr("保存到来源版本 {0}", { 0: version.displayName })
        : tr("此曲目暂无音源，可搜索和预览歌词或封面。")}</p>}
      <ErrorNotice error={media.error} retry={media.reload} />
      {version && media.data?.target.sourceTrackId === sourceId && !selection && <p className="notice">{tr("来源文件已发生变化，请重新扫描曲库。")}</p>}
    </>}
    apply={async (field, plugin, candidate, key) => {
      if (field === "trackDetails") await services.musicCatalog.updateTrackTitles(track, titlesWith(candidate), key);
      else if (selection) await api.applyMedia(selection, field, plugin, candidate.candidateToken, key);
      else throw new ApiError("RESOURCE_CHANGED", "No selected asset");
    }}
    canApply={(field, candidate) => {
      if (field !== "trackDetails") return !!selection;
      const updated = titlesWith(candidate);
      return updated.length > names.length && validLocalizedNames(updated);
    }}
    applyLabel={field => tr(field === "trackDetails" ? "保存为曲目别名" : "选用这项资料")}
    finished={finished} refresh={refresh} savingChanged={savingChanged} />;
}
