import { ApiClient, ApiError } from "./client";

export interface NamedValue { id: string; name: string }
export interface ContentType {
  id: string;
  pluginId: string;
  pluginVersion: string;
  name: string;
  description: string;
  creditRoles: NamedValue[];
  externalIdNamespaces: NamedValue[];
  views: string[];
  library?: { order: number; icon: string; trackListOptional: boolean };
}
export interface WorkFields {
  showInTrackList: boolean;
  title: string;
  description: string;
  externalIds: { namespace: string; value: string }[];
  credits: { role: string; name: string }[];
  tags: string[];
}
export interface WorkInput extends WorkFields { contentType: string }
export interface Work extends WorkInput {
  workId: string;
  revision: number;
  createdAt: string;
  updatedAt: string;
}
export interface WorkPage { items: Work[]; nextAfter: string | null }
export interface WorkFilters { contentType?: string; packageKind?: "directory" | "cd_dump"; q?: string; tag?: string; credit?: string }

function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function strings(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}
function namedValues(value: unknown): value is NamedValue[] {
  return Array.isArray(value) && value.every((item) => object(item) &&
    typeof item.id === "string" && !!item.id && typeof item.name === "string") &&
    new Set(value.map((item) => item.id)).size === value.length;
}
function isContentType(value: unknown): value is ContentType {
  return object(value) && typeof value.id === "string" && !!value.id &&
    typeof value.pluginId === "string" && typeof value.pluginVersion === "string" &&
    typeof value.name === "string" && typeof value.description === "string" &&
    namedValues(value.creditRoles) && namedValues(value.externalIdNamespaces) && strings(value.views) &&
    (value.library === undefined || object(value.library) && Number.isSafeInteger(value.library.order) &&
      typeof value.library.icon === "string" && typeof value.library.trackListOptional === "boolean");
}
function isWork(value: unknown): value is Work {
  return object(value) && typeof value.workId === "string" && !!value.workId &&
    typeof value.contentType === "string" && typeof value.title === "string" &&
    typeof value.description === "string" && typeof value.showInTrackList === "boolean" && strings(value.tags) &&
    Array.isArray(value.externalIds) && value.externalIds.every((item) => object(item) &&
      typeof item.namespace === "string" && typeof item.value === "string") &&
    Array.isArray(value.credits) && value.credits.every((item) => object(item) &&
      typeof item.role === "string" && typeof item.name === "string") &&
    typeof value.revision === "number" && Number.isSafeInteger(value.revision) && value.revision > 0 &&
    typeof value.createdAt === "string" && typeof value.updatedAt === "string";
}
function requireWork(value: unknown, id?: string): Work {
  if (!isWork(value) || (id !== undefined && value.workId !== id))
    throw new ApiError("INVALID_RESPONSE", "Invalid work response");
  return value;
}

export class WorksApi {
  constructor(private client: ApiClient) {}
  async types(signal?: AbortSignal): Promise<ContentType[]> {
    const response = await this.client.request<unknown>("/content-types", { signal });
    if (!object(response) || !Array.isArray(response.items) || !response.items.every(isContentType) ||
      new Set(response.items.map((item) => item.id)).size !== response.items.length)
      throw new ApiError("INVALID_RESPONSE", "Invalid content type list");
    return response.items;
  }
  async list(filters: WorkFilters, after: string | null, signal?: AbortSignal): Promise<WorkPage> {
    const query = new URLSearchParams({ limit: "30" });
    for (const [key, value] of Object.entries(filters)) if (value) query.set(key, value);
    if (after) query.set("after", after);
    const response = await this.client.request<unknown>(`/works?${query}`, { signal });
    if (!object(response) || !Array.isArray(response.items) || !response.items.every(isWork) ||
      (response.nextAfter !== null && (typeof response.nextAfter !== "string" || !response.nextAfter)))
      throw new ApiError("INVALID_RESPONSE", "Invalid work page");
    return { items: response.items, nextAfter: response.nextAfter };
  }
  async get(id: string, signal?: AbortSignal): Promise<Work> {
    return requireWork(await this.client.request<unknown>(`/works/${encodeURIComponent(id)}`, { signal }), id);
  }
  async create(input: WorkInput, idempotencyKey: string): Promise<Work> {
    return requireWork(await this.client.request<unknown>("/works", {
      method: "POST", body: input, idempotencyKey,
    }));
  }
  async update(work: Work, fields: WorkFields, idempotencyKey: string): Promise<Work> {
    return requireWork(await this.client.request<unknown>(`/works/${encodeURIComponent(work.workId)}`, {
      method: "PUT", body: { ...fields, expectedRevision: work.revision }, idempotencyKey,
    }), work.workId);
  }
}
