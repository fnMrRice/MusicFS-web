type FixtureValue = string | number | boolean | null | FixtureValue[] | { [key: string]: FixtureValue };
export type FixtureConfig = { [key: string]: FixtureValue };

// Writes only the small, owned test-fixture model; not a general YAML parser/editor.
// JSON double-quoted scalars preserve Windows paths, Unicode and punctuation in YAML.
export function yamlFixture(value: FixtureConfig): string {
  const scalar = (item: FixtureValue): string | undefined => {
    if (Array.isArray(item)) return item.length === 0 ? '[]' : undefined;
    if (item !== null && typeof item === 'object') return Object.keys(item).length === 0 ? '{}' : undefined;
    if (typeof item === 'number' && !Number.isFinite(item)) throw new Error('Non-finite YAML fixture value');
    return JSON.stringify(item);
  };
  const lines = (item: FixtureValue, indent: number): string[] => {
    const prefix = ' '.repeat(indent);
    const entry = (key: string, child: FixtureValue): string[] => {
      const encoded = scalar(child);
      return encoded === undefined ? [`${prefix}${key}`, ...lines(child, indent + 2)] : [`${prefix}${key} ${encoded}`];
    };
    if (Array.isArray(item)) return item.flatMap((child) => entry('-', child));
    if (item !== null && typeof item === 'object') return Object.entries(item).flatMap(([key, child]) => entry(`${JSON.stringify(key)}:`, child));
    throw new Error('YAML fixture root must be a mapping');
  };
  return `${lines(value, 0).join('\n')}\n`;
}
