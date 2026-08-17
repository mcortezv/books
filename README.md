# 📚 Biblioteca de programación

Archivo personal de libros y papers de programación. Los PDFs viven en el repo
versionados con **Git LFS**; el catálogo, los índices y el buscador se generan
desde un único archivo fuente: [`catalog/books.json`](catalog/books.json).

**Buscar:**
[📖 catálogo completo](CATALOG.md) ·
[✍️ por autor](indices/por-autor.md) ·
[🏷️ por tema](indices/por-tema.md) ·
[📅 por año](indices/por-anio.md)

<!-- BEGIN:stats -->

| | |
| --- | ---: |
| Títulos | **0** |
| Libros | 0 |
| Papers | 0 |
| Peso total | — |

<!-- END:stats -->

---

## Requisitos

- **[Git LFS](https://git-lfs.com/)** — obligatorio. Sin él, al clonar recibes
  archivos de texto de 3 líneas en lugar de los PDFs.
  ```bash
  git lfs install    # una sola vez por máquina
  ```
- **Node.js ≥ 18** — para los scripts. **No requiere `npm install`**: todo está
  escrito con módulos nativos, cero dependencias.

## Clonar

```bash
git clone <url-del-repo>
cd books
npm run install-hooks     # instala el pre-commit que protege el repo
```

### Clonar sin bajar toda la biblioteca

Cuando el repo pese decenas de GB, no querrás descargarlo entero. Clona solo los
punteros y baja después lo que necesites:

```bash
GIT_LFS_SKIP_SMUDGE=1 git clone <url-del-repo>
cd books

npm run search -- --tag rust --paths      # ver qué archivos te interesan
git lfs pull --include="library/books/the-rust-*"
```

`npm run search -- --paths` imprime exactamente las rutas que espera
`git lfs pull --include=`, así que puedes encadenarlos.

---

## Buscar

El buscador funciona sobre la metadata: título, subtítulo, autores, temas,
editorial y notas.

```bash
npm run search -- rust                          # texto libre
npm run search -- --author fowler               # por autor
npm run search -- --tag testing --tag tdd       # por tema (acumulativo, AND)
npm run search -- --year 2019..2024             # por rango de años
npm run search -- --type paper --status unread  # papers pendientes de leer
npm run search -- clean code --limit 5          # varios términos + límite
npm run search -- --tags                        # lista todos los temas
npm run search -- --all                         # todo el catálogo
npm run search -- --tag rust --json             # salida JSON
npm run search -- --tag rust --paths            # solo rutas
```

Los términos se acumulan con AND y no distinguen mayúsculas ni acentos
(`martin` encuentra `Martín`). Los resultados se ordenan por relevancia: un match
en el título pesa más que uno en las notas.

`npm run search -- --help` tiene la referencia completa.

**Desde el navegador:** los índices son Markdown normal, así que se leen
directamente en GitHub. Puedes usar `Ctrl+F` dentro de [`CATALOG.md`](CATALOG.md)
o la barra de búsqueda del repo, sin instalar ni desplegar nada.

---

## Agregar un libro

```bash
npm run add
```

Es interactivo: pregunta título, autores, año, temas, etc. Si pones el PDF en
`library/books/` antes de correrlo, te lo ofrece en una lista; también acepta una
ruta directa:

```bash
npm run add -- --file "C:/Downloads/algun-libro.pdf"
```

El script mueve el archivo a `library/books/<id>.pdf` (o `library/papers/` si es
un paper) con el nombre canónico y registra su tamaño. Al terminar:

```bash
npm run build     # regenera CATALOG.md e indices/
npm run check     # valida el catálogo y la integridad de LFS
git add -A && git commit -m "Agrega <título>"
```

### Temas

Los temas están controlados en [`catalog/tags.json`](catalog/tags.json) con
alias, para que `js`, `javascript` y `JavaScript` no se conviertan en tres temas
distintos. Si necesitas uno nuevo, agrégalo ahí primero; `check` rechaza los
desconocidos. Ver los disponibles: `npm run search -- --tags`.

---

## Comandos

| Comando | Qué hace |
| --- | --- |
| `npm run add` | Alta interactiva de un título |
| `npm run search -- <query>` | Busca en el catálogo |
| `npm run build` | Regenera `CATALOG.md`, `indices/*.md` y las estadísticas de este README |
| `npm run check` | Valida el catálogo y la integridad de LFS (también `npm test`) |
| `npm run install-hooks` | Instala el pre-commit que bloquea binarios fuera de LFS |

---

## Cómo está organizado

```
catalog/books.json      Fuente de verdad. Es lo único que se edita.
catalog/tags.json       Temas canónicos + alias.
library/books/          PDFs y EPUBs de libros (Git LFS).
library/papers/         PDFs de papers (Git LFS).
CATALOG.md              GENERADO — tabla completa.
indices/*.md            GENERADOS — por autor, por tema, por año.
scripts/                Los cinco comandos de arriba.
```

Todo lo marcado como **GENERADO** se reescribe con `npm run build`; editarlo a
mano no sirve de nada. Está marcado como `linguist-generated` en
[`.gitattributes`](.gitattributes), así que GitHub colapsa su diff: agregar un
libro se lee como unas pocas líneas en `books.json` y no como cientos de líneas
de índices regenerados.

### Por qué Git LFS

Un PDF commiteado normalmente queda en el historial **para siempre**, y cada
clon lo descarga. Con LFS, git guarda solo un puntero de 3 líneas y el binario
va a un almacén aparte que se descarga bajo demanda.

Las extensiones cubiertas están en [`.gitattributes`](.gitattributes)
(`.pdf`, `.epub`, `.mobi`, `.azw3`, `.djvu`, `.chm`, `.zip`, `.cbz`, `.cbr`).
Si agregas un formato nuevo, **añádelo ahí antes de commitear el primer
archivo** — después ya es tarde y hay que reescribir la historia con
`git lfs migrate`.

Dos redes de seguridad para eso:

- El hook `pre-commit` (vía `npm run install-hooks`) rechaza cualquier archivo
  staged de más de 1 MB que no sea puntero LFS.
- `npm run check` verifica que todo binario trackeado bajo `library/` esté en
  LFS, y corre en CI en cada push.

---

## ⚠️ Cuota de Git LFS en GitHub

El plan gratuito de GitHub da **1 GB de almacenamiento y 1 GB/mes de ancho de
banda** para LFS. Un libro técnico pesa entre 5 y 50 MB, así que unos **40
libros agotan el free tier**. Arriba de eso son ~5 USD/mes por cada paquete de
50 GB (storage + bandwidth).

Detalles que importan:

- El ancho de banda se consume al **descargar** (`git lfs pull`, `clone`), no al
  hacer push. Por eso el flujo de clonado selectivo de arriba.
- Si el repo se pasa de la cuota, GitHub **bloquea los pushes de LFS** hasta que
  compres más o liberes espacio.
- Si más adelante prefieres sacar los binarios de LFS, el catálogo y los scripts
  siguen funcionando igual: solo cambian `.gitattributes` y de dónde salen los
  archivos.

## ⚠️ Licencias y copyright

Si vas a guardar libros comerciales, **crea el repo como privado**. Un repo
público con PDFs de editoriales recibe DMCA takedowns y puede costarte la cuenta.
Para material de libre distribución (papers de arXiv, libros con licencia
abierta) usa el campo `url` de cada entrada para dejar registrada la fuente
oficial.
