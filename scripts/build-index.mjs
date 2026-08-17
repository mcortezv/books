#!/usr/bin/env node
// Regenera CATALOG.md, indices/*.md y el bloque de estadisticas del README
// a partir de catalog/books.json. Idempotente: correrlo dos veces no cambia nada.

import fs from 'node:fs';
import path from 'node:path';
import {
  ROOT, loadCatalog, loadTags, slugify, surnameKey, formatBytes,
} from './lib/catalog.mjs';

const GENERATED_NOTE = '<!-- Generado por `npm run build`. No editar a mano: los cambios se pierden. Fuente: catalog/books.json -->';

const TYPE_LABEL = { book: 'Libro', paper: 'Paper', thesis: 'Tesis', spec: 'Spec' };

/** Escapa lo que rompe una celda de tabla Markdown. */
const cell = (value) => String(value ?? '—').replace(/\|/g, '\\|').replace(/\n/g, ' ');

/** Link relativo al archivo, con el prefijo correcto segun donde vive el .md */
const fileLink = (entry, prefix = '') => (
  entry.file ? `[${(entry.file.split('.').pop() ?? 'file').toUpperCase()}](${prefix}${encodeURI(entry.file)})` : '—'
);

const byTitle = (a, b) => String(a.title).localeCompare(String(b.title), 'es');

const catalog = loadCatalog();
const tags = loadTags();

// --- CATALOG.md ---------------------------------------------------------

function buildCatalogMd() {
  const lines = [
    '# Catálogo completo',
    '',
    GENERATED_NOTE,
    '',
    `**${catalog.length}** título${catalog.length === 1 ? '' : 's'} · `
      + `${catalog.filter((e) => e.type === 'book').length} libros · `
      + `${catalog.filter((e) => e.type === 'paper').length} papers · `
      + `${formatBytes(catalog.reduce((s, e) => s + (e.size ?? 0), 0))}`,
    '',
    'Índices: [por autor](indices/por-autor.md) · [por tema](indices/por-tema.md) · [por año](indices/por-anio.md)',
    '',
  ];

  if (catalog.length === 0) {
    lines.push('_El catálogo está vacío. Agrega tu primer título con `npm run add`._', '');
    return lines.join('\n');
  }

  lines.push(
    '| Título | Autores | Año | Tipo | Temas | Archivo |',
    '| --- | --- | ---: | --- | --- | --- |',
  );
  for (const entry of [...catalog].sort(byTitle)) {
    const title = entry.subtitle ? `**${cell(entry.title)}**<br>${cell(entry.subtitle)}` : `**${cell(entry.title)}**`;
    lines.push([
      '',
      title,
      cell((entry.authors ?? []).join(', ')),
      cell(entry.year),
      TYPE_LABEL[entry.type] ?? cell(entry.type),
      (entry.tags ?? []).map((t) => `\`${t}\``).join(' ') || '—',
      fileLink(entry),
      '',
    ].join(' | ').trim());
  }
  lines.push('');
  return lines.join('\n');
}

// --- indices/por-autor.md -----------------------------------------------

