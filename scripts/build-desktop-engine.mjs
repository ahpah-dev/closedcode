import { build } from 'esbuild';
import { promises as fs } from 'node:fs';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../', import.meta.url));
const result = await build({
  absWorkingDir: root, entryPoints: ['companion/server.mjs'], outfile: 'desktop-engine/server.mjs',
  bundle: true, platform: 'node', target: 'node24', format: 'esm', metafile: true,
  banner: { js: "import { createRequire as __ccCreateRequire } from 'node:module'; const require = __ccCreateRequire(import.meta.url);" },
});
await fs.writeFile(new URL('../desktop-engine/metafile.json', import.meta.url), JSON.stringify(result.metafile, null, 2));
console.log('Desktop engine bundled with MCP transports.');
