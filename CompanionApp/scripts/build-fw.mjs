#!/usr/bin/env node
/**
 * Build Pip-Boy companion files from FW/*-decoded.js into FW/FW Build/
 *
 *   boot0-decoded.js → FW Build/.boot0   (Storage boot patch; patches stock FW.JS)
 *   *-decoded.js     → FW Build/*.JS      (menu scripts → SD JS/)
 *   FW-decoded.js    — not built (stock FW.JS on device is unchanged)
 *
 * Pipeline: optional Terser minify/mangle → Espruino pretokenise.
 *
 * Espruino's built-in Esprima minifier (MINIFICATION_LEVEL=ESPRIMA) cannot
 * handle ES6+ menu source — it emits empty output. Terser runs first when
 * BUILD_MINIFY is true; BUILD_MANGLE controls Terser identifier shortening.
 */

/** Run Terser compress before pretokenise. */
const BUILD_MINIFY = true;
/** Shorten local identifiers during Terser minify. Requires BUILD_MINIFY. */
const BUILD_MANGLE = true;

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';
import { execSync } from 'child_process';
import { minify as terserMinify } from 'terser';

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
  // Espruino Minify plugin is not used — Terser handles ES6 source first.
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

async function minifyCode(code, name) {
  const before = code.length;
  const result = await terserMinify(code, {
    ecma: 2020,
    // Menu files are `(function (params) { ... });` — not invoked here.
    // Terser compress treats them as dead code and drops the whole file.
    compress: false,
    mangle: BUILD_MANGLE,
    format: { comments: false },
  });
  if (result.error) {
    throw new Error(`${name}: terser failed — ${result.error}`);
  }
  const minified = result.code;
  if (!minified?.length || minified.length < before * 0.05) {
    throw new Error(`${name}: terser produced unusable output (${before} → ${minified?.length ?? 0} bytes)`);
  }
  console.log(`  minify ${name}: ${before} → ${minified.length} bytes (mangle=${BUILD_MANGLE})`);
  return minified;
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

async function buildFile(Espruino, source, name) {
  let code = source;
  if (BUILD_MINIFY) {
    code = await minifyCode(code, name);
  }
  return pretokeniseCode(Espruino, code, name);
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
  console.log(
    `Settings: minify=${BUILD_MINIFY ? 'terser' : 'off'}, mangle=${BUILD_MINIFY && BUILD_MANGLE}, pretokenise=always`
  );

  for (const sourceName of sources) {
    const sourcePath = path.join(fwDir, sourceName);
    const outName = decodedToOutputName(sourceName);
    const outPath = path.join(fwBuildDir, outName);
    const source = fs.readFileSync(sourcePath, 'utf8');

    console.log(`${sourceName} → FW Build/${outName}`);
    const built = await buildFile(Espruino, source, outName);
    fs.writeFileSync(outPath, built, 'binary');
  }

  console.log('Firmware build complete.');
  process.exit(0);
}

main().catch((err) => {
  console.error(`Firmware build failed: ${err.message}`);
  if (err.stack) console.error(err.stack);
  process.exitCode = 1;
});
