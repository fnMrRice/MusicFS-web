import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// 只重建本次元数据刷新变更的索引，不覆盖并行任务正在编辑的工作区。
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const script = 'scripts/stage-metadata-refresh.mjs';
const git = (args, input) => execFileSync('git', args, { cwd: root, input, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
const head = file => git(['show', `HEAD:${file}`]).replaceAll('\r\n', '\n');
const working = file => readFileSync(path.join(root, file), 'utf8').replaceAll('\r\n', '\n');
const files = new Map();
function replaceOnce(source, before, after) {
  if (!source.includes(before) || source.indexOf(before) !== source.lastIndexOf(before))
    throw new Error(`Expected a unique staging anchor: ${before.slice(0, 100)}`);
  return source.replace(before, after);
}
function rebuild(file, changes) {
  let source = head(file);
  for (const [before, after] of changes) source = replaceOnce(source, before, after);
  files.set(file, source);
}

rebuild('src/api/scans.ts', [
  ['import { LibraryApi } from "./library";', 'import { LibraryApi } from "./library";\nimport { scanMetadataResults } from "./scan-metadata";'],
  ['options: Record<string, never>;', 'options: { refreshMetadata?: boolean };'],
  ['async prepare(instance: string, signal?: AbortSignal): Promise<ScanRequest>', 'async prepare(instance: string, signal?: AbortSignal, rootId?: string): Promise<ScanRequest>'],
  ['    return { mode: "full", schemaRevision: provider.configuration.schemaRevision,', `    if (rootId !== undefined && !provider.roots.some((root) => root.id === rootId))
      throw new ApiError("RESOURCE_CHANGED", "Music folder is no longer available");
    return { mode: "full", schemaRevision: provider.configuration.schemaRevision,`],
  ['      rootIds: provider.roots.map((root) => root.id), options: {} };', `      rootIds: rootId === undefined ? provider.roots.map((root) => root.id) : [rootId],
      options: rootId === undefined ? {} : { refreshMetadata: true } };`],
  ['  async submit(instance:', '  metadataResults(id: string, signal?: AbortSignal) { return scanMetadataResults(this.client, id, signal); }\n  async submit(instance:'],
]);

rebuild('src/library/local-scan-state.ts', [
  ['import { scanError } from "./scan-errors";', 'import { scanError } from "./scan-errors";\nimport type { ScanMetadataSummary } from "../api/scan-metadata";'],
  ['export interface LocalScanSnapshot { busy: boolean; pending: boolean; automaticQueued: boolean; job: ScanJob | null; error: string | null }', `export interface LocalScanSnapshot {
  busy: boolean; pending: boolean; automaticQueued: boolean; job: ScanJob | null; error: string | null;
  refreshing: boolean; metadata: ScanMetadataSummary | null;
}`],
  ['      && saved.request.options && Object.keys(saved.request.options).length === 0) return { pending: saved, automatic };', `      && saved.request.options && Object.entries(saved.request.options).every(([key, value]) => key === "refreshMetadata" && value === true))
      return { pending: saved, automatic };`],
  ['    super({ busy: false, pending: saved.pending !== null || saved.automatic, automaticQueued: saved.automatic, job: null, error: null });', `    super({ busy: false, pending: saved.pending !== null || saved.automatic, automaticQueued: saved.automatic, job: null, error: null,
      refreshing: saved.pending?.request.options.refreshMetadata === true, metadata: null });`],
  ['  requestAutomatic(): void {', `  async refresh(rootId: string): Promise<void> {
    if (this.value.busy || this.value.pending) return;
    await this.run(true, rootId);
  }
  requestAutomatic(): void {`],
  ['  private async run(fresh: boolean): Promise<void>', '  private async run(fresh: boolean, rootId?: string): Promise<void>'],
  ['    this.patch({ busy: true, error: null, ...(fresh ? { job: null } : {}) });', '    this.patch({ busy: true, error: null, ...(fresh ? { job: null, metadata: null, refreshing: rootId !== undefined } : {}) });'],
  ['        const request = await this.api.prepare(this.instance, controller.signal);', `        const request = rootId === undefined ? await this.api.prepare(this.instance, controller.signal)
          : await this.api.prepare(this.instance, controller.signal, rootId);`],
  [`      if (!pendingScanStatuses.includes(job.status)) {
        this.persist(null);
        continueAutomatic = this.automatic;
        const succeeded = job.status === "succeeded" && job.complete;`, `      if (!pendingScanStatuses.includes(job.status)) {
        const succeeded = job.status === "succeeded" && job.complete;
        if (succeeded && this.pending?.request.options.refreshMetadata) {
          const metadata = await this.api.metadataResults(job.jobId, controller.signal);
          if (!current()) return;
          this.patch({ metadata });
          if (metadata.pending) return;
          if (metadata.failed) this.patch({ error: "部分曲目的元数据刷新失败，请检查插件状态后重试。" });
        }
        this.persist(null);
        continueAutomatic = this.automatic;`],
]);

rebuild('src/features/directories/LocalMusicSource.tsx', [
  ['{tr(scan.pending || scan.busy ? scan.job ? "正在扫描…" : "正在提交扫描…" : "扫描音乐")}', '{tr(!scan.refreshing && (scan.pending || scan.busy) ? scan.job ? "正在扫描…" : "正在提交扫描…" : "扫描音乐")}'],
  ['              onClick={() => manage({ type: "edit", rootId: root.id })}>{tr("编辑")}</button>', `              onClick={() => manage({ type: "edit", rootId: root.id })}>{tr("编辑")}</button>
            <button type="button" aria-label={tr("刷新目录 {0} 的元数据", { 0: root.name })}
              title={tr(unavailable ?? "重新读取歌曲信息、封面和歌词，保留手动选定的内容。")}
              disabled={scan.busy || scan.pending || !!unavailable} onClick={() => void state.refresh(root.id)}>{tr("刷新")}</button>`],
]);

rebuild('src/features/directories/LocalScanStatus.tsx', [
  ['  const message = job && (job.status !== "succeeded" || job.complete && !value.pending) ? messages[job.status as keyof typeof messages] : null;', `  const message = job && (job.status !== "succeeded" || job.complete && !value.pending && !value.refreshing) ? messages[job.status as keyof typeof messages] : null;
  const metadata = value.metadata;`],
  ['    {message && <p role="status">{tr(message, { 0: progress })}</p>}', `    {message && <p role="status">{tr(message, { 0: progress })}</p>}
    {value.refreshing && job?.status === "succeeded" && job.complete && (value.pending || metadata && !metadata.pending) && <p role="status">
      {tr(value.pending ? "正在刷新封面和歌词，已处理 {0}/{1} 首曲目…"
        : metadata?.failed ? "元数据刷新已结束，{0} 首曲目处理失败。" : "元数据刷新完成，共处理 {0} 首曲目。",
      { 0: value.pending ? metadata?.completed ?? 0 : metadata?.failed || progress, 1: metadata?.total ?? progress })}
    </p>}
    {metadata && !metadata.pending && !value.pending && <p className="muted">{tr("封面和歌词：已更新 {0} 项，跳过 {1} 项。",
      { 0: metadata.applied, 1: metadata.skipped })}</p>}`],
]);

for (const [file, keys] of [
  ['src/i18n/directories.ts', ['刷新', '刷新目录 {0} 的元数据', '重新读取歌曲信息、封面和歌词，保留手动选定的内容。']],
  ['src/i18n/scans.ts', ['正在刷新封面和歌词，已处理 {0}/{1} 首曲目…', '元数据刷新已结束，{0} 首曲目处理失败。', '元数据刷新完成，共处理 {0} 首曲目。', '封面和歌词：已更新 {0} 项，跳过 {1} 项。', '部分曲目的元数据刷新失败，请检查插件状态后重试。']],
]) {
  const lines = working(file).split('\n');
  const additions = keys.map(key => {
    const matches = lines.filter(line => line.trimStart().startsWith(`${JSON.stringify(key)}:`));
    if (matches.length !== 1) throw new Error(`Translation staging anchor missing: ${key}`);
    return matches[0];
  }).join('\n');
  rebuild(file, [['export default {\n', `export default {\n${additions}\n`]]);
}

const design = 'docs/design.md';
const oldDesignLine = head(design).split('\n').find(line => line.startsWith('旧版原生 DOM 页面'));
if (!oldDesignLine) throw new Error('Design staging anchor missing');
rebuild(design, [[oldDesignLine, oldDesignLine.replace('每行右侧提供减号删除与编辑。', '每行右侧依次提供减号删除、编辑、刷新。') + '\n\n'
  + '目录行的「刷新」只重新扫描该目录，以单次 `options.refreshMetadata:true` 重新读取歌曲信息、音频属性及封面和歌词，不修改目录保存的配置。封面与歌词可替换已有自动内容，保留手动选定的来源内容和 Recording 封面；内容相同或无新候选时保留现状。界面在扫描成功后继续确认全部分页的元数据任务，显示处理数、更新与跳过项数，并单独提示失败；期间防止重复提交，页面切换或重载后恢复同一任务。完成后刷新曲库视图。']]);

rebuild('tests/unit/scans-api.test.ts', [['describe("Scan API", () => {', `describe("Scan API", () => {
  it("refreshes only the selected saved root without changing its configuration", async () => {
    const { api, fetcher } = fixture();
    expect(await api.prepare(provider.id, undefined, "two")).toEqual({ ...body, rootIds: ["two"], options: { refreshMetadata: true } });
    expect(fetcher).toHaveBeenCalledTimes(1);
    await expect(api.prepare(provider.id, undefined, "removed")).rejects.toMatchObject({ code: "RESOURCE_CHANGED" });
    expect(fetcher.mock.calls.every(([, options]) => options?.method === "GET")).toBe(true);
  });`]]);

for (const file of ['src/api/scan-metadata.ts', 'tests/unit/scan-metadata.test.ts', 'tests/fixtures/control-mock.ts'])
  files.set(file, working(file));

let refreshTests = working('tests/unit/metadata-refresh-state.test.ts');
refreshTests = refreshTests.replace('    status: vi.fn<ScansApi["status"]>(async () => null),\n', '');
const discoveryTest = '  it("keeps a finished metadata summary during read-only discovery and clears it for a different job",';
if (refreshTests.includes(discoveryTest)) {
  const start = refreshTests.indexOf(discoveryTest);
  const end = refreshTests.indexOf('  it("keeps the folder busy after scanning until artwork and lyrics finish",', start);
  if (end < 0) throw new Error('Metadata refresh test boundary missing');
  refreshTests = refreshTests.slice(0, start) + refreshTests.slice(end);
}
files.set('tests/unit/metadata-refresh-state.test.ts', refreshTests);

let e2e = working('tests/e2e/metadata-refresh-mock.spec.ts');
e2e = e2e.replace(`    if (path.endsWith('/scan-status')) json = { job: state.posts ? {
      jobId: 'refresh-job', providerInstanceId: instanceIds.local, status: 'succeeded', complete: true, progress: { observed: 2 }, error: null,
    } : null };
    if (path.endsWith('/root-statistics')) json = { roots: [] };
`, '');
files.set('tests/e2e/metadata-refresh-mock.spec.ts', e2e);
files.set(script, working(script));

// 校验白名单，避免把状态发现、目录统计及生产 WebSocket 改动混入索引。
for (const [file, source] of files) {
  if (file === script || file === 'tests/fixtures/control-mock.ts') continue;
  if (/\brefreshStatus\b|\bfinishedJob\b|\.checking\b|\bchecking\s*:|\bdiscovery\s*:|this\.discovery|\/scan-status|root-statistics|useRootStatistics|ScansApi\["status"\]/.test(source))
    throw new Error(`Unrelated changes remain in staged content: ${file}`);
}
const args = new Set(process.argv.slice(2));
if (!args.has('--stage')) throw new Error('Use --stage to update the index without editing working files');
const existing = git(['diff', '--cached', '--name-only']).trim().split('\n').filter(Boolean);
if (existing.some(file => !files.has(file))) throw new Error('Unrelated files are already staged; preserve them and review separately');
const entries = [];
for (const [file, source] of files) {
  const hash = git(['hash-object', '-w', '--stdin'], source).trim();
  entries.push(`100644 ${hash}\t${file}\n`);
}
git(['update-index', '--index-info'], entries.join(''));
console.log(`Staged ${files.size} metadata refresh files without changing existing working files.`);

if (args.has('--export')) {
  const target = path.join(root, '.e2e-runtime', 'metadata-commit-check');
  if (existsSync(target) && readdirSync(target).length) throw new Error('Snapshot directory is not empty');
  mkdirSync(target, { recursive: true });
  git(['checkout-index', '--all', `--prefix=${target.split(path.sep).join('/')}/`]);
  console.log(`Exported index snapshot to ${target}`);
}
