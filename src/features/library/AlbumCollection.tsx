import { useState, type KeyboardEvent, type MouseEvent } from "react";
import type { MusicCategory } from "../../api/music-catalog";
import { useServices, useStore } from "../../app/services";
import { IconButton } from "../../components/ui";
import { tr, useLocale } from "../../i18n";
import { albumDate } from "../scrapers/AlbumMetadata";
import { AutoAlbumScrape } from "../scrapers/AutoAlbumScrape";
import { AlbumCover } from "./AlbumCover";
import { AlbumMenu, type AlbumMenuTarget } from "./AlbumMenu";
import "./album-collection.css";

export function AlbumViewSwitch() {
  const services = useServices();
  const { albumView } = useStore(services.preferences);
  return <div className="album-view-switch" role="group" aria-label={tr("专辑视图")}>
    <IconButton icon="grid" label={tr("卡片视图")} aria-pressed={albumView === "cards"}
      onClick={() => services.preference({ albumView: "cards" })} />
    <IconButton icon="queue" label={tr("列表视图")} aria-pressed={albumView === "list"}
      onClick={() => services.preference({ albumView: "list" })} />
  </div>;
}

export function AlbumCollection({ items, provider, openAlbum, reload }: {
  items: MusicCategory[]; provider: string; openAlbum: (id: string) => void; reload: () => void;
}) {
  const { locale } = useLocale();
  const { albumView } = useStore(useServices().preferences);
  const [menu, setMenu] = useState<AlbumMenuTarget | null>(null);
  const [scrapeTarget, setScrapeTarget] = useState<MusicCategory | null>(null);

  function showMenu(item: MusicCategory, origin: HTMLElement) {
    const { left, bottom } = origin.getBoundingClientRect();
    setMenu({ item, origin, x: left, y: bottom });
  }
  function rowEvents(item: MusicCategory) {
    return {
      onContextMenu(event: MouseEvent<HTMLElement>) {
        event.preventDefault();
        const origin = event.currentTarget.querySelector<HTMLButtonElement>('[aria-haspopup="menu"]');
        if (origin) setMenu({ item, origin, x: event.clientX, y: event.clientY });
      },
      onKeyDown(event: KeyboardEvent<HTMLElement>) {
        if (event.key !== "ContextMenu" && !(event.shiftKey && event.key === "F10")) return;
        event.preventDefault();
        showMenu(item, event.target as HTMLElement);
      },
    };
  }
  function moreButton(item: MusicCategory, name: string) {
    return <IconButton icon="more" label={tr("{0} 的更多操作", { 0: name })} aria-haspopup="menu"
      aria-expanded={menu?.item.id === item.id} onClick={event => showMenu(item, event.currentTarget)} />;
  }

  return <>
    <AlbumMenu menu={menu} close={() => setMenu(null)} provider={provider} openAlbum={openAlbum} autoScrape={setScrapeTarget} />
    {scrapeTarget && <AutoAlbumScrape albumId={scrapeTarget.id} name={scrapeTarget.name} provider={provider}
      close={changed => { setScrapeTarget(null); if (changed) reload(); }} />}
    {albumView === "cards" ? <div className="category-cards album-cards">
      {items.map(item => {
        const name = item.name || tr("未知专辑");
        return <div key={item.id} className="album-card" {...rowEvents(item)}>
          <button type="button" className="category-card" onClick={() => openAlbum(item.id)}>
            <AlbumCover coverPath={item.coverPath} name={name} decorative />
            <span className="category-card-text"><strong>{name}</strong><small>{tr("{0} 首", { 0: item.trackCount })}</small></span>
          </button>
          {moreButton(item, name)}
        </div>;
      })}
    </div> : items.length > 0 && <div className="album-list-wrap">
      <table className="album-list" aria-label={tr("专辑列表")}>
        <thead><tr>
          <th scope="col">{tr("专辑名称")}</th>
          <th scope="col" className="album-release">{tr("发行商")}</th>
          <th scope="col" className="album-release">{tr("发行日期")}</th>
          <th scope="col" className="album-count">{tr("曲目数")}</th>
          <th scope="col"><span className="sr-only">{tr("操作")}</span></th>
        </tr></thead>
        <tbody>{items.map(item => {
          const name = item.name || tr("未知专辑");
          const date = albumDate(item.releaseDate, locale);
          const release = [item.publisher, date].filter(Boolean).join(" · ");
          return <tr key={item.id} {...rowEvents(item)}>
            <td><button type="button" className="album-list-name" onClick={() => openAlbum(item.id)}>
              <AlbumCover coverPath={item.coverPath} name={name} decorative />
              <span><strong>{name}</strong>{release && <small className="album-release-summary">{release}</small>}</span>
            </button></td>
            <td className="album-release">{item.publisher || "—"}</td>
            <td className="album-release">{date || "—"}</td>
            <td className="album-count">{item.trackCount}</td>
            <td className="album-list-actions">{moreButton(item, name)}</td>
          </tr>;
        })}</tbody>
      </table>
    </div>}
  </>;
}
