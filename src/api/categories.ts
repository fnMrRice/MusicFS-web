import { ApiClient, ApiError } from "./client";
import type { SourceTrack } from "./types";

export type CategoryKind = "artist" | "album" | "genre" | "folder";
export interface Category {
  categoryId: string; kind: CategoryKind; name: string; unknown: boolean;
  providerInstanceId: string; rootId: string; parentId: string | null; trackCount: number;
  breadcrumbs: { categoryId: string; name: string }[];
}
export interface CategoryQuery {
  categoryKind: CategoryKind; providerInstanceId?: string;
  categoryId?: string; parentId?: string; q?: string;
}
export interface CatalogPage<T> {
  queryId: string; query: Record<string, unknown>; catalogRevision: string;
  expiresAt: string; total: number; items: T[]; nextCursor: string | null;
}
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
const text = (value: unknown): value is string => typeof value === "string";
const nullableText = (value: unknown) => value === null || text(value);
function category(value: unknown): value is Category {
  return object(value) && text(value.categoryId) && !!value.categoryId && ["artist", "album", "genre", "folder"].includes(String(value.kind)) &&
    text(value.name) && typeof value.unknown === "boolean" && text(value.providerInstanceId) && text(value.rootId) && nullableText(value.parentId) &&
    Number.isSafeInteger(value.trackCount) && Number(value.trackCount) >= 0 && Array.isArray(value.breadcrumbs) &&
    value.breadcrumbs.every((item) => object(item) && text(item.categoryId) && text(item.name));
}
function track(value: unknown): value is SourceTrack {
  return object(value) && text(value.sourceTrackId) && text(value.providerInstanceId) && text(value.displayName) &&
    text(value.availability) && (value.durationMs === null || typeof value.durationMs === "number") &&
    nullableText(value.title) && (value.artists === null || Array.isArray(value.artists) && value.artists.every(text)) &&
    (value.albums === undefined || Array.isArray(value.albums) && value.albums.every(album =>
      object(album) && text(album.albumId) && !!album.albumId && text(album.name) && !!album.name)) &&
    (value.catalogArtists === undefined || Array.isArray(value.catalogArtists) && value.catalogArtists.every(artist =>
      object(artist) && text(artist.artistId) && !!artist.artistId && text(artist.name) && !!artist.name)) &&
    (value.coverObjectId === undefined || nullableText(value.coverObjectId));
}
export class CategoriesApi {
  constructor(private client: ApiClient) {}
  categories(query: CategoryQuery, cursor: string | null, signal?: AbortSignal): Promise<CatalogPage<Category>> {
    return this.page("/library/categories", query, cursor, category, signal);
  }
  tracks(query: CategoryQuery, cursor: string | null, signal?: AbortSignal): Promise<CatalogPage<SourceTrack>> {
    return this.page("/library/search", query, cursor, track, signal);
  }
  release(queryId: string): Promise<void> {
    return this.client.request(`/library/queries/${encodeURIComponent(queryId)}`, { method: "DELETE", keepalive: true });
  }
  private async page<T>(path: string, query: CategoryQuery, cursor: string | null, valid: (v: unknown) => v is T,
    signal?: AbortSignal): Promise<CatalogPage<T>> {
    query = { ...query, q: query.q?.trim() };
    const params = new URLSearchParams({ categoryKind: query.categoryKind, limit: "100" });
    if (path === "/library/search") params.set("type", "tracks");
    for (const field of ["providerInstanceId", "categoryId", "parentId", "q"] as const) {
      const value = query[field];
      if (value && !(field === "providerInstanceId" && value === "all")) params.set(field, value);
    }
    if (cursor) params.set("cursor", cursor);
    const value = await this.client.request<unknown>(`${path}?${params}`, { signal });
    if (!object(value) || !text(value.queryId) || !value.queryId || !object(value.query) ||
      !text(value.catalogRevision) || !value.catalogRevision || !text(value.expiresAt) || !Number.isFinite(Date.parse(value.expiresAt)) ||
      !Number.isSafeInteger(value.total) || Number(value.total) < 0 || !Array.isArray(value.items) || !value.items.every(valid) ||
      !nullableText(value.nextCursor)) throw new ApiError("INVALID_RESPONSE", "Invalid category page");
    const expectedType = path === "/library/search" ? "tracks" : "categories";
    const scope = value.query;
    if (scope.type !== expectedType || scope.categoryKind !== query.categoryKind ||
      (["categoryId", "parentId", "q"] as const).some((field) => String(scope[field] || "") !== (query[field] || "")) ||
      String(scope.providerInstanceId || "") !== (query.providerInstanceId === "all" ? "" : query.providerInstanceId || ""))
      throw new ApiError("INVALID_RESPONSE", "Catalog scope does not match the request");
    if (path === "/library/categories" && (value.items as Category[]).some((item) => item.kind !== query.categoryKind))
      throw new ApiError("INVALID_RESPONSE", "Category kind does not match the request");
    return value as unknown as CatalogPage<T>;
  }
}
