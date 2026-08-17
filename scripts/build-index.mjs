#!/usr/bin/env node
// Regenera CATALOG.md, indices/*.md y el bloque de estadisticas del README
// a partir de catalog/books.json. Idempotente: correrlo dos veces no cambia nada.

import fs from 'node:fs';
import path from 'node:path';
import {
  ROOT, loadCatalog, loadTags, githubAnchor, surnameKey, formatBytes, plural,
} from './lib/catalog.mjs';

const GENERATED_NOTE = '<!-- Generado por `npm run build`. No editar a mano: los cambios se pierden. Fuente: catalog/books.json -->';

const TYPE_LABEL = { book: 'Libro', paper: 'Paper', thesis: 'Tesis', spec: 'Spec' };

const catalog = loadCatalog();
const tags = loadTags();

// --- helpers de formato -------------------------------------------------

/** Escapa lo que rompe una celda de tabla Markdown. */
const cell = (value) => String(value ?? '—').replace(/\|/g, '\\|').replace(/\n/g, ' ');

/** El titulo ES el link al archivo: una columna menos y menos ruido visual. */
function titleCell(entry, prefix = '') {
  const title = cell(entry.title);
  const linked = entry.file ? `[${title}](${prefix}${encodeURI(entry.file)})` : title;
  return entry.subtitle ? `${linked}<br><sub>${cell(entry.subtitle)}</sub>` : linked;
}

const tagList = (entry) => ((entry.tags ?? []).join(', ') || '—');
const authorList = (entry) => (cell((entry.authors ?? []).join(', ')));

const byTitle = (a, b) => String(a.title).localeCompare(String(b.title), 'es');

/** Linea de navegacion inline: mas compacta que una lista de 200 vinetas. */
function navLine(items) {
  return items.map(({ label, count }) => `[${label}](#${githubAnchor(label)}) ${count}`).join(' · ');
}

/** Tabla de titulos reutilizada por los tres indices. */
function entryTable(entries, columns, prefix) {
  const headers = { title: 'Título', authors: 'Autores', year: 'Año', tags: 'Temas', type: 'Tipo' };
  const aligns = { title: '---', authors: '---', year: '---:', tags: '---', type: '---' };
  const render = {
    title: (e) => titleCell(e, prefix),
    authors: authorList,
    year: (e) => cell(e.year),
    tags: tagList,
    type: (e) => TYPE_LABEL[e.type] ?? cell(e.type),
  };

  const lines = [
    `| ${columns.map((c) => headers[c]).join(' | ')} |`,
    `| ${columns.map((c) => aligns[c]).join(' | ')} |`,
  ];
  for (const entry of [...entries].sort(byTitle)) {
    lines.push(`| ${columns.map((c) => render[c](entry)).join(' | ')} |`);
  }
  return lines;
}

/** Resumen de la coleccion, en una sola linea. */
function summaryLine() {
  const books = catalog.filter((e) => e.type === 'book').length;
  const papers = catalog.filter((e) => e.type === 'paper').length;
  const others = catalog.length - books - papers;
  const size = catalog.reduce((s, e) => s + (e.size ?? 0), 0);

  const parts = [plural(catalog.length, 'título')];
  if (books > 0) parts.push(plural(books, 'libro'));
  if (papers > 0) parts.push(plural(papers, 'paper'));
  if (others > 0) parts.push(plural(others, 'otro'));
  if (size > 0) parts.push(formatBytes(size));
  return parts.join(' · ');
}

/** Encabezado comun: nota de generado, titulo, resumen y navegacion. */
function header(title, subtitle, links) {
  return [GENERATED_NOTE, '', `# ${title}`, '', subtitle, '', links, ''];
}

// --- CATALOG.md ---------------------------------------------------------

function buildCatalogMd() {
  const lines = header(
    'Catálogo',
    summaryLine(),
    '[Por autor](indices/por-autor.md) · [Por tema](indices/por-tema.md) · [Por año](indices/por-anio.md)',
  );

  if (catalog.length === 0) {
    lines.push('El catálogo está vacío. Agrega tu primer título con `npm run add`.', '');
    return lines.join('\n');
  }

  lines.push(...entryTable(catalog, ['title', 'authors', 'year', 'type', 'tags'], ''), '');
  return lines.join('\n');
}

// --- indices ------------------------------------------------------------

/** Agrupa el catalogo por una clave multivaluada (autores, tags) o simple. */
function groupBy(keyFn) {
  const groups = new Map();
  for (const entry of catalog) {
    for (const key of keyFn(entry)) {
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(entry);
    }
  }
  return groups;
}

function buildAuthorIndex() {
  const groups = groupBy((e) => e.authors ?? []);
  const authors = [...groups.keys()].sort((a, b) => surnameKey(a).localeCompare(surnameKey(b), 'es'));

  const lines = header(
    'Por autor',
    plural(authors.length, 'autor', 'autores'),
    '[Catálogo](../CATALOG.md) · [Por tema](por-tema.md) · [Por año](por-anio.md)',
  );

  if (authors.length === 0) {
    lines.push('Sin entradas todavía.', '');
    return lines.join('\n');
  }

  lines.push(navLine(authors.map((a) => ({ label: a, count: groups.get(a).length }))), '');
  for (const author of authors) {
    lines.push(`## ${author}`, '', ...entryTable(groups.get(author), ['title', 'year', 'tags'], '../'), '');
  }
  return lines.join('\n');
}

