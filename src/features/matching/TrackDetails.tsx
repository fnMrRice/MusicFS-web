import { TrackDetailsApi } from "../../api/track-details";
import type { SourceTrack } from "../../api/types";
import { useServices } from "../../app/services";
import { Modal } from "../../components/Modal";
import { useResource } from "../../components/query";
import { ErrorNotice } from "../../components/ui";
import { useSourceName } from "../../components/use-source-name";
import { tr, useLocale } from "../../i18n";
import { useSourceDownloads } from "../library/use-source-downloads";
import { versionLabel } from "../library/download-format";
import "./track-details.css";

export function TrackDetails({ track, close }: { track: SourceTrack; close: () => void }) {
  useLocale();
  const { sourceTrackId, providerInstanceId } = track;
  const { versions } = useSourceDownloads(track);
  const services = useServices();
  const sourceName = useSourceName();
  const details = useResource(`track-details-${providerInstanceId}-${sourceTrackId}`, (signal) =>
    new TrackDetailsApi(services.client).get(sourceTrackId, providerInstanceId, signal));
  const sections = details.data?.sections.filter((section) => section.fields.length > 0) ?? [];
  return <Modal title={tr("来源版本详情")} close={close}>
    <div className="track-details">
      {!!versions.length && <section className="track-detail-section" aria-label={tr("下载文件")}>
        <h4>{tr("下载文件")}</h4>
        <ul>{versions.map(version => <li key={version.versionId}>{versionLabel(version)}</li>)}</ul>
      </section>}
      <p className="muted">{sourceName(providerInstanceId)} · {tr("详细信息由此来源插件提供。")}</p>
      {details.loading && <p role="status">{tr("正在加载…")}</p>}
      <ErrorNotice error={details.error} retry={details.reload} />
      {details.data && <>
        <h3 className="track-details-title">{details.data.title}</h3>
        {sections.length === 0 ? <p role="status">{tr("此来源插件暂未提供详细信息。")}</p> :
          sections.map((section) => <section className="track-detail-section" key={section.id} aria-label={section.title}>
            <h4>{section.title}</h4>
            <dl>{section.fields.map((field) => <div className="track-detail-field" key={field.id}>
              <dt>{field.label}</dt><dd>{field.value}</dd>
            </div>)}</dl>
          </section>)}
      </>}
    </div>
  </Modal>;
}
