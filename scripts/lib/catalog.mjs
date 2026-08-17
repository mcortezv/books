// Modulo compartido del catalogo: carga, validacion, normalizacion y
// serializacion determinista. Sin dependencias externas.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(fileURLToPath(import.meta.url), '../../..');
export const CATALOG_PATH = path.join(ROOT, 'catalog', 'books.json');
export const TAGS_PATH = path.join(ROOT, 'catalog', 'tags.json');
export const LIBRARY_DIR = path.join(ROOT, 'library');

// Orden fijo de claves: garantiza que el diff de agregar un libro sea local
// y no un reordenamiento del archivo completo.
export const FIELD_ORDER = [
  'id', 'type', 'title', 'subtitle', 'authors', 'year', 'publisher', 'edition',
  'language', 'tags', 'isbn', 'doi', 'url', 'file', 'pages', 'size',
  'status', 'rating', 'notes', 'added',
];

export const REQUIRED_FIELDS = ['id', 'type', 'title', 'authors', 'tags', 'file'];

export const TYPES = ['book', 'paper', 'thesis', 'spec'];
export const STATUSES = ['unread', 'reading', 'read', 'reference'];

export const LFS_POINTER_PREFIX = 'version https://git-lfs.github.com/spec/v1';

// --- utilidades de texto ------------------------------------------------

/** Minusculas y sin acentos, para que "Martin" haga match con "martín". */
export function normalizeText(value) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();
}

