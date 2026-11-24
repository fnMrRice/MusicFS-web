import { ApiClient, ApiError, randomRequestId } from "./client";
import type { SourceTrack } from "./types";

// 音频只通过已登录的 Server 建档；浏览器不接收平台临时地址。
export async function resolveOnlineAudio(client: ApiClient, instance: string, external: string, signal: AbortSignal): Promise<SourceTrack> {
  const track = await client.request<SourceTrack>(
    `/online-instances/${encodeURIComponent(instance)}/tracks/${encodeURIComponent(external)}/resolve`,
    { method: "POST", body: {}, signal, timeoutMs: 30_000, idempotencyKey: randomRequestId() },
  );
  if (!track || typeof track.sourceTrackId !== "string" || !track.sourceTrackId ||
      typeof track.providerInstanceId !== "string" || !track.assetId || track.availability !== "available") {
    throw new ApiError("INVALID_RESPONSE", "Invalid online audio resource");
  }
  return track;
}
