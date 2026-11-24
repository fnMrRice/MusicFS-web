import { Link, useParams } from "react-router-dom";
import { AccountPlaylistLists } from "./AccountPlaylistList";
import { useServices } from "../../app/services";
import { useResource } from "../../components/query";
import { useMusicSources, useSourceName } from "../../components/use-source-name";
import { Empty, ErrorNotice } from "../../components/ui";
import { tr } from "../../i18n";
import { PublicPlaylistLink } from "./PublicPlaylistLink";

export default function SourcePlaylists() {
  const { instance = "" } = useParams();
  const s = useServices();
  const sourceName = useSourceName();
  const providers = useResource("source-playlist-providers", (signal) => s.libraryApi.providers(signal));
  const online = useResource("source-playlist-instances", (signal) => s.content.online(signal));
  const source = useMusicSources().find((item) => item.id === instance);

  const label = sourceName(source?.online ?? source?.provider ?? instance);
  const supported = source?.online?.capabilities.some((c) => c.name === "playlist.list" && c.supported);
  const hasAccountList = supported && source?.online?.availability === "available" && source.online.platform !== "bilibili";
  return <section>
    <p className="eyebrow">{tr("来源歌单")}</p>
    {!hasAccountList && <h2>{tr("{0} 的歌单", { 0: label })}</h2>}
    <ErrorNotice error={providers.error} retry={providers.reload} />
    <ErrorNotice error={online.error} retry={online.reload} />
    {!source ? (providers.loading || online.loading)
      ? <p className="loading">{tr("正在读取来源…")}</p>
      : <Empty title={tr("暂无音乐来源")} icon="folder">{tr("此来源不可用，请刷新来源或检查服务端配置。")}</Empty>
      : source.online?.availability === "loginRequired"
        ? <p className="notice">{tr("请先在设置中登录此音乐平台，再读取账号歌单。")}{" "}<Link to="/settings">{tr("设置")}</Link></p>
        : source.online?.availability === "offline" || source.provider?.availability === "offline"
          ? <p className="notice">{tr("来源暂时离线，请稍后重试。")}</p>
          : source.online?.platform === "bilibili"
            ? <PublicPlaylistLink instance={instance} />
          : !source.online || !supported
            ? <p className="notice">{tr("此来源尚不支持读取账号歌单。")}</p>
            : <AccountPlaylistLists sources={[source.online]} />}
  </section>;
}
