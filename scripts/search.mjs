#!/usr/bin/env node
// Buscador CLI del catalogo. Busca sobre metadata (titulo, subtitulo, autores,
// tags, editorial, notas). Sin dependencias externas.
//
//   npm run search -- rust
//   npm run search -- --author fowler
//   npm run search -- --tag testing --tag tdd
//   npm run search -- --year 2019..2024 --type paper
//   npm run search -- --tag rust --paths

import { parseArgs } from 'node:util';
import { loadCatalog, loadTags, normalizeText, formatBytes } from './lib/catalog.mjs';

const USAGE = `
Uso: npm run search -- [terminos...] [opciones]

Opciones:
  --author <texto>   Filtra por autor (repetible, acumulativo con AND)
  --tag <tag>        Filtra por tema (repetible, acepta alias como "js")
  --type <tipo>      book | paper | thesis | spec
  --status <estado>  unread | reading | read | reference
  --lang <idioma>    en | es | ...
  --year <rango>     2020 | 2019..2024 | ..2010 | 2015..
  --limit <n>        Maximo de resultados (default: todos)
  --paths            Imprime solo las rutas (para git lfs pull --include=)
  --json             Salida JSON
  --tags             Lista los temas disponibles y sale
  --all              Lista todo el catalogo
  -h, --help         Esta ayuda

Ejemplos:
  npm run search -- clean code
  npm run search -- --author "martin fowler" --tag refactoring
  npm run search -- --tag rust --paths
`.trim();

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    author: { type: 'string', multiple: true, default: [] },
    tag: { type: 'string', multiple: true, default: [] },
    type: { type: 'string' },
    status: { type: 'string' },
    lang: { type: 'string' },
    year: { type: 'string' },
    limit: { type: 'string' },
    paths: { type: 'boolean', default: false },
    json: { type: 'boolean', default: false },
    tags: { type: 'boolean', default: false },
    all: { type: 'boolean', default: false },
    help: { type: 'boolean', short: 'h', default: false },
  },
});

if (values.help) {
  console.log(USAGE);
  process.exit(0);
}

const tags = loadTags();

if (values.tags) {
  const catalog = loadCatalog();
  const counts = new Map();
  for (const entry of catalog) {
    for (const tag of entry.tags ?? []) counts.set(tag, (counts.get(tag) ?? 0) + 1);
  }
  for (const tag of tags.list()) {
    const n = counts.get(tag) ?? 0;
    console.log(`${tag.padEnd(24)} ${String(n).padStart(4)}  ${tags.label(tag)}`);
  }
  process.exit(0);
}

// --- filtros ------------------------------------------------------------

function parseYearRange(spec) {
  if (!spec) return null;
  const range = spec.match(/^(\d{4})?\.\.(\d{4})?$/);
  if (range) {
    return { from: range[1] ? Number(range[1]) : -Infinity, to: range[2] ? Number(range[2]) : Infinity };
  }
  if (/^\d{4}$/.test(spec)) return { from: Number(spec), to: Number(spec) };
  console.error(`Rango de anio invalido: "${spec}". Usa 2020, 2019..2024, ..2010 o 2015..`);
  process.exit(2);
}

const yearRange = parseYearRange(values.year);

// Los tags del filtro se resuelven a canonicos, asi `--tag js` encuentra javascript.
const wantedTags = values.tag.map((t) => {
  const canonical = tags.resolve(t);
  if (canonical === null) {
    console.error(`Tag desconocido: "${t}". Corre \`npm run search -- --tags\` para ver la lista.`);
    process.exit(2);
  }
  return canonical;
});

const wantedAuthors = values.author.map(normalizeText);
const terms = positionals.map(normalizeText).filter(Boolean);

function passesFilters(entry) {
  if (values.type && entry.type !== values.type) return false;
  if (values.status && entry.status !== values.status) return false;
  if (values.lang && entry.language !== values.lang) return false;
  if (yearRange) {
    if (typeof entry.year !== 'number') return false;
    if (entry.year < yearRange.from || entry.year > yearRange.to) return false;
  }
  for (const tag of wantedTags) {
    if (!(entry.tags ?? []).includes(tag)) return false;
  }
  for (const author of wantedAuthors) {
    const hit = (entry.authors ?? []).some((a) => normalizeText(a).includes(author));
    if (!hit) return false;
  }
  return true;
}

// --- scoring ------------------------------------------------------------

