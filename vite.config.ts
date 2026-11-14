import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { Plugin } from 'vite';
import { defineConfig } from 'vitest/config';

/** Every file under a folder, as paths relative to it with forward slashes. */
function listFiles(folder: string, prefix = ''): string[] {
  const found: string[] = [];
  for (const name of readdirSync(folder)) {
    const full = join(folder, name);
    const path = prefix ? `${prefix}/${name}` : name;
    if (statSync(full).isDirectory()) found.push(...listFiles(full, path));
    else found.push(path);
  }
  return found;
}

/** A short hash of the 3D model files: it goes into their addresses, so a changed model is never served from an old copy. */
function modelsVersion(): string {
  const folder = resolve(__dirname, 'public', 'models');
  if (!existsSync(folder)) return 'none';
  const hash = createHash('sha256');
  for (const name of listFiles(folder).sort()) hash.update(name).update(readFileSync(join(folder, name)));
  return hash.digest('hex').slice(0, 10);
}

/**
 * Offline start. After the build, write the list of site files into the service
 * worker so it can save all of them on the very first visit. The list also gets
 * a fingerprint of the files, so a new build makes browsers refresh their copy.
 */
function offlineFiles(): Plugin {
  let outDir = 'dist';
  return {
    name: 'first-outpost-offline-files',
    apply: 'build',
    configResolved(config) {
      outDir = resolve(config.root, config.build.outDir);
    },
    closeBundle() {
      const worker = join(outDir, 'sw.js');
      if (!existsSync(worker)) return;
      const skip = (path: string): boolean =>
        path === 'sw.js' ||
        path.endsWith('.map') ||
        path.includes('-vietnamese-'); // no Vietnamese text in the game
      const all = listFiles(outDir)
        .filter((path) => !skip(path))
        .sort();
      // Models are big: the game asks the worker to keep only the ones this device uses. They still count
      // for the fingerprint, so a build with new models makes browsers refresh their copy.
      const files = all.filter((path) => !path.startsWith('models/'));
      const fingerprint = createHash('sha256');
      // The daily data file is not part of the build: it is fetched fresh, and a new copy each day must not
      // empty the whole saved game of every visitor.
      for (const path of all) {
        if (path.endsWith('spaceweather-latest.json')) continue;
        fingerprint.update(path).update(readFileSync(join(outDir, path)));
      }
      const urls = files.map((path) => (path === 'index.html' ? './' : `./${path}`));
      const source = readFileSync(worker, 'utf8')
        .replace('__BUILD__', fingerprint.digest('hex').slice(0, 12))
        .replace('/*__FILES__*/ []', JSON.stringify(urls));
      writeFileSync(worker, source);
    },
  };
}

// Static, relative-path build: the game runs from any folder on any static host
// (GitHub Pages, Vercel, a USB stick) with no server code and no accounts.
export default defineConfig({
  base: './',
  esbuild: { jsx: 'automatic', jsxImportSource: 'preact' },
  plugins: [offlineFiles()],
  define: { __MODELS_VERSION__: JSON.stringify(modelsVersion()) },
  build: {
    target: 'es2020',
    chunkSizeWarningLimit: 900,
    rollupOptions: {
      output: {
        manualChunks: { three: ['three'] },
      },
    },
  },
  // VITE_POLL=1 watches files by polling. Slower, but it survives the "EBUSY" errors
  // some Windows setups throw when many files change at once.
  server: { host: true, port: 5173, watch: process.env.VITE_POLL ? { usePolling: true, interval: 350 } : undefined },
  preview: { host: true, port: 4173 },
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
  },
});
