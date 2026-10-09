import { createCipheriv, createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

// Synthetic fixture writer, independently implemented from the public NCM layout.
// References and licensing notes are recorded in tests/fixtures/README.md.
const coreKey = Buffer.from('687a4852416d736f356b496e62617857', 'hex');
const metadataKey = Buffer.from('2331346c6a6b5f215c5d2630553c2728', 'hex');
const fixtureStreamKey = Buffer.from('MusicFS synthetic fixture key; no account data');

function littleEndian(value: number): Buffer {
  const bytes = Buffer.alloc(4); bytes.writeUInt32LE(value); return bytes;
}
function encryptECB(bytes: Buffer, key: Buffer): Buffer {
  const cipher = createCipheriv('aes-128-ecb', key, null);
  return Buffer.concat([cipher.update(bytes), cipher.final()]);
}
function xor(bytes: Buffer, value: number): Buffer { return Buffer.from(bytes.map((byte) => byte ^ value)); }

export function wrapSyntheticNcm(payload: Buffer, metadata: Record<string, unknown>): Buffer {
  const key = xor(encryptECB(Buffer.concat([Buffer.from('neteasecloudmusic'), fixtureStreamKey]), coreKey), 0x64);
  const infoCipher = encryptECB(Buffer.from(`music:${JSON.stringify(metadata)}`), metadataKey);
  const info = xor(Buffer.from(`163 key(Don't modify):${infoCipher.toString('base64')}`), 0x63);
  const box = Uint8Array.from({ length: 256 }, (_, index) => index); let swapIndex = 0;
  for (let index = 0; index < box.length; index++) {
    swapIndex = (swapIndex + box[index] + fixtureStreamKey[index % fixtureStreamKey.length]) & 255;
    [box[index], box[swapIndex]] = [box[swapIndex], box[index]];
  }
  const encrypted = Buffer.from(payload);
  for (let offset = 0; offset < encrypted.length; offset++) {
    const position = (offset + 1) & 255;
    const mask = box[(box[position] + box[(box[position] + position) & 255]) & 255];
    encrypted[offset] ^= mask;
  }
  const coverFrame = Buffer.alloc(32, 0xa5); Buffer.from('TEST').copy(coverFrame);
  return Buffer.concat([Buffer.from('CTENFDAM'), Buffer.alloc(2), littleEndian(key.length), key,
    littleEndian(info.length), info, Buffer.alloc(5), littleEndian(coverFrame.length), littleEndian(4), coverFrame, encrypted]);
}

export function createNcmFixtures(sourceDirectory: string, outputDirectory: string): void {
  const records = [
    { original: 'vbr-untagged.mp3', output: 'synthetic-mp3.ncm', format: 'mp3', duration: 8040, bitrate: 33265 },
    { original: 'lossless.flac', output: 'synthetic-flac.ncm', format: 'flac', duration: 6000, bitrate: 116162 },
  ].map((fixture) => {
    const payload = readFileSync(join(sourceDirectory, fixture.original));
    const encrypted = wrapSyntheticNcm(payload, { musicName: `Synthetic ${fixture.format.toUpperCase()}`, musicId: 0,
      album: 'MusicFS CC0 fixtures', artist: [['MusicFS', 0]], format: fixture.format, duration: fixture.duration, bitrate: fixture.bitrate });
    writeFileSync(join(outputDirectory, fixture.output), encrypted);
    return { ...fixture, sourceSha512: createHash('sha512').update(payload).digest('hex'),
      ncmSha512: createHash('sha512').update(encrypted).digest('hex'), payloadBytes: payload.length, ncmBytes: encrypted.length };
  });
  writeFileSync(join(outputDirectory, 'corrupt.ncm'), Buffer.from('CTENFDAM\0\0\xff\xff\xff\xff', 'latin1'));
  writeFileSync(join(outputDirectory, 'ncm-fixtures.json'), JSON.stringify({ license: 'CC0-1.0 synthetic source audio',
    generation: 'Independent Node.js AES-128-ECB/PKCS#7 and NCM byte mask writer; no private media', records }, null, 2));
}
