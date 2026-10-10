import { useServices, useStore } from "../app/services";
import { useRef } from "react";
import { useSearchParams } from "react-router-dom";
import type { ManagedInstance, PluginSnapshot } from "../api/directories";
import { LocalDirectories } from "./directories/LocalDirectories";
import { useResource } from "../components/query";
import { ErrorNotice } from "../components/ui";
import { useSourceName } from "../components/use-source-name";
import { musicSources } from "../components/music-sources";
import { tr } from "../i18n";
import { PlatformAccount } from "./accounts/PlatformAccounts";

export function MusicSources() {
  const s = useServices();
  const auth = useStore(s.auth);
  const admin = auth.session?.user.role === "admin";
  const [query, setQuery] = useSearchParams();
  const plugins = useResource(`settings-local-directories-${admin}`, (signal) => admin
    ? s.client.request<PluginSnapshot>("/admin/plugins", { signal })
    : Promise.resolve({ items: [] }));
  const previousLocal = useRef<ManagedInstance[]>([]);
  if (plugins.data) previousLocal.current = plugins.data.items.filter((plugin) => plugin.pluginId === "musicfs.localfiles").flatMap((plugin) => plugin.instances);
  const local = admin ? previousLocal.current : [];
  const chosen = local.find((instance) => instance.instanceId === query.get("directories"));
  function choose(id: string | null) {
    const next = new URLSearchParams(query);
    if (id) next.set("directories", id); else next.delete("directories");
    setQuery(next, { replace: true });
  }
  const sourceName = useSourceName();
  const providers = useResource("settings-providers", (signal) => s.libraryApi.providers(signal));
  const online = useResource("platform-account-instances", (signal) => s.content.online(signal));
  const sources = new Map(musicSources(providers.data ?? [], online.data ?? []).map((source) => [source.id, source]));

  return <div className="settings-card">
    <h3>{tr("音乐来源")}</h3>
    <p className="muted">使用在线来源前请先登录对应音乐平台。登录不表示拥有会员或完整在线播放权限。</p>
    <ErrorNotice error={providers.error} retry={providers.reload} />
    <ErrorNotice error={online.error} retry={online.reload} />
    {admin && <ErrorNotice error={plugins.error} retry={plugins.reload} />}
    {(providers.loading || online.loading) && <p>{tr("正在读取来源…")}</p>}
    {[...sources].map(([id, source]) => source.online
      ? <PlatformAccount key={id} instance={source.online} />
      : <section key={id} aria-label={sourceName(source.provider!)} style={{ marginBlock: 20 }}>
        <h4>{sourceName(source.provider!)}</h4>
        <p className="muted">{local.find((instance) => instance.instanceId === id)?.runtimeState === "pending_configuration"
          ? tr("待选择音乐目录") : source.provider!.availability === "available" ? tr("可用") : tr("暂不可用")}</p>
        {admin && local.some((instance) => instance.instanceId === id) && <button onClick={() => choose(id)}>{tr("管理音乐目录")}</button>}
      </section>)}
    {local.filter((instance) => !sources.has(instance.instanceId)).map((instance) => <section key={instance.instanceId} style={{ marginBlock: 20 }}>
      <h4>{sourceName(instance.instanceId)}</h4>
      <p className="muted">{tr(instance.runtimeState === "pending_configuration" ? "待选择音乐目录" : "暂不可用")}</p>
      <button onClick={() => choose(instance.instanceId)}>{tr("管理音乐目录")}</button>
    </section>)}
    {!providers.loading && !online.loading && !sources.size && !local.length && !providers.error && !online.error &&
      <p className="muted">{tr("暂无音乐来源")}</p>}
    {admin && chosen && <LocalDirectories key={chosen.instanceId} instance={chosen} close={() => choose(null)} />}
  </div>;
}