function buildTagIndex() {
  const groups = groupBy((e) => e.tags ?? []);
  // Ordenado por cantidad: los temas donde mas material tienes van primero.
  const ordered = [...groups.keys()].sort((a, b) => (
    groups.get(b).length - groups.get(a).length || a.localeCompare(b)
  ));

  const lines = header(
    'Por tema',
    plural(ordered.length, 'tema'),
    '[Catálogo](../CATALOG.md) · [Por autor](por-autor.md) · [Por año](por-anio.md)',
  );

  if (ordered.length === 0) {
    lines.push('Sin entradas todavía.', '');
    return lines.join('\n');
  }

  lines.push(navLine(ordered.map((t) => ({ label: tags.label(t), count: groups.get(t).length }))), '');
  for (const tag of ordered) {
    lines.push(
      `## ${tags.label(tag)}`, '', `\`${tag}\``, '',
      ...entryTable(groups.get(tag), ['title', 'authors', 'year'], '../'), '',
    );
  }
  return lines.join('\n');
}

function buildYearIndex() {
  const groups = groupBy((e) => [typeof e.year === 'number' ? e.year : 'Sin año']);
  const years = [...groups.keys()].sort((a, b) => {
    if (typeof a !== 'number') return 1;
    if (typeof b !== 'number') return -1;
    return b - a;
  });

  const lines = header(
    'Por año',
    years.length === 0 ? '' : plural(years.length, 'año'),
    '[Catálogo](../CATALOG.md) · [Por autor](por-autor.md) · [Por tema](por-tema.md)',
  );

  if (years.length === 0) {
    lines.push('Sin entradas todavía.', '');
    return lines.join('\n');
  }

  lines.push(navLine(years.map((y) => ({ label: String(y), count: groups.get(y).length }))), '');
  for (const year of years) {
    lines.push(`## ${year}`, '', ...entryTable(groups.get(year), ['title', 'authors', 'tags'], '../'), '');
  }
  return lines.join('\n');
}

// --- bloque de stats del README -----------------------------------------

function buildStatsBlock() {
  if (catalog.length === 0) {
    return 'El catálogo está vacío. Agrega tu primer título con `npm run add`.';
  }

  const lines = [summaryLine(), ''];

  const tagCounts = new Map();
  for (const entry of catalog) {
    for (const tag of entry.tags ?? []) tagCounts.set(tag, (tagCounts.get(tag) ?? 0) + 1);
  }
  const topTags = [...tagCounts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 10);

  if (topTags.length > 0) {
    lines.push('**Temas con más material**  ', topTags.map(([tag, n]) => `${tag} ${n}`).join(' · '), '');
  }

  const recent = [...catalog]
    .filter((e) => e.added)
    .sort((a, b) => String(b.added).localeCompare(String(a.added)))
    .slice(0, 5);
  if (recent.length > 0) {
    lines.push('**Últimos agregados**  ');
    lines.push(recent.map((e) => `${e.title}${e.year ? ` (${e.year})` : ''}`).join(' · '), '');
  }

  return lines.join('\n').trimEnd();
}

function updateReadmeStats() {
  const readmePath = path.join(ROOT, 'README.md');
  if (!fs.existsSync(readmePath)) return false;
  const readme = fs.readFileSync(readmePath, 'utf8');
  const pattern = /(<!-- BEGIN:stats -->)[\s\S]*?(<!-- END:stats -->)/;
  if (!pattern.test(readme)) {
    console.warn('  aviso  README.md no tiene los marcadores BEGIN:stats / END:stats; se omite.');
    return false;
  }
  return writeIfChanged(readmePath, readme.replace(pattern, `$1\n\n${buildStatsBlock()}\n\n$2`));
}

// --- escritura ----------------------------------------------------------

const updated = [];

function writeIfChanged(absPath, content) {
  const normalized = content.endsWith('\n') ? content : `${content}\n`;
  const existing = fs.existsSync(absPath) ? fs.readFileSync(absPath, 'utf8') : null;
  if (existing === normalized) return false;
  fs.mkdirSync(path.dirname(absPath), { recursive: true });
  fs.writeFileSync(absPath, normalized, 'utf8');
  updated.push(path.relative(ROOT, absPath).split(path.sep).join('/'));
  return true;
}

const styled = process.stdout.isTTY && !process.env.NO_COLOR;
const dim = (s) => (styled ? `\x1b[2m${s}\x1b[0m` : s);

writeIfChanged(path.join(ROOT, 'CATALOG.md'), buildCatalogMd());
writeIfChanged(path.join(ROOT, 'indices', 'por-autor.md'), buildAuthorIndex());
writeIfChanged(path.join(ROOT, 'indices', 'por-tema.md'), buildTagIndex());
writeIfChanged(path.join(ROOT, 'indices', 'por-anio.md'), buildYearIndex());
updateReadmeStats();

console.log(`\n  Índices generados desde ${plural(catalog.length, 'entrada')}\n`);
if (updated.length === 0) {
  console.log(dim('  Todo al día, nada que regenerar.\n'));
} else {
  for (const file of updated) console.log(`  ${dim('actualizado')}  ${file}`);
  console.log(dim(`\n  ${plural(updated.length, 'archivo')} escrito${updated.length === 1 ? '' : 's'}.\n`));
}