export function slugify(value) {
  return normalizeText(value)
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

/** Replica el anchor que GitHub genera para un encabezado. A diferencia de
 *  slugify, CONSERVA los acentos: GitHub convierte "## Programación funcional"
 *  en "#programación-funcional", asi que quitarlos rompe el link. */
export function githubAnchor(heading) {
  return String(heading ?? '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s_-]/gu, '')
    .trim()
    .replace(/\s+/g, '-');
}

/** "Robert C. Martin" -> "martin robert c", para ordenar por apellido. */
export function surnameKey(author) {
  const parts = normalizeText(author).trim().split(/\s+/);
  if (parts.length < 2) return parts.join(' ');
  return [parts[parts.length - 1], ...parts.slice(0, -1)].join(' ');
}

export function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return '—';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0;
  let n = bytes;
  while (n >= 1024 && i < units.length - 1) { n /= 1024; i += 1; }
  return `${n < 10 && i > 0 ? n.toFixed(1) : Math.round(n)} ${units[i]}`;
}

/** Pluraliza en español: plural(1, 'título') -> "1 título". */
export function plural(count, singular, pluralForm = `${singular}s`) {
  return `${count} ${count === 1 ? singular : pluralForm}`;
}

// --- tags ---------------------------------------------------------------

export function loadTags() {
  const raw = JSON.parse(fs.readFileSync(TAGS_PATH, 'utf8'));
  const canonical = raw.tags ?? {};
  const aliasMap = new Map();
  for (const [key, meta] of Object.entries(canonical)) {
    aliasMap.set(key, key);
    for (const alias of meta.aliases ?? []) aliasMap.set(normalizeText(alias), key);
  }
  return {
    canonical,
    /** Devuelve el tag canonico, o null si es desconocido. */
    resolve(tag) {
      return aliasMap.get(normalizeText(tag)) ?? null;
    },
    label(tag) {
      return canonical[tag]?.label ?? tag;
    },
    list() {
      return Object.keys(canonical).sort();
    },
  };
}

// --- catalogo -----------------------------------------------------------

export function loadCatalog() {
  if (!fs.existsSync(CATALOG_PATH)) return [];
  const text = fs.readFileSync(CATALOG_PATH, 'utf8').trim();
  if (!text) return [];
  const data = JSON.parse(text);
  if (!Array.isArray(data)) {
    throw new Error('catalog/books.json debe ser un array de entradas.');
  }
  return data;
}

function stringifyValue(value) {
  if (Array.isArray(value)) {
    return `[${value.map((v) => JSON.stringify(v)).join(', ')}]`;
  }
  return JSON.stringify(value);
}

/** Serializacion determinista: array ordenado por id, claves en FIELD_ORDER,
 *  arrays cortos en una sola linea. */
export function serializeCatalog(entries) {
  const sorted = [...entries].sort((a, b) => String(a.id).localeCompare(String(b.id)));
  if (sorted.length === 0) return '[]\n';

  const blocks = sorted.map((entry) => {
    const keys = [
      ...FIELD_ORDER.filter((k) => k in entry),
      ...Object.keys(entry).filter((k) => !FIELD_ORDER.includes(k)).sort(),
    ];
    const lines = keys.map((k) => `    ${JSON.stringify(k)}: ${stringifyValue(entry[k])}`);
    return `  {\n${lines.join(',\n')}\n  }`;
  });

  return `[\n${blocks.join(',\n')}\n]\n`;
}

export function saveCatalog(entries) {
  fs.mkdirSync(path.dirname(CATALOG_PATH), { recursive: true });
  fs.writeFileSync(CATALOG_PATH, serializeCatalog(entries), 'utf8');
}

// --- validacion ---------------------------------------------------------

/** Devuelve un array de mensajes de error. Vacio = entrada valida. */
export function validateEntry(entry, tags, index) {
  const errors = [];
  const where = entry?.id ? `[${entry.id}]` : `[entrada #${index}]`;

  if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) {
    return [`${where} no es un objeto.`];
  }

  for (const field of REQUIRED_FIELDS) {
    const value = entry[field];
    const empty = value === undefined || value === null || value === ''
      || (Array.isArray(value) && value.length === 0);
    if (empty) errors.push(`${where} falta el campo obligatorio "${field}".`);
  }

  if (entry.id && entry.id !== slugify(entry.id)) {
    errors.push(`${where} el id debe ser un slug (minusculas, guiones): esperaba "${slugify(entry.id)}".`);
  }
  if (entry.type && !TYPES.includes(entry.type)) {
    errors.push(`${where} type "${entry.type}" invalido. Opciones: ${TYPES.join(', ')}.`);
  }
  if (entry.status != null && !STATUSES.includes(entry.status)) {
    errors.push(`${where} status "${entry.status}" invalido. Opciones: ${STATUSES.join(', ')}.`);
  }
  if (entry.authors != null && !Array.isArray(entry.authors)) {
    errors.push(`${where} "authors" debe ser un array de strings.`);
  }
  if (entry.tags != null && !Array.isArray(entry.tags)) {
    errors.push(`${where} "tags" debe ser un array de strings.`);
  }
  if (entry.year != null && (!Number.isInteger(entry.year) || entry.year < 1900 || entry.year > 2100)) {
    errors.push(`${where} "year" debe ser un entero entre 1900 y 2100.`);
  }
  if (entry.rating != null && (!Number.isInteger(entry.rating) || entry.rating < 1 || entry.rating > 5)) {
    errors.push(`${where} "rating" debe ser un entero de 1 a 5, o null.`);
  }
  if (entry.file && !String(entry.file).startsWith('library/')) {
    errors.push(`${where} "file" debe empezar con "library/". Recibido: "${entry.file}".`);
  }
  if (entry.file && String(entry.file).includes('\\')) {
    errors.push(`${where} "file" debe usar "/" como separador, no "\\".`);
  }

  for (const tag of Array.isArray(entry.tags) ? entry.tags : []) {
    const canonical = tags.resolve(tag);
    if (canonical === null) {
      errors.push(`${where} tag desconocido "${tag}". Agregalo a catalog/tags.json o usa uno existente.`);
    } else if (canonical !== tag) {
      errors.push(`${where} tag "${tag}" es un alias; usa el canonico "${canonical}".`);
    }
  }

  return errors;
}

// --- archivos -----------------------------------------------------------

/** Lista todos los archivos bajo library/, con ruta relativa estilo posix. */
export function listLibraryFiles() {
  const found = [];
  const walk = (dir) => {
    if (!fs.existsSync(dir)) return;
    for (const item of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, item.name);
      if (item.isDirectory()) { walk(full); continue; }
      if (item.name === '.gitkeep') continue;
      found.push(path.relative(ROOT, full).split(path.sep).join('/'));
    }
  };
  walk(LIBRARY_DIR);
  return found.sort();
}

export function absolutePathFor(relativeFile) {
  return path.join(ROOT, relativeFile.split('/').join(path.sep));
}

/** true si el archivo en disco es un puntero LFS sin materializar (caso CI). */
export function isLfsPointer(absPath) {
  try {
    const stat = fs.statSync(absPath);
    if (stat.size > 1024) return false;
    const head = fs.readFileSync(absPath, 'utf8').slice(0, LFS_POINTER_PREFIX.length);
    return head === LFS_POINTER_PREFIX;
  } catch {
    return false;
  }
}
