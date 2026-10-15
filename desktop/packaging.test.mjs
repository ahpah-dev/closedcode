import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { load } = require('js-yaml');
const { Arch } = require('builder-util');
const { Platform } = require('app-builder-lib');
const { computeArchToTargetNamesMap } = require('app-builder-lib/out/targets/targetFactory.js');

test('Mac packages build only the requested architecture so Electron and bundled Node stay matched', async () => {
  const config = load(await readFile(new URL('../electron-builder.yml', import.meta.url), 'utf8'));
  for (const architecture of ['x64', 'arm64']) {
    const targets = computeArchToTargetNamesMap(new Map([[Arch[architecture], []]]), {
      platformSpecificBuildOptions: config.mac,
      defaultTarget: ['dmg', 'zip'],
    }, Platform.MAC);
    assert.deepEqual([...targets.keys()], [Arch[architecture]]);
    assert.deepEqual(targets.get(Arch[architecture]), ['dmg', 'zip']);
  }
});
