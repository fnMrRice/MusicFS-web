import { useMemo, useState } from "react";
import { ScrapersApi } from "../../api/scrapers";
import type { SourceTrack } from "../../api/types";
import { useServices } from "../../app/services";
import { Modal } from "../../components/Modal";
import { useResource } from "../../components/query";
import { ErrorNotice } from "../../components/ui";
import { tr, useLocale } from "../../i18n";
import { ScraperSearch } from "./ScraperSearch";

export function TrackScraping({ track, close, applied }: { track: SourceTrack; close: () => void; applied?: () => void }) {
  useLocale();
  const services = useServices();
  const api = useMemo(() => new ScrapersApi(services.client), [services]);
  const media = useResource(`scraped-media:${track.sourceTrackId}`, (signal) => api.trackTarget(track.sourceTrackId, signal));
  const [saving, setSaving] = useState(false);
  const selection = media.data?.target.assetId === track.assetId ? media.data : null;
  const finish = () => { services.invalidateLibraries(); applied?.(); close(); };
  return <Modal title={tr("搜索在线资料")} close={() => { if (!saving) close(); }}>
    <p>{track.displayName}</p>
    <ErrorNotice error={media.error} retry={media.reload} />
    {media.data && !selection && <p className="notice">{tr("来源文件已发生变化，请重新扫描曲库。")}</p>}
    <ScraperSearch key={`${selection?.target.assetVersion}:${selection?.revision}`} preferredField="lyrics"
      initial={{ title: track.title || track.displayName, album: track.album ?? undefined,
        artist: track.artists?.join(", "), duration: track.durationMs ? track.durationMs / 1000 : undefined }}
      apply={selection ? (field, pluginId, item, key) => api.applyMedia(selection, field, pluginId, item.candidateToken, key) : undefined}
      canApply={(field) => field === "lyrics" || field === "artwork"} finished={finish} refresh={media.reload} savingChanged={setSaving} />
  </Modal>;
}
