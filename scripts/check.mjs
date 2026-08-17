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

const styled = process.stdout.isTTY && !process.env.NO_COLOR;
const dim = (s) => (styled ? `\x1b[2m${s}\x1b[0m` : s);
const bold = (s) => (styled ? `\x1b[1m${s}\x1b[0m` : s);

const stats = [
  ['entradas', String(catalog.length)],
  ['archivos en library/', String(listLibraryFiles().length)],
  ['peso catalogado', formatBytes(catalog.reduce((s, e) => s + (e.size ?? 0), 0))],
  ['catalog/books.json', formatBytes(catalogSize)],
  ['integridad LFS', lfsChecked ? 'verificada' : 'sin archivos trackeados todavía'],
];
if (pointersNotPulled > 0) {
  stats.push(['punteros sin descargar', `${pointersNotPulled} · usa git lfs pull`]);
}

const labelWidth = Math.max(...stats.map(([label]) => label.length));

console.log('');
for (const [label, value] of stats) {
  console.log(`  ${dim(label.padEnd(labelWidth))}   ${value}`);
}

/** Envuelve mensajes largos manteniendo la sangria del bloque. */
function wrap(text, indent) {
  const width = Math.max(40, (process.stdout.columns || 100) - indent.length - 2);
  const lines = [];
  let current = '';
  for (const word of String(text).split(/\s+/)) {
    if (current && `${current} ${word}`.length > width) {
      lines.push(current);
      current = word;
    } else {
      current = current ? `${current} ${word}` : word;
    }
  }
  if (current) lines.push(current);
  return lines.map((l, i) => (i === 0 ? `${indent}${l}` : `${indent}  ${l}`)).join('\n');
}

if (warnings.length > 0) {
  console.log(`\n  ${bold(`Avisos (${warnings.length})`)}\n`);
  for (const w of warnings) console.log(dim(wrap(w, '    ')));
}

if (errors.length > 0) {
  console.log(`\n  ${bold(`Errores (${errors.length})`)}\n`);
  for (const e of errors) console.log(wrap(e, '    '));
  console.log(`\n  ${bold('Falló la verificación.')}\n`);
  process.exit(1);
}

console.log(`\n  ${bold('Todo correcto.')}${warnings.length > 0 ? dim(' Revisa los avisos de arriba.') : ''}\n`);
