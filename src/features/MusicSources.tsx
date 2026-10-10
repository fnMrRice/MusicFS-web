import { useServices } from "../app/services";
import { useResource } from "../components/query";
import { ErrorNotice } from "../components/ui";
import { useSourceName } from "../components/use-source-name";
import { musicSources } from "../components/music-sources";
import { tr } from "../i18n";
import { PlatformAccount } from "./accounts/PlatformAccounts";

export function MusicSources() {
  const s = useServices();
  const sourceName = useSourceName();
  const providers = useResource("settings-providers", (signal) => s.libraryApi.providers(signal));
  const online = useResource("platform-account-instances", (signal) => s.content.online(signal));
  const sources = musicSources(providers.data ?? [], online.data ?? []);

  return <div className="settings-card">
    <h3>{tr("音乐来源")}</h3>
    <p className="muted">使用在线来源前请先登录对应音乐平台。登录不表示拥有会员或完整在线播放权限。</p>
    <ErrorNotice error={providers.error} retry={providers.reload} />
    <ErrorNotice error={online.error} retry={online.reload} />
    {(providers.loading || online.loading) && <p>{tr("正在读取来源…")}</p>}
    {sources.map((source) => source.online
      ? <PlatformAccount key={source.id} instance={source.online} />
      : <section key={source.id} aria-label={sourceName(source.provider!)} style={{ marginBlock: 20 }}>
        <h4>{sourceName(source.provider!)}</h4>
        <p className="muted">{source.provider!.availability === "available" ? tr("可用") : tr("暂不可用")}</p>
      </section>)}
    {!providers.loading && !online.loading && !sources.length && !providers.error && !online.error &&
      <p className="muted">{tr("暂无音乐来源")}</p>}
  </div>;
}
