import { ApiClient, ApiError } from "./client";
import type { SourceTrack } from "./types";

export interface PackageSource { providerInstanceId: string; name: string; roots: { id: string; name: string }[] }
export interface PackageLocation { providerInstanceId: string; rootId: string; path: string }
export interface PackageDirectories { path: string; directories: { name: string; path: string }[] }
export interface PackageNode {
  nodeId: string; parentId: string; path: string; name: string;
  kind: "directory" | "audio" | "attachment"; order: number; mime: string; sizeBytes: number;
  sourceTrackId: string; assetId: string; attachmentKind: "image" | "text" | "download" | ""; track: SourceTrack | null;
}
export interface WorkPackage {
  packageId: string; workId: string; providerInstanceId: string; rootId: string;
  relativePath: string; name: string; revision: number; importedAt: string; nodes: PackageNode[];
}
export interface PackagePreview {
  previewId: string; workId: string; expiresAt: string; package: WorkPackage;
  counts: { directories: number; audio: number; attachments: number }; warnings: string[];
}
const record = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value);
const text = (value: unknown): value is string => typeof value === "string";
const integer = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
function track(value: unknown): value is SourceTrack {
  return record(value) && text(value.sourceTrackId) && text(value.providerInstanceId) && text(value.displayName) &&
    text(value.availability) && (value.durationMs === null || integer(value.durationMs)) &&
    (value.title === null || text(value.title)) && (value.artists === null || Array.isArray(value.artists) && value.artists.every(text));
}
function node(value: unknown): value is PackageNode {
  return record(value) && text(value.nodeId) && !!value.nodeId && text(value.parentId) && text(value.path) &&
    text(value.name) && ["directory", "audio", "attachment"].includes(String(value.kind)) && integer(value.order) &&
    text(value.mime) && integer(value.sizeBytes) && text(value.sourceTrackId) && text(value.assetId) &&
    ["", "image", "text", "download"].includes(String(value.attachmentKind)) && (value.track === null || track(value.track));
}
function validPackage(value: unknown, workId: string): value is WorkPackage {
  if (!record(value) || !text(value.packageId) || value.workId !== workId || !text(value.providerInstanceId) ||
    !text(value.rootId) || !text(value.relativePath) || !text(value.name) || !integer(value.revision) ||
    !text(value.importedAt) || !Array.isArray(value.nodes) || !value.nodes.every(node)) return false;
  const byId = new Map(value.nodes.map((item) => [item.nodeId, item]));
  if (byId.size !== value.nodes.length) return false;
  const roots = value.nodes.filter((item) => !item.parentId);
  if (roots.length !== 1 || roots[0].kind !== "directory" || roots[0].path !== ".") return false;
  const children = new Map<string, PackageNode[]>();
  for (const item of value.nodes) {
    if (item.parentId && byId.get(item.parentId)?.kind !== "directory") return false;
    const siblings = children.get(item.parentId) ?? [];
    siblings.push(item); children.set(item.parentId, siblings);
  }
  const seen = new Set<string>();
  const pending = [roots[0]];
  while (pending.length) {
    const current = pending.pop()!;
    if (seen.has(current.nodeId)) return false;
    seen.add(current.nodeId);
    pending.push(...children.get(current.nodeId) ?? []);
  }
  return seen.size === value.nodes.length;
}
const invalid = () => new ApiError("INVALID_RESPONSE", "Invalid work package response");

export class WorkPackagesApi {
  constructor(private client: ApiClient, private workId: string) {}
  private get base() { return `/works/${encodeURIComponent(this.workId)}`; }
  async sources(signal?: AbortSignal): Promise<PackageSource[]> {
    const value = await this.client.request<unknown>(`${this.base}/package-sources`, { signal });
    if (!record(value) || !Array.isArray(value.items) || !value.items.every((item) => record(item) &&
      text(item.providerInstanceId) && text(item.name) && Array.isArray(item.roots) && item.roots.every((root) =>
        record(root) && text(root.id) && text(root.name)))) throw invalid();
    return value.items as PackageSource[];
  }
  async directories(location: PackageLocation, signal?: AbortSignal): Promise<PackageDirectories> {
    const query = new URLSearchParams({ ...location });
    const value = await this.client.request<unknown>(`${this.base}/package-directories?${query}`, { signal });
    if (!record(value) || !text(value.path) || !Array.isArray(value.directories) || !value.directories.every((item) =>
      record(item) && text(item.name) && text(item.path))) throw invalid();
    return value as unknown as PackageDirectories;
  }
  async preview(location: PackageLocation, signal?: AbortSignal): Promise<PackagePreview> {
    const value = await this.client.request<unknown>(`${this.base}/package-previews`, { method: "POST", body: location, signal, timeoutMs: 100_000 });
    if (!record(value) || !text(value.previewId) || !value.previewId || value.workId !== this.workId || !text(value.expiresAt) ||
      !validPackage(value.package, this.workId) || !record(value.counts) || !integer(value.counts.directories) ||
      !integer(value.counts.audio) || !integer(value.counts.attachments) || !Array.isArray(value.warnings) || !value.warnings.every(text)) throw invalid();
    return value as unknown as PackagePreview;
  }
  async confirm(previewId: string, key: string): Promise<WorkPackage> {
    const value = await this.client.request<unknown>(`${this.base}/packages`, {
      method: "POST", body: { previewId }, idempotencyKey: key, timeoutMs: 100_000,
    });
    if (!validPackage(value, this.workId) || !value.packageId || value.revision < 1) throw invalid();
    return value;
  }
  async list(signal?: AbortSignal): Promise<WorkPackage[]> {
    const value = await this.client.request<unknown>(`${this.base}/packages`, { signal });
    if (!record(value) || !Array.isArray(value.items) || !value.items.every((item) =>
      validPackage(item, this.workId) && !!item.packageId && item.revision > 0)) throw invalid();
    return value.items as WorkPackage[];
  }
  attachmentURL(packageId: string, nodeId: string, download = false): string {
    return `/api/v1${this.base}/packages/${encodeURIComponent(packageId)}/attachments/${encodeURIComponent(nodeId)}${download ? "?download=1" : ""}`;
  }
}
