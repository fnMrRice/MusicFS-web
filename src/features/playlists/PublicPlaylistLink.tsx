import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useServices } from "../../app/services";
import { errorMessage } from "../../api/client";
import { ErrorNotice } from "../../components/ui";
import { tr } from "../../i18n";

export function PublicPlaylistLink({ instance }: { instance: string }) {
  const s = useServices();
  const navigate = useNavigate();
  const [reference, setReference] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function open() {
    setBusy(true);
    setError(null);
    try {
      const playlist = await s.content.playlistReference(instance, reference);
      navigate(`/discover/${encodeURIComponent(instance)}/${encodeURIComponent(playlist.externalId)}`);
    } catch (e) { setError(errorMessage(e)); }
    finally { setBusy(false); }
  }
  return <form onSubmit={(e) => { e.preventDefault(); void open(); }}>
    <p>{tr("公开视频按全部分 P 展开；私有内容和登录暂不支持。")}</p>
    <label>{tr("公开收藏夹或音频歌单")}<input value={reference} required maxLength={256} disabled={busy}
      placeholder={tr("收藏夹链接、favorite:编号或 am 编号")} onChange={(e) => setReference(e.target.value)} /></label>
    <button disabled={busy}>{tr(busy ? "正在读取歌单…" : "预览")}</button>
    <ErrorNotice error={error} />
  </form>;
}
