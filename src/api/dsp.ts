import { ApiClient, ApiError, errorMessage } from "./client";

export interface DSPFormat { sampleRate: number; channels: number; layout: string; sampleFormat: string }
export interface DSPOutput { format: DSPFormat; canContinueDSP: boolean }
export interface DSPNode { name: string; version: 1; params?: Record<string, number> }
export interface DSPSettings { chain: DSPNode[]; outputLayout: string; bufferFrames: number }
export interface DSPParameter {
  key: string; label: string; min: number; max: number; step: number; defaultValue: number;
  options?: { label: string; value: number }[];
}
export interface DSPPlugin {
  name: string; aliases?: string[]; version: number; displayName: string; description: string;
  input: { sampleFormat: string; sampleRate: number; layouts: string[] };
  output: { canContinueDSP: boolean; sameAsInput: boolean; layouts: string[] };
  parameters: DSPParameter[];
}
export interface DSPSettingsPage {
  scope: "personal" | "global"; usesGlobal: boolean;
  revision: number; schemaRevision: string; settings: DSPSettings; defaults: DSPSettings;
  catalog: DSPPlugin[]; maxNodes: number; available: boolean; unavailableReason?: string; outputLayouts: string[];
}
export interface DSPValidation {
  input: DSPFormat; output: DSPOutput;
  nodes: { name: string; input: DSPFormat; output: DSPOutput }[];
}
export type DSPSaveRequest = { expectedRevision: number; schemaRevision: string } &
  ({ settings: DSPSettings; inheritGlobal?: false } | { inheritGlobal: true });

function readPage(page: DSPSettingsPage): DSPSettingsPage {
  if (!page || !Number.isSafeInteger(page.revision) || typeof page.schemaRevision !== "string" ||
    !["personal", "global"].includes(page.scope) || typeof page.usesGlobal !== "boolean" ||
    !Array.isArray(page.catalog) || !Array.isArray(page.outputLayouts) || !Number.isInteger(page.maxNodes) ||
    typeof page.available !== "boolean" || !Array.isArray(page.settings?.chain) || !Array.isArray(page.defaults?.chain) ||
    page.catalog.some((plugin) => !plugin.input || !plugin.output || !Array.isArray(plugin.parameters)))
    throw new ApiError("INVALID_RESPONSE", "Invalid DSP settings");
  return page;
}

export class DSPApi {
  constructor(private client: ApiClient, private scope: "personal" | "global" = "personal") {}
  private get path() { return this.scope === "global" ? "/dsp/settings/global" : "/dsp/settings"; }
  async get(signal?: AbortSignal): Promise<DSPSettingsPage> {
    return readPage(await this.client.request<DSPSettingsPage>(this.path, { signal }));
  }
  async save(request: DSPSaveRequest, key: string, signal?: AbortSignal): Promise<DSPSettingsPage> {
    return readPage(await this.client.request<DSPSettingsPage>(this.path, {
      method: "PUT", body: request, idempotencyKey: key, signal,
    }));
  }
  async validate(settings: DSPSettings, signal?: AbortSignal): Promise<DSPValidation> {
    const result = await this.client.request<DSPValidation>("/dsp/settings/validate", { method: "POST", body: { settings }, signal });
    if (!result?.input || !result.output?.format || typeof result.output.canContinueDSP !== "boolean" || !Array.isArray(result.nodes) ||
      result.nodes.some((node) => !node.input || !node.output?.format || typeof node.output.canContinueDSP !== "boolean"))
      throw new ApiError("INVALID_RESPONSE", "Invalid DSP validation");
    return result;
  }
}

export function dspError(cause: unknown): string {
  if (cause instanceof ApiError && ["INVALID_ARGUMENT", "UNSUPPORTED"].includes(cause.code)) return cause.message;
  return errorMessage(cause);
}
