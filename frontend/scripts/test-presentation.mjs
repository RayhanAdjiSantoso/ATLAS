// Runs the Presentation Report Builder's pure-logic tests. The frontend has no test
// runner, and these need none: esbuild (already here through Vite) bundles the
// TypeScript test file, and node:test runs the result.
import { build } from 'esbuild';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const dir = mkdtempSync(join(tmpdir(), 'prs-test-'));
const outfile = join(dir, 'presentation.test.mjs');
try {
  await build({
    entryPoints: [join(here, '../src/reportGenerator/features/presentation/presentation.test.ts')],
    bundle: true,
    platform: 'node',
    format: 'esm',
    outfile,
    logLevel: 'warning',
    // The API client touches the browser on import; these tests never call it.
    alias: { axios: join(here, 'empty-axios.mjs') },
  });
  const run = spawnSync(process.execPath, ['--test', outfile], { stdio: 'inherit', cwd: here });
  process.exitCode = run.status ?? 1;
} finally {
  rmSync(dir, { recursive: true, force: true });
}
