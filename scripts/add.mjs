#!/usr/bin/env node
// Alta interactiva de un titulo en el catalogo.
//
//   npm run add
//   npm run add -- --file "C:/Downloads/algun-libro.pdf"

import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import { parseArgs } from 'node:util';
import {
  ROOT, LIBRARY_DIR, loadCatalog, saveCatalog, loadTags, slugify,
  validateEntry, listLibraryFiles, absolutePathFor, formatBytes, TYPES, STATUSES,
} from './lib/catalog.mjs';

const { values } = parseArgs({
  options: {
    file: { type: 'string' },
    help: { type: 'boolean', short: 'h', default: false },
  },
});

if (values.help) {
  console.log('Uso: npm run add [-- --file <ruta al pdf/epub>]');
  process.exit(0);
}

const rl = readline.createInterface({ input, output });
const catalog = loadCatalog();
const tags = loadTags();

async function ask(question, fallback = '') {
  const suffix = fallback ? ` [${fallback}]` : '';
  const answer = (await rl.question(`${question}${suffix}: `)).trim();
  return answer || fallback;
}

async function askChoice(question, options, fallback) {
  while (true) {
    const answer = await ask(`${question} (${options.join(' / ')})`, fallback);
    if (options.includes(answer)) return answer;
    console.log(`  Opción inválida. Elige una de: ${options.join(', ')}`);
  }
}

/** Pide tags y los resuelve a canonicos, rechazando los desconocidos. */
async function askTags() {
  while (true) {
    const raw = await ask('Temas (separados por coma; "?" para ver la lista)');
    if (raw === '?') {
      console.log(`  ${tags.list().join(', ')}`);
      continue;
    }
    const parts = raw.split(',').map((s) => s.trim()).filter(Boolean);
    if (parts.length === 0) {
      console.log('  Necesitas al menos un tema.');
      continue;
    }
    const resolved = [];
    const unknown = [];
    for (const part of parts) {
      const canonical = tags.resolve(part);
      if (canonical === null) unknown.push(part);
      else if (!resolved.includes(canonical)) resolved.push(canonical);
    }
    if (unknown.length > 0) {
      console.log(`  Temas desconocidos: ${unknown.join(', ')}`);
      console.log('    Agrégalos a catalog/tags.json o escribe "?" para ver los disponibles.');
      continue;
    }
    return resolved;
  }
}

/** Busca archivos en library/ que aun no esten catalogados. */
function uncatalogedFiles() {
  const cataloged = new Set(catalog.map((e) => e.file));
  return listLibraryFiles().filter((f) => !cataloged.has(f));
}

async function resolveSourceFile() {
  if (values.file) return path.resolve(values.file);

  const pending = uncatalogedFiles();
  if (pending.length > 0) {
    console.log('\nArchivos en library/ sin catalogar:');
    pending.forEach((f, i) => console.log(`  ${i + 1}. ${f}`));
    const pick = await ask('Número del archivo, o ruta a uno nuevo (Enter para saltar)');
    if (!pick) return null;
    const index = Number(pick);
    if (Number.isInteger(index) && index >= 1 && index <= pending.length) {
      return absolutePathFor(pending[index - 1]);
    }
    return path.resolve(pick);
  }

  const answer = await ask('Ruta al archivo (PDF/EPUB), o Enter para registrarlo sin archivo todavía');
  return answer ? path.resolve(answer) : null;
}

// --- flujo --------------------------------------------------------------

try {
  console.log('Alta de un título. Enter acepta el valor entre corchetes.\n');

  const sourcePath = await resolveSourceFile();
  if (sourcePath && !fs.existsSync(sourcePath)) {
    console.error(`\nNo existe el archivo: ${sourcePath}`);
    process.exit(1);
  }

  const guessedTitle = sourcePath
    ? path.basename(sourcePath, path.extname(sourcePath)).replace(/[-_]+/g, ' ')
    : '';

  const title = await ask('Título', guessedTitle);
  if (!title) {
    console.error('El título es obligatorio.');
    process.exit(1);
  }

  const subtitle = await ask('Subtítulo (opcional)');
  const authorsRaw = await ask('Autores (separados por coma)');
  const authors = authorsRaw.split(',').map((s) => s.trim()).filter(Boolean);
  if (authors.length === 0) {
    console.error('Necesitas al menos un autor.');
    process.exit(1);
  }

  const yearRaw = await ask('Año (opcional)');
  const year = yearRaw ? Number(yearRaw) : null;

  const type = await askChoice('Tipo', TYPES, 'book');
  const publisher = await ask('Editorial (opcional)');
  const edition = await ask('Edición (opcional)');
  const language = await ask('Idioma', 'en');
  const entryTags = await askTags();
  const isbn = await ask('ISBN (opcional)');
  const doi = await ask('DOI (opcional)');
  const url = await ask('URL de la fuente oficial (opcional)');
  const pagesRaw = await ask('Páginas (opcional)');
  const status = await askChoice('Estado', STATUSES, 'unread');
  const ratingRaw = await ask('Rating 1-5 (opcional)');
  const notes = await ask('Notas (opcional)');

  const lastName = authors[0].split(/\s+/).pop();
  const suggestedId = slugify([title, lastName, year].filter(Boolean).join(' '));
  let id = await ask('ID (slug único)', suggestedId);
  id = slugify(id);
  if (catalog.some((e) => e.id === id)) {
    console.error(`\nYa existe una entrada con el id "${id}".`);
    process.exit(1);
  }

  // Mueve el archivo a library/<tipo>/<id>.<ext> con el nombre canonico.
  let relativeFile = null;
  let size = null;
  if (sourcePath) {
    const ext = path.extname(sourcePath).toLowerCase();
    const subdir = type === 'paper' ? 'papers' : 'books';
    const target = path.join(LIBRARY_DIR, subdir, `${id}${ext}`);
    relativeFile = path.relative(ROOT, target).split(path.sep).join('/');

    if (path.resolve(target) !== path.resolve(sourcePath)) {
      if (fs.existsSync(target)) {
        console.error(`\nYa existe un archivo en ${relativeFile}.`);
        process.exit(1);
      }
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.renameSync(sourcePath, target);
      console.log(`\n  Movido a ${relativeFile}`);
    }
    size = fs.statSync(target).size;
  }

  const entry = {
    id,
    type,
    title,
    subtitle: subtitle || null,
    authors,
    year: Number.isInteger(year) ? year : null,
    publisher: publisher || null,
    edition: edition || null,
    language: language || null,
    tags: entryTags,
    isbn: isbn || null,
    doi: doi || null,
    url: url || null,
    file: relativeFile,
    pages: pagesRaw ? Number(pagesRaw) : null,
    size,
    status,
    rating: ratingRaw ? Number(ratingRaw) : null,
    notes: notes || '',
    added: new Date().toISOString().slice(0, 10),
  };

  const problems = validateEntry(entry, tags, catalog.length);
  if (problems.length > 0) {
    console.error('\nLa entrada no es válida:');
    for (const p of problems) console.error(`    ${p}`);
    process.exit(1);
  }

  catalog.push(entry);
  saveCatalog(catalog);

  console.log(`\nAgregado: ${title}${year ? ` (${year})` : ''}`);
  if (size) console.log(`  ${relativeFile} · ${formatBytes(size)}`);
  console.log(`  ${catalog.length} títulos en el catálogo.`);
  console.log('\nAhora corre:  npm run build && npm run check');
} finally {
  rl.close();
}
