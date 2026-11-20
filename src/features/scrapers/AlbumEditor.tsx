import { useMemo, useRef, useState } from "react";
import { ApiError, errorMessage } from "../../api/client";
import { MusicCatalogApi, type MusicAlbum } from "../../api/music-catalog";
import { ScrapersApi } from "../../api/scrapers";
import { useServices } from "../../app/services";
import { useResource } from "../../components/query";
import { ErrorNotice } from "../../components/ui";
import { tr, useLocale } from "../../i18n";

export function AlbumEditor({ album, initialPublisher, initialReleaseDate, applied, refresh, savingChanged }: {
  album: MusicAlbum; applied: () => void; refresh: () => void; savingChanged: (busy: boolean) => void;
  initialPublisher?: string; initialReleaseDate?: string;
}) {
  useLocale();
  const client = useServices().client;
  const api = useMemo(() => new MusicCatalogApi(client), [client]);
  const scraperApi = useMemo(() => new ScrapersApi(client), [client]);
  const plugins = useResource("online-scrapers", (signal) => scraperApi.list(signal));
  const sources = plugins.data?.filter((source) => ["albumDetails", "albumTracks"].every((field) => source.fields.includes(field))) ?? [];
  const [name, setName] = useState(album.name);
  const [publisher, setPublisher] = useState(initialPublisher ?? album.publisher ?? "");
  const [releaseDate, setReleaseDate] = useState((initialReleaseDate ?? album.releaseDate ?? "").match(/^\d{4}-\d{2}-\d{2}(?=$|T)/)?.[0] ?? "");
  const [sourceUrl, setSourceUrl] = useState(album.sourceUrl ?? "");
  const [sourcePluginId, setSourcePluginId] = useState(album.sourcePluginId ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pendingKey, setPendingKey] = useState<string>();
  const [conflict, setConflict] = useState(false);
  const lock = useRef(false);
  async function save() {
    if (lock.current || conflict || !name.trim()) return;
    const key = pendingKey ?? crypto.randomUUID();
    lock.current = true; setSaving(true); savingChanged(true); setError(null);
    try {
      await api.updateAlbum(album, { name: name.trim(), publisher: publisher.trim(), releaseDate,
        sourceUrl: sourceUrl.trim(), sourcePluginId }, key);
      applied();
    } catch (cause) {
      const uncertain = cause instanceof ApiError && (cause.status === 0 || cause.status >= 500 || cause.code === "INVALID_RESPONSE");
      setPendingKey(uncertain ? key : undefined);
      setConflict(cause instanceof ApiError && (cause.status === 409 || cause.status === 410));
      setError(uncertain ? tr("保存结果待确认，请重试或关闭后刷新。") : errorMessage(cause));
    } finally { lock.current = false; setSaving(false); savingChanged(false); }
  }
  return <form className="album-editor" onSubmit={(event) => { event.preventDefault(); void save(); }}>
    <fieldset disabled={saving || conflict || !!pendingKey}>
      <label>{tr("原名")}<input value={album.originalName} readOnly /></label>
      <p className="muted">{tr("原名保留导入时的名称，修改显示名不影响原名和已有音源。")}</p>
      <label>{tr("显示名")}<input value={name} required maxLength={256} onChange={(event) => setName(event.target.value)} /></label>
      <div className="album-editor-grid">
        <label>{tr("发行商")}<input value={publisher} maxLength={256} onChange={(event) => setPublisher(event.target.value)} /></label>
        <label>{tr("发行日期")}<input type="date" value={releaseDate} onChange={(event) => setReleaseDate(event.target.value)} /></label>
      </div>
      <div className="album-editor-grid">
        <label>{tr("资料平台")}<select value={sourcePluginId} required={!!sourceUrl.trim()}
          onChange={(event) => setSourcePluginId(event.target.value)}>
          <option value="">{tr("未关联平台")}</option>
          {sourcePluginId && !sources.some((source) => source.pluginId === sourcePluginId) && <option value={sourcePluginId}>{tr("当前关联平台")}</option>}
          {sources.map((source) => <option key={source.pluginId} value={source.pluginId}>{source.name}</option>)}
        </select></label>
        <label>{tr("平台专辑页面")}<input type="url" value={sourceUrl} maxLength={4096} placeholder="https://…"
          onChange={(event) => setSourceUrl(event.target.value)} /></label>
      </div>
      <p className="muted">{tr("保存不会自动读取平台资料；点击「刷新资料」后，可对比并选择需要合并的内容。")}</p>
    </fieldset>
    <ErrorNotice error={plugins.error} retry={plugins.reload} />
    <ErrorNotice error={error} />
    {conflict ? <button type="button" onClick={refresh}>{tr("刷新资料")}</button>
      : <button className="primary" type="submit" disabled={saving || !name.trim()}>{tr(pendingKey ? "重试确认保存" : "保存")}</button>}
  </form>;
}
