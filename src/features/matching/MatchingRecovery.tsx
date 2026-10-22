import { useState } from "react";
import { errorMessage } from "../../api/client";
import { useServices, useStore } from "../../app/services";
import { ErrorNotice } from "../../components/ui";
import { tr } from "../../i18n";
import { BulkMergeSummary } from "./BulkMerge";

export function MatchingRecovery() {
  const services = useServices();
  const pending = useStore(services.matchingDecisions.pending);
  const result = useStore(services.matchingDecisions.lastBulkMerge);
  const [error, setError] = useState<string | null>(null);
  return <>
    {pending.map((item) => <div className="notice" key={item.key} role="status">
      {item.status === "pending" ? tr(item.request.kind === "bulk-merge" ? "正在合并重复音乐，可离开此页面。" :
        "正在保存歌曲关联，可离开此页面。") : tr("上次歌曲关联操作的结果尚未确认，请继续确认。")}
      {item.status === "uncertain" && <button onClick={() => {
        setError(null);
        void services.matchingDecisions.submit(item.request, item.key).catch((cause) => setError(errorMessage(cause)));
      }}>{tr("继续确认关联结果")}</button>}
    </div>)}
    {result && <BulkMergeSummary result={result} />}
    <ErrorNotice error={error} />
  </>;
}
