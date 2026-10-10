import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useServices, useStore } from "../../app/services";
import { usePages } from "../../components/query";
import { Cover, Empty, ErrorNotice, Icon, Sentinel } from "../../components/ui";
import { Modal } from "../../components/Modal";
import { errorMessage } from "../../api/client";
import { RemotePlaylists } from "./RemotePlaylists";
export function Playlists() {
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
          <p className="eyebrow">MADE BY YOU</p>
          <h2>把喜欢，收藏成一张歌单。</h2>
        </div>
        <button className="primary" onClick={() => setParams({ new: "1" })}>
          <Icon name="plus" size={16} />
          新建歌单
        </button>
      </div>
      <p className="muted">将本地曲目、远程歌单与个人歌单按顺序聚合。</p>
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
              {p.bindings.length} 个来源规则 · {p.stale ? "待更新" : "已更新"}
            </small>
          </Link>
        ))}
      </div>
      <ErrorNotice error={page.error} retry={page.retry} />
      {page.loading && <p className="loading">正在读取歌单…</p>}
      {!page.loading && !page.items.length && !page.error && (
        <Empty title="创建你的第一张歌单" icon="folder">
          在曲目列表中勾选音乐，即可添加到歌单。
        </Empty>
      )}
      <Sentinel
        active={!!page.cursor && !page.loading && !page.error}
        load={page.more}
      />
      <RemotePlaylists />
      {params.get("new") && (
        <Modal title="新建歌单" close={close}>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void create();
            }}
          >
            <label>
              歌单名称
              <input
                value={name}
                maxLength={256}
                required
                autoFocus
                onChange={(e) => setName(e.target.value)}
                placeholder="给这份喜欢起个名字"
              />
            </label>
            <ErrorNotice error={error} />
            <button className="primary" disabled={busy || !name.trim()}>
              {busy ? "正在创建…" : "创建歌单"}
            </button>
          </form>
        </Modal>
      )}
    </section>
  );
}
