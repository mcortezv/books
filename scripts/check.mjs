#!/usr/bin/env node
// Valida el catalogo y la integridad de la biblioteca.
// Sale con codigo != 0 si hay errores, para poder usarse en CI y en hooks.

import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import {
  ROOT, loadCatalog, loadTags, validateEntry, listLibraryFiles,
  absolutePathFor, isLfsPointer, formatBytes,
} from './lib/catalog.mjs';

const errors = [];
const warnings = [];

const LFS_EXTENSIONS = new Set(['pdf', 'epub', 'mobi', 'azw3', 'djvu', 'chm', 'zip', 'cbz', 'cbr']);

function git(args) {
  return execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
}

// --- 1. catalogo valido -------------------------------------------------

let catalog;
let tags;
try {
  catalog = loadCatalog();
  tags = loadTags();
} catch (err) {
  console.error(`ERROR: no se pudo leer el catálogo: ${err.message}`);
  process.exit(1);
}

catalog.forEach((entry, index) => {
  errors.push(...validateEntry(entry, tags, index));
});

// --- 2. ids y archivos unicos -------------------------------------------

const seenIds = new Map();
const seenFiles = new Map();
for (const entry of catalog) {
  if (entry.id) {
    if (seenIds.has(entry.id)) errors.push(`id duplicado: "${entry.id}".`);
    seenIds.set(entry.id, entry);
  }
  if (entry.file) {
    if (seenFiles.has(entry.file)) {
      errors.push(`archivo referenciado por dos entradas: "${entry.file}" (${seenFiles.get(entry.file).id} y ${entry.id}).`);
    }
    seenFiles.set(entry.file, entry);
  }
}

// --- 3. cada entrada tiene su archivo en disco --------------------------

let pointersNotPulled = 0;
for (const entry of catalog) {
  if (!entry.file) continue;
  const abs = absolutePathFor(entry.file);
  if (!fs.existsSync(abs)) {
    errors.push(`[${entry.id}] el archivo "${entry.file}" no existe en disco.`);
    continue;
  }
  // En CI (o tras un clone con GIT_LFS_SKIP_SMUDGE) el archivo existe pero es
  // solo el puntero. Eso no es un error, solo significa "no descargado".
  if (isLfsPointer(abs)) pointersNotPulled += 1;
}

// --- 4. archivos huerfanos ----------------------------------------------

const catalogedFiles = new Set(catalog.map((e) => e.file).filter(Boolean));
for (const file of listLibraryFiles()) {
  if (!catalogedFiles.has(file)) {
    warnings.push(`archivo sin entrada en el catálogo: "${file}". Corre \`npm run add --file "${file}"\`.`);
  }
}

// --- 5. integridad LFS --------------------------------------------------
// Todo binario ya trackeado por git bajo library/ debe estar en LFS. Si un PDF
// de 40 MB entra como blob normal, sacarlo despues obliga a reescribir historia.

let lfsChecked = false;
try {
  git(['rev-parse', '--git-dir']);

  const tracked = git(['ls-files', '--', 'library'])
    .split('\n').map((s) => s.trim()).filter(Boolean);

  if (tracked.length > 0) {
    let lfsTracked = new Set();
    try {
      lfsTracked = new Set(
        git(['lfs', 'ls-files', '-n']).split('\n').map((s) => s.trim()).filter(Boolean),
      );
    } catch {
      warnings.push('no se pudo ejecutar `git lfs ls-files`. ¿Está instalado Git LFS?');
    }

    for (const file of tracked) {
      const ext = file.split('.').pop()?.toLowerCase();
      if (!LFS_EXTENSIONS.has(ext)) continue;
      if (!lfsTracked.has(file)) {
        errors.push(
          `"${file}" está trackeado por git pero NO por LFS. `
          + 'Corre: git rm --cached "' + file + '" && git add "' + file + '" '
          + '(si ya lo commiteaste, hay que reescribir la historia con git lfs migrate).',
        );
      }
    }
    lfsChecked = true;
  }
} catch {
  warnings.push('no es un repo git todavía; se omite la verificación de LFS.');
}

// --- 6. tamano de books.json --------------------------------------------

const catalogSize = fs.existsSync(`${ROOT}/catalog/books.json`)
  ? fs.statSync(`${ROOT}/catalog/books.json`).size : 0;

// --- reporte ------------------------------------------------------------

const bold = process.stdout.isTTY && !process.env.NO_COLOR ? (s) => `\x1b[1m${s}\x1b[0m` : (s) => s;

console.log(bold('Verificación del catálogo'));
console.log(`  entradas          ${catalog.length}`);
console.log(`  archivos library/ ${listLibraryFiles().length}`);
console.log(`  peso catalogado   ${formatBytes(catalog.reduce((s, e) => s + (e.size ?? 0), 0))}`);
console.log(`  books.json        ${formatBytes(catalogSize)}`);
console.log(`  LFS verificado    ${lfsChecked ? 'sí' : 'no (sin archivos trackeados todavía)'}`);
if (pointersNotPulled > 0) {
  console.log(`  punteros sin bajar ${pointersNotPulled} (usa \`git lfs pull\` si los necesitas)`);
}

if (warnings.length > 0) {
  console.log(`\n${bold(`Avisos (${warnings.length}):`)}`);
  for (const w of warnings) console.log(`  ! ${w}`);
}

if (errors.length > 0) {
  console.log(`\n${bold(`Errores (${errors.length}):`)}`);
  for (const e of errors) console.log(`  x ${e}`);
  console.log('\nFalló la verificación.');
  process.exit(1);
}

console.log(`\nTodo correcto.${warnings.length > 0 ? ' (con avisos)' : ''}`);
