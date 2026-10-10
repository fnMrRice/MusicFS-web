import { useState } from "react";
import { useServices, useStore } from "../../app/services";
import type { Binding, Playlist } from "../../api/content";
import { useResource } from "../../components/query";
import { Modal } from "../../components/Modal";
import { ErrorNotice } from "../../components/ui";
import { errorMessage } from "../../api/client";
export function PlaylistEditor({
  playlist,
  close,
  saved,
}: {
  playlist: Playlist;
  close: () => void;
  saved: () => void;
}) {
  const s = useServices();
  const personal = useStore(s.playlists);
  const [name, setName] = useState(playlist.name);
  const [bindings, setBindings] = useState<Binding[]>(playlist.bindings);
  const [choice, setChoice] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const remote = useResource("rule-remote", async (signal) => {
    const items = [];
    let after: string | null = null;
    const seen = new Set<string>();
    do {
      const page = await s.content.remote(after, signal);
      items.push(...page.items);
      after = page.nextAfter;
      if (after && seen.has(after)) throw new Error("Pagination stalled");
      if (after) seen.add(after);
    } while (after);
    return items;
  });
  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      await s.content.edit(playlist, name.trim(), bindings);
      await s.reloadPlaylists();
      saved();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  const move = (index: number, delta: number) =>
    setBindings((old) => {
      const next = [...old];
      [next[index], next[index + delta]] = [next[index + delta], next[index]];
      return next;
    });
  return (
    <Modal title="编辑歌单" close={close}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <label>
          歌单名称
          <input
            required
            maxLength={256}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </label>
        <h3>按以下顺序聚合</h3>
        <ol className="rule-list">
          {bindings.map((b, i) => (
            <li key={b.bindingId ?? `${b.kind}:${b.targetId}:${i}`}>
              <span>
                {b.kind === "local"
                  ? `已选曲目 · ${b.entries?.length ?? 0} 首`
                  : b.kind === "remote"
                    ? remote.data?.find((p) => p.playlistId === b.targetId)
                        ?.title || `远程歌单 ${b.targetId}`
                    : personal.find((p) => p.playlistId === b.targetId)?.name ||
                      b.targetId}
              </span>
              <button
                type="button"
                aria-label={`上移规则 ${i + 1}`}
                disabled={i === 0}
                onClick={() => move(i, -1)}
              >
                上移
              </button>
              <button
                type="button"
                aria-label={`下移规则 ${i + 1}`}
                disabled={i === bindings.length - 1}
                onClick={() => move(i, 1)}
              >
                下移
              </button>
              <button
                type="button"
                onClick={() =>
                  setBindings((old) => old.filter((_, n) => n !== i))
                }
              >
                移除
              </button>
            </li>
          ))}
        </ol>
        <label>
          添加聚合来源
          <select value={choice} onChange={(e) => setChoice(e.target.value)}>
            <option value="">选择歌单</option>
            {personal
              .filter((p) => p.playlistId !== playlist.playlistId)
              .map((p) => (
                <option key={p.playlistId} value={`playlist:${p.playlistId}`}>
                  {p.name}
                </option>
              ))}
            {remote.data?.map((p) => (
              <option key={p.playlistId} value={`remote:${p.playlistId}`}>
                远程 · {p.title || p.externalId}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          disabled={!choice}
          onClick={() => {
            const colon = choice.indexOf(":");
            setBindings((old) => [
              ...old,
              {
                kind: choice.slice(0, colon) as "remote" | "playlist",
                targetId: choice.slice(colon + 1),
                entries: [],
              },
            ]);
            setChoice("");
          }}
        >
          添加规则
        </button>
        <p className="muted">
          保存时检查修订；冲突后请关闭并刷新歌单。编辑仅影响本地聚合，不写回平台。
        </p>
        <ErrorNotice error={error || remote.error} />
        <button className="primary" disabled={busy || !name.trim()}>
          {busy ? "正在保存…" : "保存修改"}
        </button>
      </form>
    </Modal>
  );
}
