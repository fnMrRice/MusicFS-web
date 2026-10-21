import { useEffect, useRef, useState } from "react";
import { useServices, useStore } from "../../app/services";
import { Modal } from "../../components/Modal";
import { ErrorNotice } from "../../components/ui";
import { tr, useLocale } from "../../i18n";
import styles from "./NicknameEditor.module.css";

export function NicknameEditor({ close }: { close: () => void }) {
  useLocale();
  const s = useServices();
  const profile = useStore(s.profile.state);
  const [nickname, setNickname] = useState(profile.data?.nickname ?? "");
  const [dirty, setDirty] = useState(false);
  const mounted = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);
  useEffect(() => {
    if (!dirty && profile.data) setNickname(profile.data.nickname ?? "");
  }, [dirty, profile.data]);
  const value = nickname.trim();
  const invalid = Array.from(value).length > 80 || /[\p{Cc}\p{Cs}]/u.test(value);
  const busy = profile.loading || profile.saving;

  return (
    <Modal title={tr("修改昵称")} close={close}>
      <form onSubmit={async (event) => {
        event.preventDefault();
        if (busy || !profile.data || invalid) return;
        const saved = await s.profile.save(value || null);
        if (saved && mounted.current) close();
      }}>
        <label>
          {tr("昵称")}
          <input
            autoFocus
            value={nickname}
            disabled={busy || !profile.data}
            aria-invalid={invalid}
            aria-describedby={invalid ? "nickname-hint nickname-error" : "nickname-hint"}
            onChange={(event) => { setNickname(event.target.value); setDirty(true); }}
          />
        </label>
        <p id="nickname-hint" className="muted">
          {tr("最多 80 个字符，留空则显示账号标识。")}
        </p>
        {invalid && <p id="nickname-error" role="alert" className="notice error">
          {tr("昵称不能超过 80 个字符或包含控制字符。")}
        </p>}
        {profile.loading && <p className="muted" role="status">{tr("正在加载…")}</p>}
        <ErrorNotice
          error={profile.error}
          retry={!profile.data && !busy ? () => void s.profile.load() : undefined}
        />
        <div className={styles.actions}>
          <button type="button" onClick={close}>{tr("取消")}</button>
          <button className="primary" disabled={busy || !profile.data || invalid}>
            {profile.saving ? tr("正在保存…") : tr("保存")}
          </button>
        </div>
      </form>
    </Modal>
  );
}
