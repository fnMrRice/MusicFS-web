import { useRef, useState } from "react";
import { ApiError, errorMessage, withRequestId } from "../../api/client";
import type { MusicAlbum } from "../../api/music-catalog";
import type { ScrapersApi } from "../../api/scrapers";
import { Modal } from "../../components/Modal";
import { ErrorNotice } from "../../components/ui";
import { tr, useLocale } from "../../i18n";

export function AlbumScrapeClear({ album, api, close, reload }: {
  album: MusicAlbum; api: ScrapersApi; close: () => void; reload: () => void;
}) {
  useLocale();
  const [key] = useState(() => crypto.randomUUID());
  const lock = useRef(false);
  const [status, setStatus] = useState<"ready" | "busy" | "uncertain" | "conflict">("ready");
  const [error, setError] = useState<string | null>(null);
  const dismiss = () => {
    if (!lock.current) (status === "ready" ? close : reload)();
  };
  async function clear() {
    if (lock.current || status === "conflict") return;
    lock.current = true;
    setStatus("busy");
    setError(null);
    try {
      await api.clearAlbum(album.albumId, album.revision, key);
      reload();
    } catch (cause) {
      if (cause instanceof ApiError && [404, 409, 410, 412].includes(cause.status)) {
        setStatus("conflict");
        setError(withRequestId("专辑资料已变化，请刷新后重新确认。", cause));
      } else if (cause instanceof ApiError && (cause.status === 0 || cause.status >= 500 || cause.code === "INVALID_RESPONSE")) {
        setStatus("uncertain");
        setError(withRequestId("清空结果待确认。可手动重试，或关闭弹窗刷新专辑。", cause));
      } else {
        setStatus("ready");
        setError(errorMessage(cause));
      }
    } finally { lock.current = false; }
  }
  return <Modal title={tr("清空刮削资料")} close={dismiss}>
    <p>{tr("清空《{0}》从各平台保存的专辑资料、封面记录和曲目表？", { 0: album.name })}</p>
    <p>{tr("一并移除仅由这张专辑刮削补建且未被使用的曲目。音源、平台链接和已合并到曲库的资料会保留。")}</p>
    <ErrorNotice error={error} />
    <div className="album-search-actions">
      <button type="button" disabled={status === "busy"} onClick={dismiss}>{tr("取消")}</button>
      {status === "conflict" ? <button type="button" onClick={reload}>{tr("刷新资料")}</button>
        : <button type="button" className="primary" disabled={status === "busy"} onClick={() => void clear()}>
          {tr(status === "uncertain" ? "重试确认清空" : "确认清空")}
        </button>}
    </div>
  </Modal>;
}
