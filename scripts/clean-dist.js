// Empties dist/ before a build, so an installer from an earlier build never ends up
// next to the new one or in its checksum file.

import { rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dist = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'dist');
await rm(dist, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
