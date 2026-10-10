import { useState } from "react";
import { DirectoriesApi, type DirectoryItem, type MusicRoot } from "../../api/directories";
import { Modal } from "../../components/Modal";
import { tr, useLocale } from "../../i18n";
import { DirectoryBrowser } from "./DirectoryBrowser";

export function AddDirectory({ api, roots, disabled, add, close }: {
  api: DirectoriesApi;
  roots: MusicRoot[];
  disabled: boolean;
  add: (item: DirectoryItem) => void;
  close: () => void;
}) {
  useLocale();
  const [selected, setSelected] = useState<DirectoryItem | null>(null);
  return <Modal title={tr("添加本地目录")} close={close}>
    <p className="muted">{tr("只能选择服务端允许访问的目录或其子目录。这里显示的是服务端的文件夹。")}</p>
    <DirectoryBrowser api={api} disabled={disabled} selected={selected} select={setSelected}
      selectedPaths={roots.flatMap((root) => root.path ? [root.path] : [])}
      selectedIds={roots.map((root) => root.id)} />
    <div className="directory-candidate" role="status" aria-label={tr("已选择目录")}>
      {selected ? <><span>{tr("已选择目录")}</span><code>{selected.path}</code></>
        : <span className="muted">{tr("请选择一个目录。")}</span>}
    </div>
    <div className="directory-actions directory-modal-actions">
      <button onClick={close}>{tr("取消")}</button>
      <button className="primary" disabled={disabled || !selected} onClick={() => {
        if (selected) { add(selected); close(); }
      }}>{tr("添加所选目录")}</button>
    </div>
  </Modal>;
}
