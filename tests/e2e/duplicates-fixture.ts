import { expect, type Page } from '@playwright/test';
import { copyFileSync } from 'node:fs';
import { join } from 'node:path';
import { instanceIds } from '../fixtures/plugins';
import { startDirectoryServer, type DirectoryTestServer } from './directory-server';
import { login, scan } from './helpers';

export interface DuplicateTrack {
  sourceTrackId: string;
  displayName: string;
  recordingId?: string | null;
  versions?: DuplicateTrack[];
}

/** 使用隔离的真实服务与三个相同音频副本，不接触用户音乐库。 */
export async function duplicateFixture(page: Page, options: { audioTools?: boolean } = {}): Promise<{ server: DirectoryTestServer; tracks: DuplicateTrack[] }> {
  const server = await startDirectoryServer(options);
  try {
    copyFileSync(join(server.selectedRoot, 'selected.wav'), join(server.selectedRoot, 'third.wav'));
    await login(page, server);
    const api = page.request;
    const path = `${server.origin}/api/v1/admin/plugin-instances/${instanceIds.local}/configuration`;
    const config = await (await api.get(path)).json();
    const session = await (await api.get(`${server.origin}/api/v1/auth/session`)).json();
    const defaults = { ...config.importOptions.importDefaults, recursive: false, maxDepth: 0,
      importLyrics: false, excludePatterns: [], skipHidden: true, respectNoMedia: true };
    const response = await api.put(path, {
      headers: { Origin: server.origin, 'X-CSRF-Token': session.csrfToken, 'If-Match': config.revision, 'Idempotency-Key': crypto.randomUUID() },
      data: { musicRoots: [
        { id: 'first-root', name: 'First folder', path: server.selectedRoot, importDefaults: defaults },
        { id: 'second-root', name: 'Second folder', path: server.secondSelectedRoot, importDefaults: defaults },
      ] },
    });
    expect(response.status(), await response.text()).toBe(202);
    const operation = await response.json();
    await expect.poll(async () => (await (await api.get(`${server.origin}/api/v1/admin/plugin-operations/${operation.operationId}`)).json()).status).toBe('succeeded');
    await scan(api, server.origin);
    const tracks = (await (await api.get(`${server.origin}/api/v1/source-tracks`)).json()).items as DuplicateTrack[];
    expect(tracks.map(track => track.displayName).sort()).toEqual(['second-selected.wav', 'selected.wav', 'third.wav']);
    return { server, tracks };
  } catch (error) {
    await server.stop();
    throw error;
  }
}

export async function verifyHashes(page: Page, origin: string, tracks: DuplicateTrack[]): Promise<void> {
  const api = page.request;
  const session = await (await api.get(`${origin}/api/v1/auth/session`)).json();
  for (const track of tracks) {
    const response = await api.post(`${origin}/api/v1/source-tracks/${track.sourceTrackId}/hash-jobs`, {
      headers: { Origin: origin, 'X-CSRF-Token': session.csrfToken, 'Idempotency-Key': crypto.randomUUID() }, data: {},
    });
    expect(response.status()).toBe(202);
    const { jobId } = await response.json();
    await expect.poll(async () => (await (await api.get(`${origin}/api/v1/hash-jobs/${jobId}`)).json()).status).toBe('succeeded');
  }
}

export async function groupedTracks(page: Page, origin: string): Promise<DuplicateTrack[]> {
  const response = await page.request.get(`${origin}/api/v1/source-tracks?groupBy=recording`);
  expect(response.status()).toBe(200);
  return (await response.json()).items;
}
