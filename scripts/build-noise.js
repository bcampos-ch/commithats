// Bakes the grain tiles: `npm run noise`.
//
// The grain is uncorrelated white noise, every pixel independent, so it reads as even
// film grain at any zoom. It is baked to a raster instead of drawn with an SVG filter,
// because a filter re-runs on every paint and leaves a faint repeating pattern.
// The recipe (seed, mean, sigma, alpha per theme) is the one the Tramo project uses.
//
// The output is deterministic: the same seed always writes the same bytes.

import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';

const assets = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'src', 'assets');

const TILE = 400; // shown at 200px, so the grain stays fine on dense screens
const TARGET = { mean: 87.3, sigma: 86.8 };
const SEED = 0x66726167;
// The alpha is baked in. Dark specks on a light page read as dirt, so paper gets far less.
const VARIANTS = {
  'noise-dark.png': 0.0481,
  'noise-light.png': 0.0185,
};

function mulberry32(seed) {
  let state = seed;
  return () => {
    state += 0x6d2b79f5;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Box–Muller: two independent standard normals from two uniforms.
function gaussian(random) {
  let spare = null;
  return () => {
    if (spare !== null) {
      const value = spare;
      spare = null;
      return value;
    }
    let u = 0;
    do {
      u = random();
    } while (u === 0);
    const magnitude = Math.sqrt(-2 * Math.log(u));
    const angle = 2 * Math.PI * random();
    spare = magnitude * Math.sin(angle);
    return magnitude * Math.cos(angle);
  };
}

// Clipping to real blacks and whites is part of the look, and it shifts the statistics.
// So the gaussian is refitted until the clipped result lands on the target.
function buildLuma() {
  let mean = TARGET.mean + 2;
  let sigma = TARGET.sigma + 3;
  for (let pass = 0; pass < 20; pass += 1) {
    const luma = new Uint8Array(TILE * TILE);
    const next = gaussian(mulberry32(SEED));
    for (let index = 0; index < luma.length; index += 1) {
      luma[index] = Math.max(0, Math.min(255, Math.round(mean + next() * sigma)));
    }

    const actualMean = luma.reduce((sum, value) => sum + value, 0) / luma.length;
    const actualSigma = Math.sqrt(luma.reduce((sum, value) => sum + (value - actualMean) ** 2, 0) / luma.length);
    if (Math.abs(actualMean - TARGET.mean) < 0.3 && Math.abs(actualSigma - TARGET.sigma) < 0.8) return luma;

    mean += TARGET.mean - actualMean;
    sigma *= TARGET.sigma / actualSigma;
  }
  throw new Error('Could not fit the noise to the target mean and sigma.');
}

const CRC_TABLE = Uint32Array.from({ length: 256 }, (_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit += 1) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  return value >>> 0;
});

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, checksum]);
}

// A greyscale PNG with an alpha channel: two bytes per pixel, the smallest way to hold this.
function encodePng(luma, alpha) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(TILE, 0);
  header.writeUInt32BE(TILE, 4);
  header.set([8, 4, 0, 0, 0], 8); // 8 bits, greyscale with alpha, no interlace

  const rowLength = 1 + TILE * 2;
  const pixels = Buffer.alloc(rowLength * TILE);
  for (let y = 0; y < TILE; y += 1) {
    for (let x = 0; x < TILE; x += 1) {
      const offset = y * rowLength + 1 + x * 2;
      pixels[offset] = luma[y * TILE + x];
      pixels[offset + 1] = alpha;
    }
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(pixels, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const luma = buildLuma();
for (const [name, alpha] of Object.entries(VARIANTS)) {
  const png = encodePng(luma, Math.round(alpha * 255));
  await writeFile(path.join(assets, name), png);
  console.log(`${name}: ${(png.length / 1024).toFixed(1)} KB`);
}
