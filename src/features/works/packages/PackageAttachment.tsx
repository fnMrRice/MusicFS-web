import { useEffect, useState } from "react";
import { ApiError, errorMessage } from "../../../api/client";
import type { PackageNode, WorkPackagesApi } from "../../../api/work-packages";
import { useServices } from "../../../app/services";
import { Modal } from "../../../components/Modal";
import { ErrorNotice } from "../../../components/ui";
import { tr, useLocale } from "../../../i18n";
import { fileFormat, fileSize } from "./tree";

const imageMIMEs = new Set(["image/png", "image/jpeg", "image/gif"]);

export function PackageAttachment({ api, packageId, node, close }: {
  api: WorkPackagesApi; packageId: string; node: PackageNode; close: () => void;
}) {
  useLocale();
  const services = useServices();
  const [state, setState] = useState({ loading: false, error: "", text: "", image: "" });
  const limit = node.attachmentKind === "text" ? 1024 * 1024 : 16 * 1024 * 1024;
  const canPreview = (node.attachmentKind === "text" ||
    node.attachmentKind === "image" && imageMIMEs.has(node.mime.split(";")[0].trim().toLowerCase())) && node.sizeBytes <= limit;
  useEffect(() => {
    if (!canPreview) return;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15_000);
    let objectURL = "";
    let disposed = false;
    setState({ loading: true, error: "", text: "", image: "" });
    void (async () => {
      try {
        const response = await fetch(api.attachmentURL(packageId, node.nodeId), { signal: controller.signal, credentials: "same-origin" });
        if (response.status === 401) services.clear();
        if (!response.ok) throw new ApiError("HTTP_ERROR", "Unable to read package attachment", response.status);
        const declared = Number(response.headers.get("content-length"));
        if (declared > limit) throw new ApiError("UNSUPPORTED", "Attachment preview size exceeded");
        const blob = await response.blob();
        if (blob.size > limit) throw new ApiError("UNSUPPORTED", "Attachment preview size exceeded");
        if (disposed) return;
        let text = "";
        if (node.attachmentKind === "image") {
          if (!imageMIMEs.has(blob.type.split(";")[0].trim().toLowerCase())) throw new ApiError("UNSUPPORTED", "Unsupported attachment image type");
          objectURL = URL.createObjectURL(blob);
        } else text = new TextDecoder("utf-8", { fatal: true }).decode(await blob.arrayBuffer());
        if (!disposed) setState({ loading: false, error: "", text, image: objectURL });
      } catch (error) {
        if (!disposed) setState({ loading: false, error: controller.signal.aborted ? tr("附件读取超时，请重新打开。") : errorMessage(error), text: "", image: "" });
      } finally { clearTimeout(timer); }
    })();
    return () => { disposed = true; clearTimeout(timer); controller.abort(); if (objectURL) URL.revokeObjectURL(objectURL); };
  }, [api, packageId, node.nodeId, canPreview, limit, node.attachmentKind, services]);
  return <Modal title={tr("附件：{0}", { 0: node.name })} close={close}>
    <div className="package-attachment">
      <p className="muted">{fileFormat(node) ?? tr("附件")} · {fileSize(node.sizeBytes)}</p>
      <ErrorNotice error={state.error || null} />
      {state.loading && <p role="status">{tr("正在读取附件…")}</p>}
      {!canPreview && <p>{tr("此附件不提供页面预览，可以下载后查看。")}</p>}
      {state.image && <img src={state.image} alt={node.name} onError={() => setState((old) => ({ ...old, error: tr("图片无法显示，请下载后查看。") }))} />}
      {canPreview && node.attachmentKind === "text" && !state.loading && !state.error && <pre>{state.text || tr("此文本文件为空。")}</pre>}
      <a className="button" href={api.attachmentURL(packageId, node.nodeId, true)} download={node.name}>{tr("下载附件")}</a>
    </div>
  </Modal>;
}
