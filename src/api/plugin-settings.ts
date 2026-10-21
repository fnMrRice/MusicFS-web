import { ApiClient, ApiError } from "./client";

export type SettingValue = string | number | boolean;
export interface PluginField {
  key: string;
  type: "text" | "number" | "checkbox" | "select";
  label: string;
  description?: string;
  localizedLabels?: Record<string, string>;
  localizedDescriptions?: Record<string, string>;
  defaultValue: SettingValue;
  required?: boolean;
  min?: number;
  max?: number;
  step?: number;
  maxLength?: number;
  options?: { value: string; label: string; localizedLabels?: Record<string, string> }[];
}
export interface PluginAction {
  id: string; label: string; description?: string;
  localizedLabels?: Record<string, string>; localizedDescriptions?: Record<string, string>;
}
export interface PluginSettingsSchema {
  revision: string; title: string; description?: string;
  localizedTitles?: Record<string, string>; localizedDescriptions?: Record<string, string>;
  fields: PluginField[]; actions: PluginAction[];
}
export interface PluginJob {
  jobId: string | null;
  status: "idle" | "queued" | "running" | "succeeded" | "failed";
  processed: number; total: number; candidates?: number; errorCode: string | null; updatedAt: string | null;
}
export interface PluginSettings {
  pluginId: string; schema: PluginSettingsSchema; revision: number;
  values: Record<string, SettingValue>; job?: PluginJob;
}
export interface SettingsRequest { expectedRevision: number; schemaRevision: string; values: Record<string, SettingValue> }

export function settingsValues(settings: PluginSettings): Record<string, SettingValue> {
  return Object.fromEntries(settings.schema.fields.map((field) => [field.key, settings.values[field.key] ?? field.defaultValue]));
}

export function settingsValid(schema: PluginSettingsSchema, values: Record<string, SettingValue>): boolean {
  return schema.fields.every((field) => {
    const value = values[field.key];
    switch (field.type) {
      case "checkbox": return typeof value === "boolean";
      case "text": return typeof value === "string" && (!field.required || value.trim().length > 0) &&
        (field.maxLength === undefined || value.length <= field.maxLength);
      case "select": return typeof value === "string" && !!field.options?.some((option) => option.value === value);
      case "number": return typeof value === "number" && Number.isFinite(value) &&
        (field.min === undefined || value >= field.min) && (field.max === undefined || value <= field.max) &&
        (field.step === undefined || Math.abs((value - (field.min ?? 0)) / field.step - Math.round((value - (field.min ?? 0)) / field.step)) < 1e-8);
      default: return false;
    }
  });
}

export class PluginSettingsApi {
  constructor(private client: ApiClient, private pluginId: string) {}
  private get path() { return `/plugin-settings/${encodeURIComponent(this.pluginId)}`; }
  async get(signal?: AbortSignal): Promise<PluginSettings> {
    const settings = await this.client.request<PluginSettings>(this.path, { signal });
    if (!settings || settings.pluginId !== this.pluginId || !settings.schema || !Array.isArray(settings.schema.fields) ||
      !Array.isArray(settings.schema.actions) || !Number.isSafeInteger(settings.revision) || !settings.values)
      throw new ApiError("INVALID_RESPONSE", "Invalid plugin settings");
    return settings;
  }
  save(request: SettingsRequest, key: string, signal?: AbortSignal) {
    return this.client.request<PluginSettings>(this.path, { method: "PUT", body: request, idempotencyKey: key, signal });
  }
  action(id: string, key: string, signal?: AbortSignal) {
    return this.client.request<PluginJob>(`${this.path}/actions/${encodeURIComponent(id)}`, {
      method: "POST", body: {}, idempotencyKey: key, signal,
    });
  }
}
