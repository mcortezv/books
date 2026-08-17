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
import { loadCatalog, loadTags, normalizeText, formatBytes, plural } from './lib/catalog.mjs';

const USAGE = `
  Uso   npm run search -- [terminos...] [opciones]

  Filtros
    --author <texto>    Por autor (repetible, acumulativo con AND)
    --tag <tag>         Por tema (repetible, acepta alias como "js")
    --type <tipo>       book | paper | thesis | spec
    --status <estado>   unread | reading | read | reference
    --lang <idioma>     en | es | ...
    --year <rango>      2020 | 2019..2024 | ..2010 | 2015..

  Salida
    --long              Vista detallada: rutas, editorial, notas, ISBN
    --paths             Solo las rutas, para git lfs pull --include=
    --json              JSON
    --limit <n>         Maximo de resultados
    --all               Todo el catalogo
    --tags              Lista los temas disponibles
    -h, --help          Esta ayuda

  Ejemplos
    npm run search -- clean code
    npm run search -- --author "martin fowler" --tag refactoring
    npm run search -- --tag rust --paths
`.replace(/^\n/, '').trimEnd();

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
    long: { type: 'boolean', short: 'l', default: false },
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
  const all = tags.list();
  const width = Math.max(...all.map((t) => t.length));
  const soft = process.stdout.isTTY && !process.env.NO_COLOR ? (s) => `\x1b[2m${s}\x1b[0m` : (s) => s;

  console.log('');
  for (const tag of all) {
    const n = counts.get(tag) ?? 0;
    console.log(`  ${tag.padEnd(width)}   ${String(n).padStart(3)}   ${soft(tags.label(tag))}`);
  }
  console.log(soft(`\n  ${all.length} temas definidos en catalog/tags.json\n`));
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
  console.log(`\n  ${plural(catalog.length, 'título')} en el catálogo. Usa --all para listarlos.\n`);
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
  else if (!values.paths) console.error('\n  Sin resultados.\n');
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

// --- presentacion -------------------------------------------------------

const styled = process.stdout.isTTY && !process.env.NO_COLOR;
const dim = (s) => (styled ? `\x1b[2m${s}\x1b[0m` : s);
const bold = (s) => (styled ? `\x1b[1m${s}\x1b[0m` : s);

const TYPE_LABEL = { book: 'libro', paper: 'paper', thesis: 'tesis', spec: 'spec' };

function truncate(text, max) {
  const s = String(text ?? '');
  return s.length <= max ? s : `${s.slice(0, max - 1)}…`;
}

const totalSize = results.reduce((sum, { entry }) => sum + (entry.size ?? 0), 0);
const footer = `${plural(results.length, 'resultado')} · ${formatBytes(totalSize)}`;

// Vista detallada: un registro por titulo, con todos los campos que tenga.
if (values.long) {
  console.log('');
  for (const { entry } of results) {
    const meta = [
      TYPE_LABEL[entry.type] ?? entry.type,
      entry.publisher,
      entry.edition,
      entry.language,
      entry.status,
      entry.rating ? `${entry.rating}/5` : null,
      entry.size ? formatBytes(entry.size) : null,
    ].filter(Boolean).join(' · ');

    console.log(`  ${bold(entry.title)}${entry.year ? dim(`  ${entry.year}`) : ''}`);
    if (entry.subtitle) console.log(`  ${dim(entry.subtitle)}`);
    console.log(`  ${(entry.authors ?? []).join(', ')}`);
    console.log(`  ${dim(meta)}`);
    if ((entry.tags ?? []).length > 0) console.log(`  ${dim((entry.tags).join(' · '))}`);
    if (entry.notes) console.log(`  ${dim(entry.notes)}`);
    if (entry.url) console.log(`  ${dim(entry.url)}`);
    console.log(`  ${dim(entry.file ?? 'sin archivo')}`);
    console.log('');
  }
  console.log(dim(`  ${footer}\n`));
  process.exit(0);
}

// Vista compacta por defecto: tabla alineada, sin rutas (usa --long o --paths).
const rows = results.map(({ entry }) => ({
  title: truncate(entry.title, 46),
  authors: truncate((entry.authors ?? []).join(', '), 26),
  year: entry.year ?? '—',
  tags: truncate((entry.tags ?? []).join(', '), 32),
}));

const COLUMNS = [
  ['title', 'título'],
  ['authors', 'autores'],
  ['year', 'año'],
  ['tags', 'temas'],
];

const w = Object.fromEntries(COLUMNS.map(([key, label]) => [
  key, Math.max(label.length, ...rows.map((r) => String(r[key]).length)),
]));

const line = (parts) => `  ${parts.join('   ')}`.trimEnd();

// La regla se acota al contenido real y al ancho de la terminal, para que no
// sobresalga de la tabla ni se parta en dos en ventanas angostas.
const contentWidth = Math.max(...rows.map((r) => (
  COLUMNS.reduce((sum, [key]) => sum + Math.max(w[key], String(r[key]).length), 0)
  + (COLUMNS.length - 1) * 3
)));
const ruleWidth = Math.min(contentWidth, (process.stdout.columns || 100) - 4);

console.log('');
console.log(dim(line(COLUMNS.map(([key, label]) => label.padEnd(w[key])))));
console.log(dim(`  ${'─'.repeat(Math.max(20, ruleWidth))}`));
for (const r of rows) {
  console.log(line([
    String(r.title).padEnd(w.title),
    dim(String(r.authors).padEnd(w.authors)),
    String(r.year).padStart(w.year),
    dim(String(r.tags)),
  ]));
}
console.log(dim(`\n  ${footer}${results.length > 0 ? ' · --long para ver rutas y detalles' : ''}\n`));
