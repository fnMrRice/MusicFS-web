import { useServices, useStore } from "../app/services";
import { useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import type { ManagedInstance, PluginSnapshot } from "../api/directories";
import { LocalDirectories, type DirectoryAction } from "./directories/LocalDirectories";
import { LocalMusicSource } from "./directories/LocalMusicSource";
import { useResource } from "../components/query";
import { ErrorNotice } from "../components/ui";
import { useSourceName } from "../components/use-source-name";
import { musicSources } from "../components/music-sources";
import { tr, useLocale } from "../i18n";
import { pluginName } from "../components/source-name";
import type { PluginIdentity } from "../api/types";
import { PlatformAccount } from "./accounts/PlatformAccounts";
import { Link } from "react-router-dom";

export function MusicSources() {
  const { locale } = useLocale();
  const s = useServices();
  const auth = useStore(s.auth);
  const admin = auth.session?.user.role === "admin";
  const [query, setQuery] = useSearchParams();
  const plugins = useResource(`settings-local-directories-${admin}`, (signal) => admin
    ? s.client.request<PluginSnapshot>("/admin/plugins", { signal })
    : Promise.resolve({ items: [] }));
  const previousLocal = useRef<(ManagedInstance & { plugin: PluginIdentity })[]>([]);
  if (plugins.data) previousLocal.current = plugins.data.items.filter((plugin) => plugin.pluginId === "musicfs.plugin.source.localfiles")
    .flatMap((plugin) => plugin.instances.map((instance) => ({ ...instance, plugin: plugin.plugin })));
  const local = admin ? previousLocal.current : [];
  const chosen = local.find((instance) => instance.instanceId === query.get("directories"));
  const [directoryAction, setDirectoryAction] = useState<DirectoryAction>({ type: "add" });
  function choose(id: string | null, action: DirectoryAction = { type: "add" }) {
    setDirectoryAction(action);
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
    <p className="muted">{tr("公开匿名来源无需平台账号；其他来源按提示登录。登录不代表拥有会员或完整播放权限。")}</p>
    <ErrorNotice error={providers.error} retry={providers.reload} />
    <ErrorNotice error={online.error} retry={online.reload} />
    {admin && <ErrorNotice error={plugins.error} retry={plugins.reload} />}
    {(providers.loading || online.loading) && <p>{tr("正在读取来源…")}</p>}
    {[...sources].map(([id, source]) => source.online
      ? source.online.authentication === "anonymous"
        ? <section key={id} aria-label={sourceName(source.online)} style={{ marginBlock: 20 }}>
          <h4>{sourceName(source.online)}</h4>
          <p>{tr("匿名访问公开内容，无需平台登录。")}</p>
          <Link to={`/search?source=${encodeURIComponent(id)}`}>{tr("打开链接或编号")}</Link>
        </section>
        : <PlatformAccount key={id} instance={source.online} />
      : admin && local.some((instance) => instance.instanceId === id)
        ? <LocalMusicSource key={id} instance={local.find((instance) => instance.instanceId === id)!}
          name={sourceName(source.provider!)} manage={(action) => choose(id, action)} />
        : <section key={id} aria-label={sourceName(source.provider!)} style={{ marginBlock: 20 }}>
        <h4>{sourceName(source.provider!)}</h4>
        <p className="muted">{tr(source.provider!.availability === "available" ? "可用" : "暂不可用")}</p>
      </section>)}
    {local.filter((instance) => !sources.has(instance.instanceId)).map((instance) => <LocalMusicSource key={instance.instanceId}
      instance={instance} name={pluginName(instance.plugin, locale)} manage={(action) => choose(instance.instanceId, action)} />)}
    {!providers.loading && !online.loading && !sources.size && !local.length && !providers.error && !online.error &&
      <p className="muted">{tr("暂无音乐来源")}</p>}
    {admin && chosen && <LocalDirectories key={chosen.instanceId} instance={chosen} action={directoryAction} close={() => choose(null)} />}
  </div>;
}
