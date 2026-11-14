import { useLayoutEffect, useRef, useState } from "react";
import { ApiError, errorMessage } from "../../api/client";
import type { ContentType, Work, WorkFields, WorkInput, WorksApi } from "../../api/works";
import { useServices } from "../../app/services";
import { Modal } from "../../components/Modal";
import { ErrorNotice } from "../../components/ui";
import { tr, useLocale } from "../../i18n";
import { WorkMetadataFields } from "./WorkMetadataFields";

export function WorkEditor({ api, type, work, close, saved, refresh }: {
  api: WorksApi; type: ContentType; work?: Work;
  close: () => void; saved: (work: Work) => void; refresh?: () => void;
}) {
  useLocale();
  const services = useServices();
  const [data, setData] = useState<WorkInput>(() => work ? {
    contentType: work.contentType, title: work.title, description: work.description,
    credits: work.credits, externalIds: work.externalIds, tags: work.tags, showInTrackList: work.showInTrackList,
  } : { contentType: type.id, title: "", description: "", credits: [], externalIds: [], tags: [], showInTrackList: false });
  const [tagText, setTagText] = useState(work?.tags.join("\n") ?? "");
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const mounted = useRef(false);
  useLayoutEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);
  const key = useRef<string | null>(null);
  const pending = useRef<{ key: string; work?: Work; contentType: string; fields: WorkFields } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [conflict, setConflict] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  const update = (patch: Partial<WorkInput>) => {
    key.current = null;
    pending.current = null;
    setError(null);
    setData((previous) => ({ ...previous, ...patch }));
  };
  const save = async () => {
    if (busyRef.current || conflict) return;
    const tags = [...new Set(tagText.split(/\r?\n/).map((tag) => tag.trim()).filter(Boolean))];
    if (tags.length > 64 || tags.some((tag) => [...tag].length > 64)) {
      setError(tr("最多填写 64 个标签，每个标签不超过 64 个字符。"));
      return;
    }
    if (!data.title.trim() || data.credits.some((credit) => !credit.name.trim()) ||
      data.externalIds.some((external) => !external.value.trim())) {
      setError(tr("请完整填写标题、署名和编号。"));
      return;
    }
    busyRef.current = true;
    setBusy(true);
    setError(null);
    key.current ??= crypto.randomUUID();
    const fields = {
      title: data.title.trim(), description: data.description,
      showInTrackList: data.showInTrackList,
      credits: data.credits.map((credit) => ({ ...credit, name: credit.name.trim() })),
      externalIds: data.externalIds.map((external) => ({ ...external, value: external.value.trim() })), tags,
    };
    pending.current ??= { key: key.current, work: work ? { ...work } : undefined, contentType: data.contentType, fields };
    const request = pending.current;
    const visibilityChanged = request.work && request.fields.showInTrackList !== request.work.showInTrackList;
    try {
      const result = request.work ? await api.update(request.work, request.fields, request.key) :
        await api.create({ ...request.fields, contentType: request.contentType }, request.key);
      if (visibilityChanged) services.invalidateLibraries();
      // 离开页面不撤销已提交的服务端写入，但完成后不能再导航或更新旧界面。
      if (mounted.current) saved(result);
    } catch (failure) {
      const unknown = failure instanceof ApiError && (failure.status === 0 || failure.status >= 500 || failure.code === "INVALID_RESPONSE");
      if (visibilityChanged && unknown) services.invalidateLibraries();
      if (!mounted.current) return;
      setUncertain(unknown);
      if (unknown) {
        setError(tr("暂时无法确认保存结果。已锁定本次内容，请重试确认保存；关闭后请先查看最新资料，避免重复操作。"));
      } else if (work && failure instanceof ApiError && (failure.code === "CONFLICT" || failure.code === "REVISION_CONFLICT" || failure.status === 409)) {
        setConflict(true);
        setError(tr("作品资料已被修改。请刷新最新资料后重新编辑，当前修改不会覆盖它。"));
      } else setError(errorMessage(failure));
    } finally {
      busyRef.current = false;
      if (mounted.current) setBusy(false);
    }
  };
  const leave = () => {
    if (busyRef.current) return;
    close();
    if (uncertain) refresh?.();
  };
  return <Modal title={tr(work ? "编辑作品资料" : "新建作品")} close={leave}>
    <form className="work-editor" onSubmit={(event) => { event.preventDefault(); void save(); }}>
      <fieldset disabled={busy || conflict || uncertain}>
        <label>{tr("内容类型")}
          <select aria-label={tr("内容类型")} value={type.id} disabled>
            <option value={type.id}>{tr(type.name)}</option>
          </select>
        </label>
        {type.library?.trackListOptional && <label className="work-track-visibility">
          <input type="checkbox" checked={data.showInTrackList}
            onChange={(event) => update({ showInTrackList: event.target.checked })} />
          {tr("在曲目列表中显示本专辑的曲目")}
        </label>}
        <label>{tr("作品标题")}
          <input required maxLength={256} value={data.title} onChange={(event) => update({ title: event.target.value })} />
        </label>
        <label>{tr("作品简介")}
          <textarea maxLength={16384} rows={5} value={data.description}
            onChange={(event) => update({ description: event.target.value })} />
        </label>
        <WorkMetadataFields data={data} type={type} update={update} />
        <label>{tr("标签（每行一个）")}
          <textarea rows={3} value={tagText} onChange={(event) => {
            key.current = null; pending.current = null; setError(null); setTagText(event.target.value);
          }} />
        </label>
      </fieldset>
      <ErrorNotice error={error} />
      <div className="work-actions">
        {conflict ? <button type="button" onClick={() => { close(); refresh?.(); }}>{tr("刷新最新资料")}</button> :
          <button className="primary" disabled={busy || !data.title.trim()}>
            {busy ? tr("正在保存…") : uncertain ? tr("重试确认保存") : tr(work ? "保存修改" : "创建作品")}
          </button>}
        <button type="button" disabled={busy} onClick={leave}>{tr(uncertain ? "关闭并刷新查看" : "取消")}</button>
      </div>
    </form>
  </Modal>;
}
