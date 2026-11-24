import { useState } from "react";
import { tr } from "../i18n";
import { ContextMenu, type MenuAction } from "./ContextMenu";
import { IconButton } from "./ui";

interface Props {
  title: string;
  play?: (() => void) | null;
  playLabel?: string;
  enqueue?: (() => void) | null;
  playbackDisabled?: boolean;
  favorite?: { active: boolean; disabled?: boolean; toggle: () => void };
  menuActions?: MenuAction[];
  openMenu?: (x: number, y: number, origin: HTMLElement) => void;
  menuExpanded?: boolean;
}

export function TrackRowActions({ title, play, playLabel, enqueue, playbackDisabled, favorite,
  menuActions, openMenu, menuExpanded }: Props) {
  const [anchor, setAnchor] = useState<{ x: number; y: number; origin: HTMLElement } | null>(null);
  return <div className="track-row-actions">
    {play !== undefined && <IconButton icon="play" label={playLabel ?? tr("播放 {0}", { 0: title })}
      disabled={!play || playbackDisabled} onClick={play ?? undefined} />}
    {favorite && <IconButton icon="heart" label={tr(favorite.active ? "取消收藏 {0}" : "收藏 {0}", { 0: title })}
      aria-pressed={favorite.active} className={favorite.active ? "is-favorite" : undefined}
      disabled={favorite.disabled} onClick={favorite.toggle} />}
    {enqueue !== undefined && <IconButton icon="queue-add" label={tr("将 {0} 加入队列", { 0: title })}
      disabled={!enqueue || playbackDisabled} onClick={enqueue ?? undefined} />}
    {(openMenu || !!menuActions?.length) && <IconButton icon="more" label={tr("{0} 的更多操作", { 0: title })}
      aria-haspopup="menu" aria-expanded={openMenu ? menuExpanded : !!anchor} onClick={event => {
        const origin = event.currentTarget;
        const { left, bottom } = origin.getBoundingClientRect();
        if (openMenu) openMenu(left, bottom, origin);
        else setAnchor({ x: left, y: bottom, origin });
      }} />}
    {anchor && !!menuActions?.length && <ContextMenu {...anchor} label={title}
      actions={menuActions} close={() => setAnchor(null)} />}
  </div>;
}
