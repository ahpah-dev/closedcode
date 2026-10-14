import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';
import react from '@vitejs/plugin-react';
import { promises as fs } from 'node:fs';

const root = fileURLToPath(new URL('../', import.meta.url));
const bundledModules = new Set();
await build({
  configFile: false,
  root: path.join(root, 'desktop-ui'),
  publicDir: path.join(root, 'public'),
  plugins: [react(), { name: 'closedcode-license-inventory', generateBundle() {
    for (const id of this.getModuleIds()) {
      if (!path.isAbsolute(id.split('?')[0])) continue;
      const relative = path.relative(root, id.split('?')[0]).replaceAll('\\', '/');
      if (relative.startsWith('node_modules/')) bundledModules.add(relative);
    }
  } }],
  resolve: { alias: { '@': root } },
  css: { postcss: path.join(root, 'postcss.config.mjs') },
  build: { outDir: path.join(root, 'desktop-ui-dist'), emptyOutDir: true, sourcemap: false, target: 'es2022' },
});
const licenseDirectory = path.join(root, 'desktop-ui-dist', 'licenses');
await fs.mkdir(licenseDirectory, { recursive: true });
await fs.writeFile(path.join(licenseDirectory, 'modules.json'), JSON.stringify([...bundledModules].sort()));
for (const dependency of ['react', 'react-dom', 'lucide-react', 'tailwindcss', 'tw-animate-css']) {
  const directory = path.join(root, 'node_modules', dependency);
  const names = (await fs.readdir(directory)).filter((name) => /^(?:licen[sc]e|copying)(?:\.|$)/i.test(name));
  for (const name of names) await fs.copyFile(path.join(directory, name), path.join(licenseDirectory, `${dependency}-${name}.txt`));
}
