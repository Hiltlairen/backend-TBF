// ============================================================
// store.js — Persistencia con doble backend
// ============================================================
// Interfaz SÍNCRONA y en memoria (las rutas no cambian).
//   · Sin DATABASE_URL → todo en archivos JSON (modo demo).
//   · Con DATABASE_URL → el estado se hidrata desde Postgres al
//     arrancar y cada mutación se replica allí (write-through).
//
// El contenido (libros/lecciones/vocabulario) sale de Postgres si
// está disponible; si no, del content.json empaquetado.
// ============================================================
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { config, tieneDB } from '../config.js'
import { persistir, persistirBorrado } from './pg.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const CONTENIDO = JSON.parse(fs.readFileSync(path.join(__dirname, 'content.json'), 'utf8'))

// Contenido "vivo": arranca con el del archivo y puede ser reemplazado
// por el de Postgres tras hidratar (ver aplicarContenidoDB).
let contenidoVivo = {
  books: CONTENIDO.books,
  lessons: CONTENIDO.lessons,
  vocabulary: CONTENIDO.vocabulary,
}

const COLECCIONES = [
  'usuarios', 'actividades', 'salas', 'resultados',
  'revisiones', 'partidas', 'rutas', 'auditoria', 'generaciones',
  'clases', 'estudiantes', 'tokens_auth',
]

const db = {}

function archivo(nombre) { return path.join(config.dataDir, `${nombre}.json`) }

function cargar() {
  fs.mkdirSync(config.dataDir, { recursive: true })
  for (const c of COLECCIONES) {
    try {
      db[c] = fs.existsSync(archivo(c)) ? JSON.parse(fs.readFileSync(archivo(c), 'utf8')) : []
    } catch { db[c] = [] }
  }
}

function guardar(coleccion) {
  fs.mkdirSync(config.dataDir, { recursive: true })
  fs.writeFileSync(archivo(coleccion), JSON.stringify(db[coleccion], null, 2), 'utf8')
}

cargar()

// ── API genérica ───────────────────────────────────────────
export const nuevoId = () => crypto.randomUUID()

export function listar(coleccion, filtro = () => true) {
  return db[coleccion].filter(filtro)
}
export function buscar(coleccion, filtro) {
  return db[coleccion].find(filtro) ?? null
}
export function insertar(coleccion, doc) {
  const registro = { id: doc.id ?? nuevoId(), creado_en: new Date().toISOString(), ...doc }
  db[coleccion].push(registro)
  guardar(coleccion)
  if (tieneDB()) persistir(coleccion, registro)   // write-through a Postgres
  return registro
}
export function actualizar(coleccion, id, parche) {
  const i = db[coleccion].findIndex((d) => d.id === id)
  if (i === -1) return null
  db[coleccion][i] = { ...db[coleccion][i], ...parche, actualizado_en: new Date().toISOString() }
  guardar(coleccion)
  if (tieneDB()) persistir(coleccion, db[coleccion][i])
  return db[coleccion][i]
}
export function eliminar(coleccion, id) {
  const antes = db[coleccion].length
  db[coleccion] = db[coleccion].filter((d) => d.id !== id)
  if (db[coleccion].length !== antes) {
    guardar(coleccion)
    if (tieneDB()) persistirBorrado(coleccion, id)
    return true
  }
  return false
}

// ── Hidratación desde Postgres (llamada al arrancar) ───────
/** Reemplaza el contenido base (libros/lecciones/vocab) por el de la BD. */
export function aplicarContenidoDB(contenido = {}) {
  if (contenido.books?.length) contenidoVivo.books = contenido.books
  if (contenido.lessons?.length) contenidoVivo.lessons = contenido.lessons
  if (contenido.vocabulary?.length) contenidoVivo.vocabulary = contenido.vocabulary
}

/** Fusiona colecciones de estado traídas de la BD en el store en memoria. */
export function aplicarColeccionesDB(colecciones = {}) {
  for (const [col, filas] of Object.entries(colecciones)) {
    if (!Array.isArray(filas) || !filas.length) continue
    if (!db[col]) db[col] = []
    // Se combinan por id: lo de la BD manda sobre el espejo JSON.
    const porId = new Map((db[col] ?? []).map((d) => [d.id, d]))
    for (const fila of filas) porId.set(fila.id, fila)
    db[col] = [...porId.values()]
    guardar(col)
  }
}

// ── Biblioteca (contenido) ─────────────────────────────────
export const libros = () => contenidoVivo.books
export const lecciones = (bookId) =>
  contenidoVivo.lessons.filter((l) => !bookId || l.book_id === Number(bookId))
              .sort((a, b) => a.numero - b.numero)
export const leccionPorId = (id) => contenidoVivo.lessons.find((l) => l.id === Number(id)) ?? null
export const vocabulario = (lessonIds = []) =>
  contenidoVivo.vocabulary.filter((v) => lessonIds.map(Number).includes(v.lesson_id))

// El vocabulario añadido por docentes vive en la colección editable
export function vocabularioCompleto(lessonIds = []) {
  const base = vocabulario(lessonIds)
  const extra = listar('auditoria', (a) => a.tipo === 'vocab' && lessonIds.map(Number).includes(a.lesson_id))
    .map((a) => a.payload)
  return [...base, ...extra]
}

export function agregarVocabulario({ lesson_id, categoria, ingles, espanol, autor }) {
  return insertar('auditoria', {
    tipo: 'vocab',
    lesson_id: Number(lesson_id),
    autor,
    payload: { id: nuevoId(), lesson_id: Number(lesson_id), categoria, ingles, espanol },
  })
}

export { db }
