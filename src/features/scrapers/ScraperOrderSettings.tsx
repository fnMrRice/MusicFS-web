import { useEffect, useRef, useState } from "react";
import { localLyricsId, scraperOrder, type ScraperOrder, type ScraperOrderKind } from "../../api/scraper-order";
import { ApiError, errorMessage } from "../../api/client";
import { ScrapersApi, type Scraper } from "../../api/scrapers";
import { useServices, useStore } from "../../app/services";
import { useResource } from "../../components/query";
import { ErrorNotice } from "../../components/ui";
import { tr, useLocale } from "../../i18n";
import { scraperName } from "./fields";

export function ScraperOrderSettings({ kind }: { kind: ScraperOrderKind }) {
  useLocale();
  const services = useServices();
  const auth = useStore(services.auth);
  const key = `${kind}-auto-settings:${auth.ready?.instanceId}:${auth.session?.user.id}`;
  const heading = `${kind}-scraper-priority`;
  const resource = useResource(key, async signal => {
    const [settings, scrapers] = await Promise.all([
      scraperOrder(services.client, kind, signal), new ScrapersApi(services.client).list(signal),
    ]);
    const eligible = scrapers.filter(source => !source.requiresExternalId && (kind === "lyrics" ? source.fields.includes("lyrics")
      : source.fields.includes("albumDetails") && source.fields.includes("albumTracks")));
    if (kind === "lyrics" && !eligible.some(source => source.pluginId === localLyricsId)) {
      eligible.unshift({ pluginId: localLyricsId, name: "本地歌词", type: "scraper", fields: ["lyrics"], available: true });
    }
    return { settings, scrapers: eligible };
  });
  return <section className="settings-card album-auto-settings" aria-labelledby={heading}>
    <h3 id={heading}>{tr(kind === "lyrics" ? "歌词刮削顺序" : "本地专辑刮削顺序")}</h3>
    <p className="muted">{tr(kind === "lyrics" ? "目录刷新和自动搜索按此顺序查找歌词，找到后停止。移除全部来源可关闭自动查找。"
      : "按以下顺序查找本地专辑。网易云音乐和 QQ 音乐的专辑优先使用各自的平台。")}</p>
    {resource.loading && <p role="status">{tr("正在读取设置…")}</p>}
    <ErrorNotice error={resource.error} retry={resource.reload} />
    {resource.data && <SourceOrder key={key} initial={resource.data.settings} scrapers={resource.data.scrapers} kind={kind} reload={resource.reload} />}
  </section>;
}

function SourceOrder({ initial, scrapers, kind, reload }: { initial: ScraperOrder; scrapers: Scraper[]; kind: ScraperOrderKind; reload: () => void }) {
  const { client } = useServices();
  const [saved, setSaved] = useState(initial);
  const [order, setOrder] = useState(initial.order);
  const [saving, setSaving] = useState(false);
  const [conflict, setConflict] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const operation = useRef<AbortController | null>(null);
  const requestKey = useRef<string | null>(null);
  useEffect(() => () => operation.current?.abort(), []);
  const dirty = order.length !== saved.order.length || order.some((id, i) => id !== saved.order[i]);
  const available = scrapers.filter(source => source.available && !order.includes(source.pluginId));
  function edit(next: string[]) {
    requestKey.current = null;
    setOrder(next);
    setError(null);
    setConfirmed(false);
  }
  function move(from: number, to: number) {
    const next = [...order];
    [next[from], next[to]] = [next[to], next[from]];
    edit(next);
  }
  async function save() {
    if (operation.current || !dirty || conflict) return;
    const controller = new AbortController();
    operation.current = controller;
    requestKey.current ??= crypto.randomUUID();
    setSaving(true);
    setError(null);
    try {
      const result = await scraperOrder(client, kind, controller.signal, {
        settings: { revision: saved.revision, order }, key: requestKey.current,
      });
      if (controller.signal.aborted) return;
      requestKey.current = null;
      setSaved(result);
      setOrder(result.order);
      setConfirmed(true);
    } catch (cause) {
      if (controller.signal.aborted) return;
      const stale = cause instanceof ApiError && (cause.status === 409 || cause.status === 412);
      setConflict(stale);
      setError(stale ? "内容已发生变化，请刷新后重新编辑。" : errorMessage(cause));
    } finally {
      operation.current = null;
      if (!controller.signal.aborted) setSaving(false);
    }
  }
  function name(id: string) {
    return scraperName(id, scrapers.find(source => source.pluginId === id)?.name);
  }
  return <>
    <fieldset disabled={saving || conflict} aria-labelledby={`${kind}-scraper-priority`}>
      <ol>{order.map((id, index) => <li key={id}><div className="album-scraper-row">
        <span>{name(id)}</span>
        <button type="button" aria-label={tr("上移 {name}", { name: name(id) })} disabled={index === 0}
          onClick={() => move(index, index - 1)}>↑</button>
        <button type="button" aria-label={tr("下移 {name}", { name: name(id) })} disabled={index === order.length - 1}
          onClick={() => move(index, index + 1)}>↓</button>
        <button type="button" aria-label={tr("移除 {name}", { name: name(id) })} disabled={kind === "album" && order.length === 1}
          onClick={() => edit(order.filter(value => value !== id))}>{tr("移除")}</button>
      </div></li>)}</ol>
      {available.length > 0 && <select aria-label={tr("添加刮削来源")} value="" onChange={e => edit([...order, e.target.value])}>
        <option value="" disabled>{tr("添加刮削来源")}</option>
        {available.map(source => <option key={source.pluginId} value={source.pluginId}>{name(source.pluginId)}</option>)}
      </select>}
      <button type="button" className="primary" disabled={!dirty} onClick={() => void save()}>
        {tr(saving ? "正在保存…" : "保存设置")}
      </button>
    </fieldset>
    {confirmed && <p className="feedback" role="status">{tr("设置已保存。")}</p>}
    <ErrorNotice error={error} />
    {conflict && <button type="button" onClick={reload}>{tr("重新加载设置")}</button>}
  </>;
}
