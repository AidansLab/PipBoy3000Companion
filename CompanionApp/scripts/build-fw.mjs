#!/usr/bin/env node
/**
 * Build Pip-Boy companion files from FW/*-decoded.js into FW/FW Build/
 *
 *   boot0-decoded.js → FW Build/.boot0   (Storage boot patch; patches stock FW.JS)
 *   *-decoded.js     → FW Build/*.JS      (menu scripts → SD JS/)
 *   FW-decoded.js    — not built (stock FW.JS on device is unchanged)
 *   - Minification: off
 *   - Esprima mangle: off (stock menus keep names like params/db/inv)
 *   - Pretokenise: always
 *
 * Stock menu files are pretokenised decoded source, not esprima-mangled.
 * Web IDE "Module Minification → Esprima" + mangle applies when uploading
 * modules to flash via Modules.addCached, not to SD-card .JS storage files.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';
import { execSync } from 'child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const companionRoot = path.resolve(__dirname, '..');
const fwDir = path.resolve(companionRoot, '../FW');
const fwBuildDir = path.join(fwDir, 'FW Build');
const espruinoToolsDir = path.join(companionRoot, 'EspruinoTools');

const require = createRequire(import.meta.url);

function ensureEspruinoToolsDeps() {
  const acornPath = path.join(espruinoToolsDir, 'node_modules', 'acorn');
  if (!fs.existsSync(acornPath)) {
    console.log('Installing EspruinoTools dependencies...');
    execSync('npm install', { cwd: espruinoToolsDir, stdio: 'inherit' });
  }
}

function initEspruinoTools() {
  const espruinoTools = require(path.join(espruinoToolsDir, 'index.js'));
  return new Promise((resolve, reject) => {
    try {
      espruinoTools.init(() => resolve(globalThis.Espruino));
    } catch (err) {
      reject(err);
    }
  });
}

function applyBuildConfig(Espruino) {
  Object.assign(Espruino.Config, {
    MINIFICATION_LEVEL: '',
    MODULE_MINIFICATION_LEVEL: '',
    MINIFICATION_Mangle: false,
    PRETOKENISE: 2,
    SAVE_ON_SEND: 3,
    COMPILATION: false,
    ENV_ON_CONNECT: false,
  });
}

function pretokeniseCode(Espruino, code, name) {
  const pretokenise = Espruino.Plugins.Pretokenise;
  if (!pretokenise?.tokenise) {
    throw new Error('Pretokenise plugin unavailable (is acorn installed in EspruinoTools?)');
  }
  const before = code.length;
  const tokenised = pretokenise.tokenise(code);
  if (!tokenised.length) {
    throw new Error(`${name}: pretokenise produced empty output`);
  }
  console.log(`  tokenise ${name}: ${before} → ${tokenised.length} bytes`);
  return tokenised;
}

function decodedToOutputName(filename) {
  if (filename.toLowerCase() === 'boot0-decoded.js') return '.boot0';
  const base = filename.replace(/-decoded\.js$/i, '');
  return `${base.toUpperCase()}.JS`;
}

function listDecodedSources() {
  return fs
    .readdirSync(fwDir)
    .filter((name) => {
      const lower = name.toLowerCase();
      if (!lower.endsWith('-decoded.js')) return false;
      // Stock FW.JS stays on the device; companion patches ship in Storage .boot0
      if (lower === 'fw-decoded.js') return false;
      return true;
    })
    .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
}

async function main() {
  ensureEspruinoToolsDeps();

  const sources = listDecodedSources();
  if (sources.length === 0) {
    throw new Error(`No *-decoded.js files found in ${fwDir}`);
  }

  fs.mkdirSync(fwBuildDir, { recursive: true });

  const Espruino = await initEspruinoTools();
  applyBuildConfig(Espruino);

  console.log(`Building ${sources.length} firmware file(s) → ${fwBuildDir}`);
  console.log('Settings: minify=off, mangle=off, pretokenise=always');

  for (const sourceName of sources) {
    const sourcePath = path.join(fwDir, sourceName);
    const outName = decodedToOutputName(sourceName);
    const outPath = path.join(fwBuildDir, outName);
    const source = fs.readFileSync(sourcePath, 'utf8');

    console.log(`${sourceName} → FW Build/${outName}`);
    fs.writeFileSync(outPath, pretokeniseCode(Espruino, source, outName), 'binary');
  }

  console.log('Firmware build complete.');
}

main().catch((err) => {
  console.error(`Firmware build failed: ${err.message}`);
  if (err.stack) console.error(err.stack);
  process.exitCode = 1;
});
