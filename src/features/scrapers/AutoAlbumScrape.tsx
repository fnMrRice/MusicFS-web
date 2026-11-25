import { useEffect, useMemo, useRef, useState } from "react";
import { ApiError, randomRequestId, withRequestId } from "../../api/client";
import { ScrapersApi, type RankedAlbumCandidate } from "../../api/scrapers";
import { useServices } from "../../app/services";
import { Modal } from "../../components/Modal";
import { ErrorNotice } from "../../components/ui";
import { tr, useLocale } from "../../i18n";
import { albumLookupMessage, albumSaveMessage } from "./album-search-errors";
import { scraperName } from "./fields";

type Search = { candidates: RankedAlbumCandidate[]; revision: number; hasSavedFields: boolean };
type Selection = { search: Search; index: number; key: string };
type Notice = { kind: "progress" | "result" | "error"; message: string };
type Feedback = Notice | { kind: "confirm"; message: string; accept: () => void };

export function AutoAlbumScrape({ albumId, name, provider, close }: {
  albumId: string; name: string; provider: string; close: (reload: boolean) => void;
}) {
  useLocale();
  const services = useServices();
  const api = useMemo(() => new ScrapersApi(services.client), [services]);
  const [attempt, setAttempt] = useState(0);
  const [feedback, setFeedback] = useState<Feedback>({ kind: "progress", message: tr("正在查询资料…") });
  const pending = useRef<Selection | null>(null);
  const writing = useRef(false);
  const reload = useRef(false);
  const active = useRef<AbortController | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    const signal = controller.signal;
    active.current = controller;
    function show(kind: Notice["kind"], message: string) {
      if (!signal.aborted) setFeedback({ kind, message });
    }
    function confirmReplacement(edition: RankedAlbumCandidate) {
      return new Promise<boolean>(resolve => {
        const cancel = () => resolve(false);
        signal.addEventListener("abort", cancel, { once: true });
        setFeedback({ kind: "confirm",
          message: tr("将采用 {0} 的《{1}》，更新已保存的平台专辑资料和曲目表。", {
            0: scraperName(edition.pluginId), 1: edition.title,
          }),
          accept: () => { signal.removeEventListener("abort", cancel); resolve(true); },
        });
      });
    }
    async function search(): Promise<Search> {
      show("progress", tr("正在查询资料…"));
      // 先读取修订，再检查已存资料。两次读取后的并发编辑由保存时的修订检查保护。
      const album = await services.musicCatalog.album(albumId, signal);
      const hasSavedFields = (await api.savedAlbum(albumId, signal)).length > 0;
      const candidates = await api.autoAlbumCandidates(albumId, provider, signal);
      return { candidates, revision: album.revision, hasSavedFields };
    }
    async function run() {
      const previous = pending.current;
      const ranked = previous?.search ?? await search();
      let lastFailure: string | undefined;
      for (let index = previous?.index ?? 0; index < ranked.candidates.length; ++index) {
        const edition = ranked.candidates[index];
        signal.throwIfAborted();
        // 不确定的写入原样重试；确定改选下一项时重新征得覆盖已有资料的确认。
        const retry = previous?.index === index;
        if (!retry && ranked.hasSavedFields && !await confirmReplacement(edition)) return;
        signal.throwIfAborted();
        const key = retry ? previous.key : randomRequestId();
        writing.current = true;
        show("progress", tr("正在保存专辑资料…"));
        try {
          await api.applyAutoAlbum(albumId, ranked.revision, provider, edition, key);
          pending.current = null;
          reload.current = true;
          services.invalidateLibraries();
          show("result", tr("已采用 {0} 的《{1}》。", { 0: scraperName(edition.pluginId), 1: edition.title }));
          return;
        } catch (cause) {
          if (cause instanceof ApiError && (cause.status === 0 || cause.status >= 500 || cause.code === "INVALID_RESPONSE")) {
            pending.current = { search: ranked, index, key };
            reload.current = true;
            show("error", withRequestId("保存结果待确认，请重试或关闭后刷新。", cause));
            return;
          }
          pending.current = null;
          if (cause instanceof ApiError && cause.code === "ALBUM_TRACK_MISMATCH") continue;
          if (cause instanceof ApiError && cause.code === "NOT_FOUND" && cause.message === "Scraper candidate expired or unavailable") {
            lastFailure = withRequestId("预览资料已失效，请刷新预览。", cause);
            continue;
          }
          if (cause instanceof ApiError && cause.status === 400 && cause.code === "INVALID_ARGUMENT") {
            lastFailure = albumSaveMessage(cause, "selection");
            continue;
          }
          if (cause instanceof ApiError && cause.status === 409) reload.current = true;
          show("error", albumSaveMessage(cause, "selection"));
          return;
        } finally {
          writing.current = false;
        }
      }
      if (lastFailure) show("error", lastFailure);
      else show("result", tr("没有匹配的资料。"));
    }
    void run().catch(cause => show("error", albumLookupMessage(cause)));
    return () => controller.abort();
  }, [api, services, albumId, provider, attempt]);

  function dismiss() {
    if (writing.current) return;
    active.current?.abort();
    close(reload.current);
  }
  return <Modal title={tr("自动刮削")} close={dismiss}>
    <p><strong>{name}</strong></p>
    {feedback.kind === "error" ? <ErrorNotice error={feedback.message} retry={() => setAttempt(value => value + 1)} />
      : <p role="status">{feedback.message}</p>}
    {feedback.kind === "confirm" && <div className="album-search-actions">
      <button type="button" onClick={dismiss}>{tr("取消")}</button>
      <button type="button" className="primary" onClick={feedback.accept}>{tr("确认更新")}</button>
    </div>}
  </Modal>;
}