// El titulo pesa mas que las notas: buscar "rust" debe traer primero
// "The Rust Programming Language" y no un libro que lo menciona al pasar.
const WEIGHTS = [
  ['title', 10],
  ['authors', 8],
  ['tags', 7],
  ['subtitle', 6],
  ['id', 4],
  ['publisher', 3],
  ['notes', 2],
];

function haystack(entry, field) {
  const value = entry[field];
  if (Array.isArray(value)) return normalizeText(value.join(' '));
  return normalizeText(value);
}

/** Devuelve el score, o null si algun termino no aparece en ningun campo. */
function scoreEntry(entry) {
  if (terms.length === 0) return 0;
  let score = 0;
  for (const term of terms) {
    let termScore = 0;
    for (const [field, weight] of WEIGHTS) {
      const text = haystack(entry, field);
      if (!text.includes(term)) continue;
      // Match de palabra completa vale mas que match parcial.
      const exact = new RegExp(`(^|[^a-z0-9])${term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^a-z0-9]|$)`).test(text);
      termScore = Math.max(termScore, exact ? weight * 2 : weight);
    }
    if (termScore === 0) return null; // AND: todos los terminos deben aparecer
    score += termScore;
  }
  return score;
}

// --- ejecucion ----------------------------------------------------------

const catalog = loadCatalog();
const hasQuery = terms.length > 0 || wantedTags.length > 0 || wantedAuthors.length > 0
  || values.type || values.status || values.lang || values.year;

if (!hasQuery && !values.all) {
  console.log(USAGE);
  console.log(`\n(${catalog.length} titulos en el catalogo. Usa --all para listarlos todos.)`);
  process.exit(0);
}

let results = [];
for (const entry of catalog) {
  if (!passesFilters(entry)) continue;
  const score = scoreEntry(entry);
  if (score === null) continue;
  results.push({ entry, score });
}

results.sort((a, b) => (
  b.score - a.score
  || String(a.entry.title).localeCompare(String(b.entry.title))
));

if (values.limit) results = results.slice(0, Number(values.limit));

if (results.length === 0) {
  if (values.json) console.log('[]');
  else if (!values.paths) console.error('Sin resultados.');
  process.exit(1);
}

if (values.json) {
  console.log(JSON.stringify(results.map((r) => r.entry), null, 2));
  process.exit(0);
}

if (values.paths) {
  for (const { entry } of results) console.log(entry.file);
  process.exit(0);
}

// --- tabla --------------------------------------------------------------

const color = process.stdout.isTTY && !process.env.NO_COLOR;
const bold = (s) => (color ? `\x1b[1m${s}\x1b[0m` : s);
const dim = (s) => (color ? `\x1b[2m${s}\x1b[0m` : s);

const ICON = { book: 'LIB', paper: 'PAP', thesis: 'TES', spec: 'SPE' };

function truncate(text, max) {
  const s = String(text ?? '');
  return s.length <= max ? s : `${s.slice(0, max - 1)}…`;
}

const rows = results.map(({ entry }) => ({
  type: ICON[entry.type] ?? '???',
  title: truncate(entry.title, 44),
  authors: truncate((entry.authors ?? []).join(', '), 28),
  year: entry.year ?? '—',
  tags: truncate((entry.tags ?? []).join(' '), 30),
  file: entry.file,
}));

const width = (key, header) => Math.max(header.length, ...rows.map((r) => String(r[key]).length));
const w = {
  type: width('type', 'TIPO'),
  title: width('title', 'TITULO'),
  authors: width('authors', 'AUTORES'),
  year: width('year', 'ANIO'),
  tags: width('tags', 'TEMAS'),
};

console.log(bold(
  `${'TIPO'.padEnd(w.type)}  ${'TITULO'.padEnd(w.title)}  ${'AUTORES'.padEnd(w.authors)}  ${'ANIO'.padEnd(w.year)}  ${'TEMAS'.padEnd(w.tags)}`,
));

for (const r of rows) {
  console.log(
    `${dim(String(r.type).padEnd(w.type))}  ${String(r.title).padEnd(w.title)}  `
    + `${dim(String(r.authors).padEnd(w.authors))}  ${String(r.year).padEnd(w.year)}  ${dim(String(r.tags).padEnd(w.tags))}`,
  );
  console.log(`  ${dim(r.file)}`);
}

const totalSize = results.reduce((sum, { entry }) => sum + (entry.size ?? 0), 0);
console.log(dim(`\n${results.length} resultado${results.length === 1 ? '' : 's'} · ${formatBytes(totalSize)}`));
