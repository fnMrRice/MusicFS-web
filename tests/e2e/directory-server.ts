import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { copyFileSync, cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { dirname, join, resolve } from 'node:path';
import { yamlFixture, type FixtureConfig } from '../fixtures/config-yaml';
import { stopChild, type TestServer } from './server';
import { instanceIds } from '../fixtures/plugins';

export interface DirectoryTestServer extends TestServer {
  allowedRoot: string;
  selectedRoot: string;
  secondAllowedRoot: string;
  secondSelectedRoot: string;
  outsideRoot: string;
  configPath: string;
  configuration: string;
  restart: () => Promise<void>;
}

async function freePort(): Promise<number> {
  const listener = createServer();
  await new Promise<void>((resolve, reject) => {
    listener.once('error', reject);
    listener.listen(0, '127.0.0.1', resolve);
  });
  const address = listener.address();
  if (!address || typeof address === 'string') throw new Error('Test listener has no TCP port');
  await new Promise<void>((resolve, reject) => listener.close(error => error ? reject(error) : resolve()));
  return address.port;
}

export async function startDirectoryServer(): Promise<DirectoryTestServer> {
  const web = resolve(import.meta.dirname, '../..');
  const source = resolve(web, '../server');
  const runtime = join(web, '.e2e-runtime');
  mkdirSync(runtime, { recursive: true });
  const directory = mkdtempSync(join(runtime, 'directories-'));
  const suffix = process.platform === 'win32' ? '.exe' : '';
  let child: ChildProcess | undefined;
  const stop = async () => {
    if (child) await stopChild(child);
    if ((!child || child.exitCode !== null) && dirname(resolve(directory)) === resolve(runtime)) {
      rmSync(directory, { recursive: true, force: true });
    }
  };
  try {
    console.log('Building isolated directory test server and local plugin');
    for (const [name, packagePath] of [
      ['musicfs', './src/app/musicfs'], ['musicfs-plugin-local', './plugins/source/localfiles/cmd/musicfs-plugin-local'],
    ]) {
      execFileSync('go', ['build', '-o', join(directory, name + suffix), packagePath], {
        cwd: source, stdio: 'pipe', windowsHide: true,
      });
    }
    const allowedRoot = join(directory, 'Allowed Music');
    const selectedRoot = join(allowedRoot, '精选 子目录');
    const secondAllowedRoot = join(directory, 'Second Music');
    const secondSelectedRoot = join(secondAllowedRoot, '第二专辑');
    const outsideRoot = join(directory, 'Outside Music');
    for (const path of [join(selectedRoot, '一级', '二级'), join(selectedRoot, '.Hidden album'), join(selectedRoot, 'No media'), join(secondSelectedRoot, 'Second child'), outsideRoot]) mkdirSync(path, { recursive: true });
    const wave = join(source, 'tests/testdata/audio/markers.wav');
    copyFileSync(wave, join(selectedRoot, 'selected.wav'));
    copyFileSync(wave, join(selectedRoot, '一级', 'depth-one.wav'));
    copyFileSync(wave, join(selectedRoot, '一级', '二级', 'depth-two.wav'));
    copyFileSync(wave, join(selectedRoot, '.hidden.wav'));
    copyFileSync(wave, join(selectedRoot, '.Hidden album', 'hidden-child.wav'));
    copyFileSync(wave, join(selectedRoot, 'No media', 'nomedia.wav'));
    writeFileSync(join(selectedRoot, 'No media', '.nomedia'), '');
    copyFileSync(wave, join(secondSelectedRoot, 'second-selected.wav'));
    copyFileSync(wave, join(secondSelectedRoot, 'Second child', 'second-depth-one.wav'));
    copyFileSync(wave, join(allowedRoot, 'unselected.wav'));
    copyFileSync(wave, join(outsideRoot, 'outside.wav'));
    const webRoot = join(directory, 'web');
    cpSync(join(web, 'dist'), webRoot, { recursive: true });
    const port = await freePort();
    const origin = `http://127.0.0.1:${port}`;
    const token = randomBytes(32).toString('hex');
    const config: FixtureConfig = {
      configVersion: 1, listen: `127.0.0.1:${port}`, pluginBundle: '',
      dataRoot: join(directory, 'data'), mediaRoot: join(directory, 'media'), cacheRoot: join(directory, 'cache'),
      webRoot, allowLoopbackHttp: true, allowedOrigins: [origin], maxSessions: 32,
      plugins: [{
        pluginId: 'musicfs.plugin.source.localfiles', executable: join(directory, 'musicfs-plugin-local' + suffix), enabled: true,
        instances: [{
          instanceId: instanceIds.local, name: '目录管理测试', enabled: true,
          permissions: { readDirectories: [allowedRoot, secondAllowedRoot] }, config: {},
        }],
      }],
    };
    const configuration = yamlFixture(config);
    const configPath = join(directory, 'config.yaml');
    writeFileSync(configPath, configuration);
    const start = async () => {
      child = spawn(join(directory, 'musicfs' + suffix), ['serve', '--config', configPath], {
        cwd: directory, env: { ...process.env, MUSICFS_ADMIN_TOKEN: token },
        windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
      });
      let output = '';
      child.stdout?.on('data', data => { output += data.toString(); });
      child.stderr?.on('data', data => { output += data.toString(); });
      for (let retry = 0; retry < 100; retry++) {
        if (child.exitCode !== null) throw new Error(`Directory test server exited: ${output}`);
        try {
          if ((await fetch(`${origin}/api/v1/health/ready`, { signal: AbortSignal.timeout(1000) })).ok) return;
        } catch {}
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      throw new Error(`Directory test server did not become ready: ${output}`);
    };
    await start();
    return {
      origin, token, directory, allowedRoot, selectedRoot, secondAllowedRoot, secondSelectedRoot, outsideRoot, configPath, configuration, stop,
      restart: async () => { if (child) await stopChild(child); await start(); },
    };
  } catch (error) { await stop(); throw error; }
}
