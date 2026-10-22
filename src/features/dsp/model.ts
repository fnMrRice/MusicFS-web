import type { DSPNode, DSPPlugin, DSPSettings, DSPSettingsPage } from "../../api/dsp";

export interface DraftNode { key: string; spec: DSPNode }
export interface DSPDraft extends Omit<DSPSettings, "chain"> { chain: DraftNode[] }

export function pluginFor(name: string, catalog: DSPPlugin[]): DSPPlugin | undefined {
  return catalog.find((plugin) => plugin.name === name || plugin.aliases?.includes(name));
}

export function createNode(plugin: DSPPlugin): DraftNode {
  return { key: crypto.randomUUID(), spec: { name: plugin.name, version: 1,
    params: Object.fromEntries(plugin.parameters.map((parameter) => [parameter.key, parameter.defaultValue])) } };
}

export function draftOf(settings: DSPSettings): DSPDraft {
  return { ...settings, chain: settings.chain.map((spec) => ({ key: crypto.randomUUID(), spec: {
    ...spec, ...(spec.params ? { params: { ...spec.params } } : {}),
  } })) };
}

export function settingsOf(draft: DSPDraft): DSPSettings {
  return { outputLayout: draft.outputLayout, bufferFrames: draft.bufferFrames, chain: draft.chain.map(({ spec }) => spec) };
}

export function settingsFingerprint(settings: DSPSettings): string {
  return JSON.stringify({ outputLayout: settings.outputLayout, bufferFrames: settings.bufferFrames,
    chain: settings.chain.map((spec) => ({ name: spec.name, version: spec.version,
      params: Object.fromEntries(Object.entries(spec.params ?? {}).sort(([left], [right]) => left.localeCompare(right))),
    })) });
}

export function moveNode(draft: DSPDraft, index: number, offset: number): DSPDraft {
  const to = index + offset;
  if (index < 0 || index >= draft.chain.length || to < 0 || to >= draft.chain.length) return draft;
  const chain = [...draft.chain];
  [chain[index], chain[to]] = [chain[to], chain[index]];
  return { ...draft, chain };
}

export function validDraft(draft: DSPDraft, page: DSPSettingsPage): boolean {
  return page.schemaRevision === "dsp-settings-v1" && page.outputLayouts.includes(draft.outputLayout) &&
    Number.isInteger(draft.bufferFrames) && draft.bufferFrames >= 64 && draft.bufferFrames <= 16384 &&
    draft.chain.length <= page.maxNodes && draft.chain.every(({ spec }) => {
      const plugin = pluginFor(spec.name, page.catalog);
      return spec.version === 1 && !!plugin && Object.keys(spec.params ?? {}).every((key) => plugin.parameters.some((p) => p.key === key)) &&
        plugin.parameters.every((parameter) => {
          const value = spec.params?.[parameter.key] ?? parameter.defaultValue;
          return Number.isFinite(value) && value >= parameter.min && value <= parameter.max &&
            (!parameter.options || parameter.options.some((option) => option.value === value));
        });
    });
}
