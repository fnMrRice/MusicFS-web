import type { Provider, SourceTrack } from "../api/types";

export function withProviderAvailability(track: SourceTrack, providers: ReadonlyMap<string, Provider>): SourceTrack {
  const provider = providers.get(track.providerInstanceId);
  // 只补充来源当前状态，保留曲目自身的缺失、离线或未知原因，不修改扫描快照。
  let availability = track.availability;
  if (availability === "available" && provider && !["available", "online"].includes(provider.availability)) {
    availability = provider.availability === "unavailable" && provider.accountState === "authRequired"
      ? "loginRequired" : provider.availability || "unknown";
  }
  return {
    ...track,
    availability,
    versions: track.versions?.map((version) => withProviderAvailability(version, providers)),
  };
}

export function trackAvailabilityMessage(availability: string): string {
  switch (availability) {
    case "available": return "";
    case "offline": return "来源离线";
    case "missing": return "文件缺失";
    case "unavailable": return "来源不可用";
    case "loginRequired": return "来源需要登录";
    default: return "可用性未知";
  }
}
