# Biblioteca

Archivo personal de libros y papers de programación. Los binarios viven en el
repo versionados con Git LFS; el catálogo, los índices y el buscador se generan
desde un único archivo fuente: [`catalog/books.json`](catalog/books.json).

[Catálogo](CATALOG.md) · [Por autor](indices/por-autor.md) · [Por tema](indices/por-tema.md) · [Por año](indices/por-anio.md)

<!-- BEGIN:stats -->

El catálogo está vacío. Agrega tu primer título con `npm run add`.

<!-- END:stats -->

---

## Requisitos

**[Git LFS](https://git-lfs.com/)** es obligatorio. Sin él, al clonar recibes
archivos de texto de tres líneas en lugar de los PDFs.

```bash
git lfs install    # una sola vez por máquina
```

**Node.js 18 o superior** para los scripts. No requiere `npm install`: todo está
escrito con módulos nativos, sin dependencias.

## Clonar

```bash
git clone <url-del-repo>
cd books
npm run install-hooks
```

El hook vive en `.git/` y no viaja con el repo, así que hay que instalarlo en
cada clon.

### Sin descargar toda la biblioteca

Cuando el repo pese decenas de GB no querrás bajarlo entero. Clona solo los
punteros y trae después lo que necesites:

```bash
GIT_LFS_SKIP_SMUDGE=1 git clone <url-del-repo>
cd books

npm run search -- --tag rust --paths
git lfs pull --include="library/books/the-rust-*"
```

`--paths` imprime exactamente las rutas que espera `git lfs pull --include=`,
así que los dos comandos se encadenan.

---

## Buscar

La búsqueda cubre título, subtítulo, autores, temas, editorial y notas.

```bash
npm run search -- rust                          # texto libre
npm run search -- --author fowler               # por autor
npm run search -- --tag testing --tag tdd       # por tema, acumulativo
npm run search -- --year 2019..2024             # por rango de años
npm run search -- --type paper --status unread  # papers pendientes
npm run search -- clean code --limit 5          # varios términos
```

Los términos se acumulan con AND y no distinguen mayúsculas ni acentos: `martin`
encuentra `Martín`. Los resultados se ordenan por relevancia, y un match en el
título pesa más que uno en las notas.

| Modo de salida | |
| --- | --- |
| *(ninguno)* | Tabla compacta |
| `--long` | Ficha completa con ruta, editorial, ISBN y notas |
| `--paths` | Solo rutas, para encadenar con `git lfs pull` |
| `--json` | JSON |
| `--tags` | Lista de temas disponibles |
| `--all` | Todo el catálogo |

La referencia completa está en `npm run search -- --help`.

**Desde el navegador.** Los índices son Markdown normal, así que se leen
directamente en GitHub. Puedes usar `Ctrl+F` dentro de [`CATALOG.md`](CATALOG.md)
o la barra de búsqueda del repo, sin instalar ni desplegar nada.

---

## Agregar un título

```bash
npm run add
```

Es interactivo. Si dejas el PDF en `library/books/` antes de correrlo, te lo
ofrece en una lista; también acepta una ruta directa:

```bash
npm run add -- --file "C:/Downloads/algun-libro.pdf"
```

El script mueve el archivo a `library/books/<id>.pdf` (o `library/papers/` si es
un paper) con el nombre canónico y registra su tamaño. Al terminar:

```bash
npm run build
npm run check
git add -A && git commit -m "Agrega <título>"
```

### Temas

Los temas están controlados en [`catalog/tags.json`](catalog/tags.json), con
alias, para que `js`, `javascript` y `JavaScript` no acaben siendo tres temas
distintos. Si necesitas uno nuevo, agrégalo ahí primero: `check` rechaza los
desconocidos. Para ver los disponibles, `npm run search -- --tags`.

---

## Comandos

| Comando | |
| --- | --- |
| `npm run add` | Alta interactiva de un título |
| `npm run search -- <query>` | Busca en el catálogo |
| `npm run build` | Regenera `CATALOG.md`, `indices/` y las estadísticas de este README |
| `npm run check` | Valida el catálogo y la integridad de LFS (también `npm test`) |
| `npm run install-hooks` | Instala el pre-commit que bloquea binarios fuera de LFS |

## Estructura

```
catalog/books.json    Fuente de verdad. Es lo único que se edita.
catalog/tags.json     Temas canónicos y sus alias.
library/books/        Libros en PDF y EPUB (Git LFS).
library/papers/       Papers en PDF (Git LFS).
CATALOG.md            Generado. Tabla completa.
indices/              Generados. Por autor, por tema, por año.
scripts/              Los cinco comandos de arriba.
```

Todo lo marcado como generado se reescribe con `npm run build`; editarlo a mano
no sirve de nada. Está declarado como `linguist-generated` en
[`.gitattributes`](.gitattributes), así que GitHub colapsa su diff: agregar un
libro se lee como unas pocas líneas en `books.json` y no como cientos de líneas
de índices regenerados.

---

## Por qué Git LFS

Un PDF commiteado de forma normal queda en el historial para siempre, y cada
clon lo descarga. Con LFS, git guarda un puntero de tres líneas y el binario va
a un almacén aparte que se descarga bajo demanda.

Las extensiones cubiertas están en [`.gitattributes`](.gitattributes): `.pdf`,
`.epub`, `.mobi`, `.azw3`, `.djvu`, `.chm`, `.zip`, `.cbz` y `.cbr`. Si agregas
un formato nuevo, **añádelo ahí antes de commitear el primer archivo** — después
ya es tarde y hay que reescribir la historia con `git lfs migrate`.

Hay dos redes de seguridad para eso:

- El hook `pre-commit` rechaza cualquier archivo staged de más de 1 MB, bajo
  `library/` o con extensión de binario, que no sea un puntero LFS.
- `npm run check` verifica que todo binario trackeado bajo `library/` esté en
  LFS, y corre en CI en cada push.

## Cuota de Git LFS en GitHub

El plan gratuito da **1 GB de almacenamiento y 1 GB al mes de ancho de banda**.
Un libro técnico pesa entre 5 y 50 MB, así que unos 40 libros agotan el free
tier. Arriba de eso son unos 5 USD al mes por cada paquete de 50 GB de
almacenamiento y ancho de banda.

Tres detalles que importan:

- El ancho de banda se consume al **descargar** (`git lfs pull`, `git clone`), no
  al hacer push. De ahí el flujo de clonado selectivo de arriba.
- Si el repo se pasa de la cuota, GitHub **bloquea los pushes de LFS** hasta que
  compres más espacio o liberes el que hay.
- Si más adelante prefieres sacar los binarios de LFS, el catálogo y los scripts
  siguen funcionando igual: solo cambian `.gitattributes` y de dónde salen los
  archivos.

## Licencias

Si vas a guardar libros comerciales, **crea el repo como privado**. Un repo
público con PDFs de editoriales recibe DMCA takedowns. Para material de libre
distribución (papers de arXiv, libros con licencia abierta) usa el campo `url`
de cada entrada para dejar registrada la fuente oficial.
