#!/usr/bin/env node
// Instala el hook pre-commit que impide commitear binarios grandes fuera de LFS.
// Preventivo: `npm run check` detecta el problema despues, el hook lo evita antes.

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { ROOT } from './lib/catalog.mjs';

const HOOK = `#!/bin/sh
# Instalado por \`npm run install-hooks\`. Bloquea binarios >1 MB que no sean
# punteros LFS: una vez commiteados, sacarlos obliga a reescribir la historia.
#
# Solo mira archivos bajo library/ o con extension de binario. Asi un
# catalog/books.json de varios MB (miles de titulos) nunca da falso positivo.
limit=1048576
failed=0

for file in $(git diff --cached --name-only --diff-filter=AM); do
  case "$file" in
    library/*) ;;
    *.pdf|*.epub|*.mobi|*.azw3|*.djvu|*.chm|*.zip|*.cbz|*.cbr) ;;
    *) continue ;;
  esac

  size=$(git cat-file -s ":$file" 2>/dev/null) || continue
  [ "$size" -le "$limit" ] && continue

  head=$(git cat-file -p ":$file" 2>/dev/null | head -c 44)
  if [ "$head" = "version https://git-lfs.github.com/spec/v1" ]; then
    continue
  fi

  echo "pre-commit: '$file' pesa $size bytes y NO es un puntero LFS."
  failed=1
done

if [ "$failed" -ne 0 ]; then
  echo ""
  echo "Agrega la extension a .gitattributes y re-stagea el archivo:"
  echo "  git rm --cached <archivo> && git add <archivo>"
  echo "Para saltarte esta verificacion a proposito: git commit --no-verify"
  exit 1
fi

exit 0
`;

const gitDir = (() => {
  try {
    return execFileSync('git', ['rev-parse', '--git-dir'], { cwd: ROOT, encoding: 'utf8' }).trim();
  } catch {
    console.error('No es un repositorio git. Corre `git init` primero.');
    process.exit(1);
  }
})();

const hooksDir = path.resolve(ROOT, gitDir, 'hooks');
const hookPath = path.join(hooksDir, 'pre-commit');

if (fs.existsSync(hookPath) && !fs.readFileSync(hookPath, 'utf8').includes('install-hooks')) {
  console.error(`Ya existe un pre-commit en ${hookPath} que no fue creado por este script.`);
  console.error('Revísalo y bórralo manualmente si quieres reemplazarlo.');
  process.exit(1);
}

fs.mkdirSync(hooksDir, { recursive: true });
fs.writeFileSync(hookPath, HOOK, { mode: 0o755 });
try { fs.chmodSync(hookPath, 0o755); } catch { /* Windows: sin permisos POSIX */ }

console.log(`Hook instalado en ${path.relative(ROOT, hookPath).split(path.sep).join('/')}`);
console.log('Bloquea el commit de cualquier archivo >1 MB que no sea puntero LFS.');
