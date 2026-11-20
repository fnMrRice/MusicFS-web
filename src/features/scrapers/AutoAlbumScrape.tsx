import { useEffect, useMemo, useRef, useState } from "react";
import { ApiError, withRequestId } from "../../api/client";
import { ScrapersApi } from "../../api/scrapers";
import { useServices } from "../../app/services";
import { Modal } from "../../components/Modal";
import { ErrorNotice } from "../../components/ui";
import { tr, useLocale } from "../../i18n";
import { AlbumPreviews, type AlbumEdition } from "./album-previews";
import { albumLookupMessage, albumSaveMessage } from "./album-search-errors";
import { albumScraperName } from "./fields";

type Selection = { edition: AlbumEdition; revision: number; key: string };
type Feedback = { kind: "progress" | "result" | "error"; message: string };

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
    function show(kind: Feedback["kind"], message: string) {
      if (!signal.aborted) setFeedback({ kind, message });
    }
    async function save(choice: Selection) {
      const { edition, revision, key } = choice;
      writing.current = true;
      show("progress", tr("正在保存专辑资料…"));
      try {
        await api.applyAlbumBundle(albumId, revision, edition.pluginId, {
          albumDetails: edition.details.candidateToken, albumTracks: edition.tracks.candidateToken,
        }, key);
        pending.current = null;
        reload.current = true;
        services.invalidateLibraries();
        show("result", tr("已采用 {0} 的《{1}》。", { 0: albumScraperName(edition.pluginId), 1: edition.details.title }));
      } catch (cause) {
        const uncertain = cause instanceof ApiError && (cause.status === 0 || cause.status >= 500 || cause.code === "INVALID_RESPONSE");
        pending.current = uncertain ? choice : null;
        reload.current = uncertain || cause instanceof ApiError && cause.status === 409;
        const message = uncertain ? withRequestId("保存结果待确认，请重试或关闭后刷新。", cause) : albumSaveMessage(cause, "selection");
        // 只在服务端明确拒绝候选资料时换用下一项。
        if (cause instanceof ApiError && cause.code === "NOT_FOUND" && cause.message === "Scraper candidate expired or unavailable")
          return withRequestId("预览资料已失效，请刷新预览。", cause);
        if (cause instanceof ApiError && cause.status === 400 && cause.code === "INVALID_ARGUMENT") return message;
        show("error", message);
      } finally {
        writing.current = false;
      }
    }
    async function run() {
      // 写入结果不明时原样重试，保留候选令牌、修订与幂等键。
      if (pending.current) {
        const rejected = await save(pending.current);
        if (rejected) show("error", rejected);
        return;
      }
      show("progress", tr("正在查询资料…"));
      // 先读取修订，再检查已存资料。两次读取后的并发编辑由保存时的修订检查保护。
      const album = await services.musicCatalog.album(albumId, signal);
      if ((await api.savedAlbum(albumId, signal)).length) {
        reload.current = true;
        show("result", tr("这张专辑已有刮削资料。"));
        return;
      }
      const requestedAt = Date.now();
      const candidates = await api.autoAlbumCandidates(albumId, provider, signal);
      const previews = new AlbumPreviews(api);
      let lastFailure: string | undefined;
      for (const item of candidates) {
        signal.throwIfAborted();
        show("progress", tr("正在查询资料…"));
        let edition: AlbumEdition;
        try {
          edition = await previews.read(item.pluginId, { externalId: item.id, sourceUrl: item.sourceUrl },
            signal, { summary: { item, requestedAt } });
        } catch (cause) {
          signal.throwIfAborted();
          lastFailure = albumLookupMessage(cause);
          continue;
        }
        signal.throwIfAborted();
        const rejected = await save({ edition, revision: album.revision, key: crypto.randomUUID() });
        if (!rejected) return;
        lastFailure = rejected;
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
  </Modal>;
}
