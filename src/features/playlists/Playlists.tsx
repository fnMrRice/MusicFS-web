import { tr, useLocale } from "../../i18n";
import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useServices, useStore } from "../../app/services";
import { usePages } from "../../components/query";
import { Cover, Empty, ErrorNotice, Icon, Sentinel } from "../../components/ui";
import { Modal } from "../../components/Modal";
import { errorMessage } from "../../api/client";
import { RemotePlaylists } from "./RemotePlaylists";
export function Playlists() {
  useLocale();
  const s = useServices();
  const [params, setParams] = useSearchParams();
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const sidebar = useStore(s.playlists);
  const page = usePages(
    `playlists:${sidebar.map((p) => `${p.playlistId}:${p.ruleRevision}`).join(",")}`,
    async (after, signal) => {
      const result = await s.content.playlists(after, signal);
      return { items: result.items, cursor: result.nextAfter };
    },
    (p) => p.playlistId,
  );
  const close = () => {
    setParams({});
    setError(null);
    setName("");
  };
  const create = async () => {
    setBusy(true);
    setError(null);
    try {
      await s.content.create(name.trim());
      await s.reloadPlaylists();
      close();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  useEffect(() => {
    if (params.get("new")) setName("");
  }, [params]);
  return (
    <section>
      <div className="section-title">
        <div>
          <p className="eyebrow">{tr("MADE BY YOU")}</p>
          <h2>{tr("把喜欢，收藏成一张歌单。")}</h2>
        </div>
        <button className="primary" onClick={() => setParams({ new: "1" })}>
          <Icon name="plus" size={16} />
          {tr("新建歌单")}
        </button>
      </div>
      <p className="muted">
        {tr("将本地曲目、远程歌单与个人歌单按顺序聚合。")}
      </p>
      <div className="cards">
        {page.items.map((p) => (
          <Link
            to={`/playlists/${encodeURIComponent(p.playlistId)}`}
            key={p.playlistId}
            className="music-card"
          >
            <Cover large />
            <strong>{p.name}</strong>
            <small>
              {tr("{0} 个来源规则 · {1}", {
                0: p.bindings.length,
                1: p.stale ? tr("待更新") : tr("已更新"),
              })}
            </small>
          </Link>
        ))}
      </div>
      <ErrorNotice error={page.error} retry={page.retry} />
      {page.loading && <p className="loading">{tr("正在读取歌单…")}</p>}
      {!page.loading && !page.items.length && !page.error && (
        <Empty title={tr("创建你的第一张歌单")} icon="folder">
          {tr("在曲目列表中勾选音乐，即可添加到歌单。")}
        </Empty>
      )}
      <Sentinel
        active={!!page.cursor && !page.loading && !page.error}
        load={page.more}
      />
      <RemotePlaylists />
      {params.get("new") && (
        <Modal title={tr("新建歌单")} close={close}>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void create();
            }}
          >
            <label>
              {tr("歌单名称")}
              <input
                value={name}
                maxLength={256}
                required
                autoFocus
                onChange={(e) => setName(e.target.value)}
                placeholder={tr("给这份喜欢起个名字")}
              />
            </label>
            <ErrorNotice error={error} />
            <button className="primary" disabled={busy || !name.trim()}>
              {busy ? tr("正在创建…") : tr("创建歌单")}
            </button>
          </form>
        </Modal>
      )}
    </section>
  );
}
