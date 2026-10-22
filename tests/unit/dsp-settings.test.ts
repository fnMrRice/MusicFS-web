import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiClient, ApiError } from "../../src/api/client";
import { DSPApi, dspError } from "../../src/api/dsp";
import { createNode, draftOf, moveNode, pluginFor, settingsFingerprint, settingsOf, validDraft } from "../../src/features/dsp/model";
import { dspCatalog, dspPage } from "../fixtures/dsp";
import translations from "../../src/i18n/dsp";
import { setLanguage, tr } from "../../src/i18n";

describe("DSP settings draft", () => {
  it("keeps repeated effects and their parameters while moving and serializing nodes", () => {
    const one = createNode(dspCatalog[0]), two = createNode(dspCatalog[0]);
    two.spec.params!.gainDB = -4;
    const draft = { ...draftOf(dspPage().settings), chain: [one, two] };
    const moved = moveNode(draft, 1, -1);
    expect(moved.chain.map(({ key }) => key)).toEqual([two.key, one.key]);
    expect(draft.chain[0]).toBe(one);
    expect(settingsOf(moved).chain).toEqual([two.spec, one.spec]);
    expect(JSON.stringify(settingsOf(moved))).not.toContain(one.key);
    expect(moveNode(draft, 0, -1)).toBe(draft);
    expect(settingsFingerprint(dspPage().settings)).toBe(settingsFingerprint(settingsOf(draftOf(dspPage().settings))));
  });
  it("validates buffer bounds, supported layouts, parameter metadata and unknown nodes", () => {
    const page = dspPage(), draft = draftOf(page.settings);
    expect(validDraft(draft, page)).toBe(true);
    for (const bufferFrames of [64, 1024, 16384]) expect(validDraft({ ...draft, bufferFrames }, page)).toBe(true);
    for (const bufferFrames of [63, 16385, 1.5, NaN, Infinity]) expect(validDraft({ ...draft, bufferFrames }, page)).toBe(false);
    expect(validDraft({ ...draft, outputLayout: "mono" }, page)).toBe(false);
    const gain = createNode(dspCatalog[0]);
    gain.spec.params!.gainDB = 13;
    expect(validDraft({ ...draft, chain: [gain] }, page)).toBe(false);
    gain.spec.params!.gainDB = -3;
    expect(validDraft({ ...draft, chain: [gain] }, page)).toBe(true);
    expect(validDraft({ ...draft, chain: [gain] }, { ...page, maxNodes: 0 })).toBe(false);
    gain.spec.params!.unknown = 1;
    expect(validDraft({ ...draft, chain: [gain] }, page)).toBe(false);
    const mix = createNode(dspCatalog[2]); mix.spec.params!.outputChannels = 3;
    expect(validDraft({ ...draft, chain: [mix] }, page)).toBe(false);
    expect(validDraft(draft, { ...page, schemaRevision: "future-version" })).toBe(false);
    expect(pluginFor("musicfs.dsp.gain", dspCatalog)).toBe(dspCatalog[0]);
  });
});

it("sends versioned personal/global saves, inheritance, CSRF and retry identity", async () => {
  const page = dspPage();
  const format = { sampleFormat: "f32le", sampleRate: 48000, channels: 2, layout: "stereo" };
  const fetcher = vi.fn<typeof fetch>(async (path) => Response.json(String(path).endsWith("/validate") ? {
    input: format, output: { format, canContinueDSP: true }, nodes: [],
  } : page));
  const client = new ApiClient(fetcher); client.csrfToken = "csrf-test";
  const personal = new DSPApi(client), global = new DSPApi(client, "global");
  expect(await personal.get()).toEqual(page);
  await personal.save({ expectedRevision: 3, schemaRevision: page.schemaRevision, settings: page.settings }, "save-key");
  await personal.save({ expectedRevision: 4, schemaRevision: page.schemaRevision, inheritGlobal: true }, "inherit-key");
  await global.save({ expectedRevision: 1, schemaRevision: page.schemaRevision, settings: page.settings }, "global-key");
  await personal.validate(page.settings);
  expect(fetcher.mock.calls.map(([path]) => path)).toEqual([
    "/api/v1/dsp/settings", "/api/v1/dsp/settings", "/api/v1/dsp/settings", "/api/v1/dsp/settings/global", "/api/v1/dsp/settings/validate",
  ]);
  const inherited = fetcher.mock.calls[2][1]!;
  expect(JSON.parse(inherited.body as string)).toEqual({ expectedRevision: 4, schemaRevision: "dsp-settings-v1", inheritGlobal: true });
  expect(new Headers(inherited.headers).get("X-CSRF-Token")).toBe("csrf-test");
  expect(new Headers(inherited.headers).get("Idempotency-Key")).toBe("inherit-key");
});

it("rejects malformed settings and preserves useful server validation errors", async () => {
  const api = new DSPApi(new ApiClient(vi.fn(async () => Response.json({ settings: {} }))));
  await expect(api.get()).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
  expect(dspError(new ApiError("INVALID_ARGUMENT", "Node output cannot continue DSP", 400))).toBe("Node output cannot continue DSP");
  expect(dspError(new ApiError("INTERNAL", "private diagnostic", 500))).not.toContain("private diagnostic");
});

afterEach(() => setLanguage("browser"));
it("registers all DSP translations without dropping placeholders", () => {
  const params = (text: string) => [...text.matchAll(/\{\w+\}/g)].map(([key]) => key).sort();
  for (const [key, values] of Object.entries(translations)) {
    for (const [index, locale] of (["en", "zh-TW", "ja"] as const).entries()) {
      setLanguage(locale); expect(tr(key)).toBe(values[index]); expect(params(values[index])).toEqual(params(key));
    }
  }
});
