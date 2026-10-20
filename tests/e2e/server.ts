import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { copyFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, resolve, join } from 'node:path';
import { yamlFixture, type FixtureConfig } from '../fixtures/config-yaml';
import { createNcmFixtures } from '../fixtures/ncm';
import { instanceIds } from '../fixtures/plugins';

export interface TestServer { origin: string; token: string; directory: string; stop: () => Promise<void> }
export async function startServer(options: { ncm?: boolean } = {}): Promise<TestServer> {
  console.log('Building isolated test server and plugins');
  const web = resolve(import.meta.dirname, '../..'); const server = resolve(web, '../server');
  const runtime = join(web, '.e2e-runtime'); mkdirSync(runtime, { recursive: true });
  const directory = mkdtempSync(join(runtime, 'run-')); const suffix = process.platform === 'win32' ? '.exe' : '';
  const binaries = ['musicfs', 'musicfs-plugin-local', 'musicfs-plugin-audio-ffmpeg'];
  if (options.ncm) binaries.push('musicfs-plugin-ncm');
  for (const name of binaries) execFileSync('go', ['build', '-o', join(directory, name + suffix), `./src/app/${name}`], { cwd: server, stdio: 'pipe', windowsHide: true });
  const music = join(directory, 'music'); mkdirSync(music);
  const fixtures = join(server, 'tests/testdata/audio');
  for (const name of ['markers.wav', '中文 空格曲目.wav', 'processing.aiff', 'corrupt.wav', 'empty.wav']) copyFileSync(join(fixtures, name), join(music, name));
  if (options.ncm) createNcmFixtures(fixtures, music);
  else for (let i = 0; i < 101; i++) copyFileSync(join(fixtures, 'markers.wav'), join(music, `pagination-${String(i).padStart(3, '0')}.wav`));
  const token = randomBytes(32).toString('hex'); const origin = 'http://127.0.0.1:18081';
  const ffmpeg = process.env.MUSICFS_E2E_FFMPEG ?? 'D:\\Software\\MultiMedia\\ffmpeg-6.1.1-full_build-shared\\bin\\ffmpeg.exe';
  const ffprobe = process.env.MUSICFS_E2E_FFPROBE ?? 'D:\\Software\\MultiMedia\\ffmpeg-6.1.1-full_build-shared\\bin\\ffprobe.exe';
  if (!existsSync(ffmpeg) || !existsSync(ffprobe)) throw new Error('Set MUSICFS_E2E_FFMPEG and MUSICFS_E2E_FFPROBE to installed binaries');
  if (!options.ncm) execFileSync(ffmpeg, ['-v', 'error', '-stream_loop', '99', '-i', join(fixtures, 'processing.aiff'), '-t', '600', '-c', 'copy', join(music, 'zz-long-processing.aiff')], { windowsHide: true, stdio: 'pipe' });
  const webRoot = join(directory, 'web'); cpSync(join(web, 'dist'), webRoot, { recursive: true });
  copyFileSync(join(fixtures, 'processing.aiff'), join(webRoot, 'raw-processing.aiff'));
  const config: FixtureConfig = {
    configVersion: 1,
    listen: '127.0.0.1:18081', dataRoot: join(directory, 'data'), mediaRoot: join(directory, 'media'), cacheRoot: join(directory, 'cache'),
    webRoot, allowLoopbackHttp: true, allowedOrigins: [origin, 'http://127.0.0.1:5173'], maxSessions: 32,
    plugins: [
      { pluginId: 'musicfs.plugin.source.localfiles', executable: join(directory, 'musicfs-plugin-local' + suffix), enabled: true,
        instances: [{ instanceId: instanceIds.local, name: '测试音乐', enabled: true,
          config: { musicRoots: [{ id: 'local', name: '测试音乐', path: music }] } }] },
      { pluginId: 'musicfs.plugin.decoder.ffmpeg', executable: join(directory, 'musicfs-plugin-audio-ffmpeg' + suffix), enabled: true,
        instances: [{ instanceId: instanceIds.ffmpeg, enabled: true, config: { ffmpegPath: ffmpeg, ffprobePath: ffprobe } }] },
      ...(options.ncm ? [{ pluginId: 'musicfs.plugin.decoder.ncm', executable: join(directory, 'musicfs-plugin-ncm' + suffix), enabled: true,
        instances: [{ instanceId: instanceIds.ncm, enabled: true, config: {} }] }] : []),
    ],
  };
  const configPath = join(directory, 'config.yaml'); writeFileSync(configPath, yamlFixture(config));
  const child = spawn(join(directory, 'musicfs' + suffix), ['serve', '--config', configPath], {
    cwd: directory, env: { ...process.env, MUSICFS_ADMIN_TOKEN: token }, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
  });
  console.log('Waiting for isolated test server readiness');
  let output = ''; child.stdout?.on('data', (data) => { output += data.toString(); }); child.stderr?.on('data', (data) => { output += data.toString(); });
  const stop = async () => {
    await stopChild(child);
    const evidence = join(web, 'test-results', 'media-evidence'); mkdirSync(evidence, { recursive: true });
    for (const name of ['original-evidence.json', 'processed-evidence.json', 'streaming-evidence.json', 'ncm-mp3-evidence.json', 'ncm-flac-evidence.json', 'ncm-error-evidence.json']) {
      if (existsSync(join(directory, name))) copyFileSync(join(directory, name), join(evidence, name));
    }
    if (child.exitCode !== null && dirname(resolve(directory)) === resolve(runtime)) rmSync(directory, { recursive: true, force: true });
  };
  try {
    for (let retry = 0; retry < 100; retry++) {
      if (child.exitCode !== null) throw new Error(`Test server exited: ${output}`);
      try { if ((await fetch(`${origin}/api/v1/health/ready`, { signal: AbortSignal.timeout(2000) })).ok) { console.log('Isolated test server ready'); return { origin, token, directory, stop }; } } catch {}
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    throw new Error(`Test server did not become ready: ${output}`);
  } catch (error) { await stop(); throw error; }
}

export async function stopChild(child: ChildProcess): Promise<void> {
  if (!child.pid || child.exitCode !== null) return;
  if (process.platform === 'win32') {
    try { execFileSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true }); } catch {}
  } else child.kill('SIGINT');
  await new Promise<void>((resolve) => { if (child.exitCode !== null) resolve(); else { child.once('exit', () => resolve()); setTimeout(resolve, 3000); } });
}

export async function startDevServer(target: string): Promise<() => Promise<void>> {
  const web = resolve(import.meta.dirname, '../..');
  const child = spawn(process.execPath, [join(web, 'node_modules/vite/bin/vite.js'), '--host', '127.0.0.1'], {
    cwd: web, env: { ...process.env, MUSICFS_DEV_SERVER: target }, windowsHide: true, stdio: 'ignore',
  });
  for (let retry = 0; retry < 100; retry++) {
    if (child.exitCode !== null) throw new Error('Development proxy exited; check whether port 5173 is already in use');
    try { if ((await fetch('http://127.0.0.1:5173/api/v1/health/ready', { signal: AbortSignal.timeout(1000) })).ok) return () => stopChild(child); } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  await stopChild(child); throw new Error('Development proxy did not become ready');
}
