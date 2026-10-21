import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiClient } from "../../src/api/client";
import { PluginSettingsApi, settingsValid, settingsValues, type PluginSettings, type SettingValue } from "../../src/api/plugin-settings";
import { localizedPluginText } from "../../src/components/source-name";
import matching from "../../src/i18n/matching";
import settingsMessages from "../../src/i18n/plugin-settings";
import { setLanguage, tr } from "../../src/i18n";

const settings: PluginSettings = {
  pluginId: "example /plugin", revision: 4, values: { enabled: false, query: "live", threshold: 5, mode: "metadata" },
  schema: { revision: "custom-schema-2", title: "工具设置", localizedTitles: { en: "Utility settings" }, fields: [
    { key: "enabled", type: "checkbox", label: "Enabled", defaultValue: true },
    { key: "query", type: "text", label: "Query", required: true, maxLength: 8, defaultValue: "default" },
    { key: "threshold", type: "number", label: "Threshold", min: 1, max: 10, step: 1, defaultValue: 3 },
    { key: "mode", type: "select", label: "Mode", defaultValue: "metadata", options: [{ value: "metadata", label: "Metadata" }, { value: "audio", label: "Audio" }] },
  ], actions: [{ id: "inspect /all", label: "检查", localizedLabels: { en: "Inspect", ja: "確認" } }] },
};

describe("Declarative plugin settings", () => {
  it("retains false values and fills plugin-declared defaults without plugin-specific keys", () => {
    expect(settingsValues(settings)).toEqual(settings.values);
    expect(settingsValues({ ...settings, values: { enabled: false } })).toEqual({ enabled: false, query: "default", threshold: 3, mode: "metadata" });
  });
  it("enforces declared control constraints including select values and finite numbers", () => {
    expect(settingsValid(settings.schema, settings.values)).toBe(true);
    const patches: Record<string, SettingValue>[] = [{ threshold: Number.NaN }, { threshold: 11 }, { threshold: 1.5 }, { mode: "script" }, { query: "too-long-query" }, { query: " " }, { enabled: "true" }];
    for (const patch of patches) {
      expect(settingsValid(settings.schema, { ...settings.values, ...patch })).toBe(false);
    }
    expect(settingsValid({ ...settings.schema, fields: [{ ...settings.schema.fields[0], type: "html" as "text" }] }, settings.values)).toBe(false);
  });
  it("uses plugin-owned labels and localized variants", () => {
    const action = settings.schema.actions[0];
    expect(localizedPluginText(action.label, action.localizedLabels, "ja")).toBe("確認");
    expect(localizedPluginText(action.label, action.localizedLabels, "fr")).toBe("检查");
  });
  it("supports an arbitrary plugin identifier, schema revision, values, and declared actions", async () => {
    const fetcher = vi.fn<typeof fetch>(async () => Response.json(settings));
    const client = new ApiClient(fetcher); client.csrfToken = "csrf";
    const api = new PluginSettingsApi(client, settings.pluginId);
    expect(await api.get()).toEqual(settings);
    await api.save({ expectedRevision: 4, schemaRevision: settings.schema.revision, values: settings.values }, "save-key");
    await api.action(settings.schema.actions[0].id, "action-key");
    expect(fetcher.mock.calls[0][0]).toBe("/api/v1/plugin-settings/example%20%2Fplugin");
    const [, save] = fetcher.mock.calls[1];
    expect(JSON.parse(save?.body as string)).toEqual({ expectedRevision: 4, schemaRevision: "custom-schema-2", values: settings.values });
    expect(new Headers(save?.headers).get("X-CSRF-Token")).toBe("csrf");
    expect(fetcher.mock.calls[2][0]).toBe("/api/v1/plugin-settings/example%20%2Fplugin/actions/inspect%20%2Fall");
    expect(new Headers(fetcher.mock.calls[2][1]?.headers).get("Idempotency-Key")).toBe("action-key");
  });
  it("rejects another plugin's settings without rendering or submitting them", async () => {
    const client = new ApiClient(vi.fn(async () => Response.json({ ...settings, pluginId: "wrong-plugin" })));
    await expect(new PluginSettingsApi(client, settings.pluginId).get()).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
  });
});

afterEach(() => setLanguage("browser"));
it("registers complete matching and generic settings translations", () => {
  const parameters = (text: string) => [...text.matchAll(/\{\w+\}/g)].map((match) => match[0]).sort();
  for (const [key, translations] of Object.entries({ ...matching, ...settingsMessages })) {
    for (const [index, language] of (["en", "zh-TW", "ja"] as const).entries()) {
      setLanguage(language);
      expect(tr(key)).toBe(translations[index]);
      expect(parameters(translations[index])).toEqual(parameters(key));
    }
  }
});
