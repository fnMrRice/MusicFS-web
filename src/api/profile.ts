import { ApiClient, ApiError } from "./client";

export interface PersonalProfile {
  user: { id: string; role: string };
  nickname: string | null;
}

function profile(value: unknown): PersonalProfile {
  const data = value as Partial<PersonalProfile> | null;
  if (!data || !data.user || typeof data.user.id !== "string" || !data.user.id ||
    typeof data.user.role !== "string" || !data.user.role ||
    (data.nickname !== null && typeof data.nickname !== "string"))
    throw new ApiError("INVALID_RESPONSE", "Invalid personal profile response");
  return { user: { id: data.user.id, role: data.user.role }, nickname: data.nickname };
}

export class ProfileApi {
  constructor(private client: ApiClient) {}

  async read(signal?: AbortSignal): Promise<PersonalProfile> {
    return profile(await this.client.request("/me/profile", { signal }));
  }

  async save(nickname: string | null, signal?: AbortSignal): Promise<PersonalProfile> {
    return profile(await this.client.request("/me/profile", { method: "PUT", body: { nickname }, signal }));
  }
}
