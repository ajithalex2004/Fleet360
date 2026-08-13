/**
 * predev — light cleanup of the Next.js cache directory.
 *
 * Why this exists separately from scripts/clean-next-dev.mjs:
 *   The dev:clean script removes the entire .next directory, which is the
 *   right call when a dev run is hopelessly broken (the script also
 *   refuses to run if a dev server is already listening on 3000/3001 to
 *   avoid deleting live chunks). That full wipe is too aggressive as a
 *   predev hook — wiping .next on every dev start costs the same 5-15s
 *   of full rebuild we were trying to avoid by re-enabling the webpack
 *   cache in the first place.
 *
 *   The actual corruption on Windows is concentrated in .next/cache —
 *   the persistent webpack pack cache. Removing just that subdirectory
 *   forces the cache to rebuild (1-3s) on the next dev start while
 *   keeping the .next/build manifests and the working tree intact.
 *
 *   predev runs once per `npm run dev` invocation; the rebuilt cache
 *   is then reused across all hot-reloads during that session.
 */

import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const cacheDir = path.join(root, '.next', 'cache');

async function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

async function safeRemove(target) {
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      fs.rmSync(target, { recursive: true, force: true });
      return;
    } catch (error) {
      if (attempt === 3) {
        console.warn(`[predev] could not remove ${target} after 3 attempts: ${error.message}`);
        return;
      }
      // Brief backoff so file handles from the previous run can release.
      await sleep(attempt * 250);
    }
  }
}

(async () => {
  if (!fs.existsSync(cacheDir)) {
    // Nothing to do — fresh checkout, first dev run.
    return;
  }
  await safeRemove(cacheDir);
  console.log('[predev] cleared .next/cache (webpack pack cache)');
})();