function buildAuthorIndex() {
  const groups = new Map();
  for (const entry of catalog) {
    for (const author of entry.authors ?? []) {
      if (!groups.has(author)) groups.set(author, []);
      groups.get(author).push(entry);
    }
  }
  const authors = [...groups.keys()].sort((a, b) => surnameKey(a).localeCompare(surnameKey(b), 'es'));

  const lines = ['# Índice por autor', '', GENERATED_NOTE, '',
    `${authors.length} autor${authors.length === 1 ? '' : 'es'} · [volver al catálogo](../CATALOG.md)`, ''];

  if (authors.length === 0) {
    lines.push('_Sin entradas todavía._', '');
    return lines.join('\n');
  }

  for (const author of authors) {
    lines.push(`- [${author}](#${slugify(author)}) (${groups.get(author).length})`);
  }
  lines.push('');

  for (const author of authors) {
    lines.push(`## ${author}`, '');
    for (const entry of groups.get(author).sort(byTitle)) {
      lines.push(`- **${entry.title}**${entry.year ? ` (${entry.year})` : ''} — `
        + `${(entry.tags ?? []).map((t) => `\`${t}\``).join(' ')} — ${fileLink(entry, '../')}`);
    }
    lines.push('');
  }
  return lines.join('\n');
}

// --- indices/por-tema.md ------------------------------------------------

function buildTagIndex() {
  const groups = new Map();
  for (const entry of catalog) {
    for (const tag of entry.tags ?? []) {
      if (!groups.has(tag)) groups.set(tag, []);
      groups.get(tag).push(entry);
    }
  }
  // Ordenado por cantidad: los temas donde mas tienes aparecen primero.
  const ordered = [...groups.keys()].sort((a, b) => (
    groups.get(b).length - groups.get(a).length || a.localeCompare(b)
  ));

  const lines = ['# Índice por tema', '', GENERATED_NOTE, '',
    `${ordered.length} tema${ordered.length === 1 ? '' : 's'} · [volver al catálogo](../CATALOG.md)`, ''];

  if (ordered.length === 0) {
    lines.push('_Sin entradas todavía._', '');
    return lines.join('\n');
  }

  for (const tag of ordered) {
    lines.push(`- [${tags.label(tag)}](#${slugify(tags.label(tag))}) (${groups.get(tag).length})`);
  }
  lines.push('');

  for (const tag of ordered) {
    lines.push(`## ${tags.label(tag)}`, '', `\`${tag}\``, '');
    for (const entry of groups.get(tag).sort(byTitle)) {
      lines.push(`- **${entry.title}** — ${(entry.authors ?? []).join(', ')}`
        + `${entry.year ? ` (${entry.year})` : ''} — ${fileLink(entry, '../')}`);
    }
    lines.push('');
  }
  return lines.join('\n');
}

// --- indices/por-anio.md ------------------------------------------------

function buildYearIndex() {
  const groups = new Map();
  for (const entry of catalog) {
    const year = typeof entry.year === 'number' ? entry.year : 'Sin año';
    if (!groups.has(year)) groups.set(year, []);
    groups.get(year).push(entry);
  }
  const years = [...groups.keys()].sort((a, b) => {
    if (typeof a !== 'number') return 1;
    if (typeof b !== 'number') return -1;
    return b - a;
  });

  const lines = ['# Índice por año', '', GENERATED_NOTE, '', '[volver al catálogo](../CATALOG.md)', ''];

  if (years.length === 0) {
    lines.push('_Sin entradas todavía._', '');
    return lines.join('\n');
  }

  for (const year of years) {
    lines.push(`## ${year}`, '');
    for (const entry of groups.get(year).sort(byTitle)) {
      lines.push(`- **${entry.title}** — ${(entry.authors ?? []).join(', ')} — `
        + `${(entry.tags ?? []).map((t) => `\`${t}\``).join(' ')} — ${fileLink(entry, '../')}`);
    }
    lines.push('');
  }
  return lines.join('\n');
}

// --- bloque de stats del README -----------------------------------------

function buildStatsBlock() {
  const total = catalog.length;
  const books = catalog.filter((e) => e.type === 'book').length;
  const papers = catalog.filter((e) => e.type === 'paper').length;
  const others = total - books - papers;
  const size = catalog.reduce((s, e) => s + (e.size ?? 0), 0);

  const tagCounts = new Map();
  for (const entry of catalog) {
    for (const tag of entry.tags ?? []) tagCounts.set(tag, (tagCounts.get(tag) ?? 0) + 1);
  }
  const topTags = [...tagCounts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 10);

  const lines = [
    `| | |`,
    `| --- | ---: |`,
    `| Títulos | **${total}** |`,
    `| Libros | ${books} |`,
    `| Papers | ${papers} |`,
  ];
  if (others > 0) lines.push(`| Otros (tesis, specs) | ${others} |`);
  lines.push(`| Peso total | ${formatBytes(size)} |`);
  lines.push('');

  if (topTags.length > 0) {
    lines.push('**Temas con más material:**', '');
    lines.push(topTags.map(([tag, n]) => `\`${tag}\` ${n}`).join(' · '));
    lines.push('');
  }

  const recent = [...catalog]
    .filter((e) => e.added)
    .sort((a, b) => String(b.added).localeCompare(String(a.added)))
    .slice(0, 5);
  if (recent.length > 0) {
    lines.push('**Últimos agregados:**', '');
    for (const entry of recent) {
      lines.push(`- ${entry.title}${entry.year ? ` (${entry.year})` : ''} — _${entry.added}_`);
    }
    lines.push('');
  }

  return lines.join('\n').trimEnd();
}

function updateReadmeStats() {
  const readmePath = path.join(ROOT, 'README.md');
  if (!fs.existsSync(readmePath)) return false;
  const readme = fs.readFileSync(readmePath, 'utf8');
  const pattern = /(<!-- BEGIN:stats -->)[\s\S]*?(<!-- END:stats -->)/;
  if (!pattern.test(readme)) {
    console.warn('  ! README.md no tiene los marcadores <!-- BEGIN:stats --> / <!-- END:stats -->; se omite.');
    return false;
  }
  const updated = readme.replace(pattern, `$1\n\n${buildStatsBlock()}\n\n$2`);
  return writeIfChanged(readmePath, updated);
}

// --- escritura ----------------------------------------------------------

let changed = 0;

function writeIfChanged(absPath, content) {
  const normalized = content.endsWith('\n') ? content : `${content}\n`;
  const existing = fs.existsSync(absPath) ? fs.readFileSync(absPath, 'utf8') : null;
  if (existing === normalized) return false;
  fs.mkdirSync(path.dirname(absPath), { recursive: true });
  fs.writeFileSync(absPath, normalized, 'utf8');
  changed += 1;
  console.log(`  ~ ${path.relative(ROOT, absPath).split(path.sep).join('/')}`);
  return true;
}

console.log(`Generando índices desde ${catalog.length} entrada(s)...`);
writeIfChanged(path.join(ROOT, 'CATALOG.md'), buildCatalogMd());
writeIfChanged(path.join(ROOT, 'indices', 'por-autor.md'), buildAuthorIndex());
writeIfChanged(path.join(ROOT, 'indices', 'por-tema.md'), buildTagIndex());
writeIfChanged(path.join(ROOT, 'indices', 'por-anio.md'), buildYearIndex());
updateReadmeStats();

console.log(changed === 0 ? 'Todo al día, nada que regenerar.' : `Listo: ${changed} archivo(s) actualizado(s).`);
