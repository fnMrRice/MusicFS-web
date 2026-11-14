import { useMemo } from "react";
import { useOutletContext } from "react-router-dom";
import { WorksApi, type ContentType } from "../../api/works";
import { useServices } from "../../app/services";
import { useResource } from "../../components/query";

export function useWorkTypes() {
  const services = useServices();
  const api = useMemo(() => new WorksApi(services.client), [services]);
  return useResource("work-content-types", (signal) => api.types(signal));
}

export type WorkTypes = ReturnType<typeof useWorkTypes>;
export const useLibraryTypes = () => useOutletContext<WorkTypes>();

export function workListPath(type: string, tag?: string) {
  const query = new URLSearchParams({ contentType: type });
  if (tag) query.set("tag", tag);
  return `/works?${query}`;
}

export function workSectionTitle(pathname: string, search: string, types: ContentType[] | null): string | undefined {
  if (pathname === "/library") return "曲目列表";
  if (pathname.startsWith("/works/")) return "作品详情";
  if (pathname !== "/works") return undefined;
  const id = new URLSearchParams(search).get("contentType");
  return types?.find((type) => type.id === id)?.name ?? "作品库";
}
