import { useEffect, useRef, useState } from "react";
import { tableRowKey, type TrackItem } from "../../api/music-catalog";
import { tr } from "../../i18n";

export interface TrackPagination {
  loading: boolean;
  hasMore: boolean;
  error: string | null;
  more: () => void | Promise<void>;
}

interface Selection {
  queryKey: string;
  all: boolean;
  // 普通模式保存选中项；全选模式保存被单独取消的项。
  ids: Set<string>;
}
type Action = (tracks: TrackItem[]) => void;
interface PendingAction { selection: Selection; action: Action }
const empty = (queryKey: string): Selection => ({ queryKey, all: false, ids: new Set() });
const includes = (selection: Selection, id: string) => selection.all !== selection.ids.has(id);

export function useTrackSelection(queryKey: string, tracks: TrackItem[], complete: boolean,
  pagination: TrackPagination | undefined, reportError: (message: string | null) => void) {
  const [selection, setSelection] = useState(() => empty(queryKey));
  const [pending, setPending] = useState<PendingAction | null>(null);
  const active = useRef<PendingAction | null>(null);
  if (selection.queryKey !== queryKey) {
    setSelection(empty(queryKey));
    setPending(null);
    active.current = null;
  }
  const chosen = tracks.filter((track) => includes(selection, tableRowKey(track)));
  const all = selection.all ? selection.ids.size === 0 : complete && tracks.length > 0 && chosen.length === tracks.length;
  const hasSelection = chosen.length > 0 || (selection.all && !complete);
  const label = selection.all && !complete
    ? selection.ids.size ? tr("已选择全部曲目（排除 {0} 首）", { 0: selection.ids.size }) : tr("已选择全部曲目")
    : tr("已选择 {0} 首", { 0: chosen.length });

  function update(next: Selection) {
    active.current = null;
    setPending(null);
    reportError(null);
    setSelection(next);
  }
  function run(action: Action, batchAction?: (excluded: string[]) => void) {
    if (active.current) return;
    reportError(null);
    if (selection.all && batchAction) { batchAction([...selection.ids]); return; }
    if (!selection.all || complete) { action(chosen); return; }
    const request = { selection, action };
    active.current = request;
    setPending(request);
    // 失败后的再次操作从原游标重试，不执行已读取的部分结果。
    if (pagination?.error && pagination.hasMore && !pagination.loading) void pagination.more();
  }
  useEffect(() => {
    if (!pending || active.current !== pending || pending.selection.queryKey !== queryKey) return;
    if (pagination?.loading) return;
    if (!complete) {
      if (pagination && !pagination.error && pagination.hasMore) { void pagination.more(); return; }
      active.current = null;
      setPending(null);
      reportError(tr("未能读取完整曲目，操作未执行。请重试或刷新列表。"));
      return;
    }
    // 先消费待执行动作，确保重渲染和严格模式不会重复提交。
    active.current = null;
    setPending(null);
    pending.action(tracks.filter((track) => includes(pending.selection, tableRowKey(track))));
  }, [pending, queryKey, tracks, complete, pagination, reportError]);

  return {
    chosen, all, hasSelection, label, busy: pending !== null,
    needsComplete: selection.all && !complete,
    state: selection,
    indeterminate: !all && hasSelection,
    isSelected: (id: string) => includes(selection, id),
    clear: () => update(empty(queryKey)),
    toggleAll: () => update(all ? empty(queryKey) : { queryKey, all: true, ids: new Set() }),
    toggle: (id: string) => {
      const ids = new Set(selection.ids);
      if (ids.has(id)) ids.delete(id); else ids.add(id);
      update({ ...selection, ids });
    },
    run,
  };
}
