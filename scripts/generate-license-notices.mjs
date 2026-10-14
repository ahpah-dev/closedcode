import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../', import.meta.url));
const pkg = JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8'));
const directories = new Set(Object.keys(pkg.dependencies).concat(['electron']).map((name) => path.join(root, 'node_modules', name)));
const meta = JSON.parse(await fs.readFile(path.join(root, 'desktop-engine/metafile.json'), 'utf8'));
let uiModules = [];
try { uiModules = JSON.parse(await fs.readFile(path.join(root, 'desktop-ui-dist/licenses/modules.json'), 'utf8')); } catch {}
for (const input of [...Object.keys(meta.inputs), ...uiModules].filter((name) => name.startsWith('node_modules/'))) {
  let directory = path.dirname(path.join(root, input));
  while (directory.startsWith(path.join(root, 'node_modules') + path.sep)) {
    try { await fs.access(path.join(directory, 'package.json')); directories.add(directory); break; } catch {}
    directory = path.dirname(directory);
  }
}
let notices = '# Third-party notices\n\nClosedCode’s original code, branding, and generated artwork are released under the Unlicense. You may use, modify, redistribute, and monetize that original work without attribution. Third-party components remain under their own licenses. Their required notices are preserved below and in bundled runtime distributions.\n\nElectron carries its Electron and Chromium license files. The bundled Node.js/npm distribution includes its own LICENSE and package notices. This inventory includes the bundled MCP engine dependencies.\n\n| Component | Version | License |\n| --- | --- | --- |\n';
let texts = 'ClosedCode third-party license texts\n==================================\n\n';
const seen = new Set();
for (const directory of [...directories].sort()) {
  const component = JSON.parse(await fs.readFile(path.join(directory, 'package.json'), 'utf8'));
  const id = `${component.name}@${component.version}`; if (seen.has(id)) continue; seen.add(id);
  notices += `| ${component.name} | ${component.version} | ${typeof component.license === 'string' ? component.license : 'See component notices'} |\n`;
  for (const filename of await fs.readdir(directory)) {
    if (!/^(?:license|licence|copying|notice)(?:\.|$)/i.test(filename)) continue;
    if (!(await fs.stat(path.join(directory, filename))).isFile()) continue;
    texts += `\n\n${id} — ${filename}\n${'-'.repeat(60)}\n${await fs.readFile(path.join(directory, filename), 'utf8')}`;
  }
}
notices += '\nLicensed build adapters and styles retain their own notices, including build/sites-vite-plugin.LICENSE. Retain third-party notices when redistributing their code. The no-credit promise applies to ClosedCode’s original work.\n';
texts += '\n\nSites Vite adapter license\n-------------------------\n' + await fs.readFile(path.join(root, 'build/sites-vite-plugin.LICENSE'), 'utf8');
await fs.writeFile(path.join(root, 'THIRD_PARTY_NOTICES.md'), notices);
await fs.writeFile(path.join(root, 'THIRD_PARTY_LICENSES.txt'), texts);
console.log(`Preserved license notices for ${seen.size} components.`);
