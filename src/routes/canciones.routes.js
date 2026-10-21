// ============================================================
// canciones.routes.js — /api/canciones (actividad 10)
// ============================================================
// Lo que usa el panel del docente para armar "completar la letra":
//   GET  /buscar?titulo=&artista=  → canciones encontradas
//   GET  /:fuente/:id              → la letra en versos + estribillo detectado
//   POST /vista-previa             → cómo queda la letra con huecos; en modo
//                                    'vocabulario' además busca en la letra las
//                                    palabras de las lecciones y dice cuáles halló
// La actividad en sí se genera en POST /api/activities/generar(-ruta),
// con la canción elegida en la configuración de la actividad.
// ============================================================
import { Router } from 'express'
import { z } from 'zod'
import { requiereAuth, requiereRol } from '../middleware/auth.js'
import { validar } from '../middleware/validar.js'
import { buscarCanciones, obtenerCancion } from '../services/canciones.js'
import { armarActividadCancion, coincidenciasVocabulario, detectarEstribillo, normalizarAudio, MODOS_HUECO, MAX_HUECOS } from '../domain/cancionHuecos.js'
import { leccionPorId, libros, vocabularioCompleto } from '../db/store.js'
import { vocabularioDeBD } from '../db/pg.js'
import { tieneDB } from '../config.js'
import { logger } from '../services/logger.js'

const r = Router()
const docentes = [requiereAuth, requiereRol('admin', 'docente')]
const SIN_SERVICIO = 'El servicio de letras no responde ahora. Inténtalo de nuevo en un momento.'

/** Nivel del libro de las lecciones (define el % de huecos). */
function nivelDe(leccionesIds = []) {
  const l = leccionPorId(leccionesIds[0])
  return libros().find((b) => b.id === l?.book_id)?.nivel ?? 'A2'
}

/** Vocabulario de las lecciones (Postgres si hay, si no el store). */
async function vocabularioDe(leccionesIds) {
  if (tieneDB()) {
    const deBD = await vocabularioDeBD(leccionesIds).catch(() => null)
    if (deBD?.length) return deBD
  }
  return vocabularioCompleto(leccionesIds)
}

r.get('/buscar', ...docentes, async (req, res) => {
  const titulo = String(req.query.titulo ?? '').trim().slice(0, 120)
  const artista = String(req.query.artista ?? '').trim().slice(0, 120)
  if (titulo.length < 2) return res.status(400).json({ error: 'Escribe el título de la canción.' })
  try {
    res.json({ resultados: await buscarCanciones(titulo, artista) })
  } catch (e) {
    logger.warn({ err: e.message }, '[canciones] búsqueda falló')
    res.status(503).json({ error: SIN_SERVICIO })
  }
})

r.get('/:fuente/:id', ...docentes, async (req, res) => {
  const { fuente, id } = req.params
  if (!['lrclib', 'musixmatch'].includes(fuente)) return res.status(400).json({ error: 'Fuente desconocida.' })
  try {
    const c = await obtenerCancion(fuente, id)
    if (!c) return res.status(404).json({ error: 'No se encontró la letra de esa canción.' })
    res.json({ cancion: c, estribillo: detectarEstribillo(c.lineas) })
  } catch (e) {
    logger.warn({ err: e.message }, '[canciones] no se pudo traer la letra')
    res.status(503).json({ error: SIN_SERVICIO })
  }
})

// Configuración de la canción: la misma forma que viaja en
// config.cancion al generar la actividad (activities.routes.js).
export const configCancionSchema = z.object({
  fuente: z.enum(['lrclib', 'musixmatch']),
  id: z.string().trim().min(1).max(40),
  audio: z.object({ tipo: z.string(), ref: z.string().max(500) }),
  opciones: z.object({
    tramo: z.union([
      z.enum(['completa', 'estribillo']),
      z.object({ desde: z.number().int().min(0), hasta: z.number().int().min(0) }),
    ]).optional(),
    // manual: las elige el docente · vocabulario: las halló el sistema (y se pueden ajustar)
    modo: z.enum(MODOS_HUECO).optional(),
    // "verso:palabra" de la letra original
    seleccion: z.array(z.string().regex(/^\d{1,4}:\d{1,3}$/)).max(MAX_HUECOS).optional(),
  }).optional(),
})

r.post('/vista-previa', ...docentes, validar(z.object({
  cancion: configCancionSchema,
  lecciones: z.array(z.union([z.string(), z.number()])).min(1),
})), async (req, res) => {
  const { cancion: cfg, lecciones } = req.body
  let audio
  try { audio = normalizarAudio(cfg.audio) } catch (e) { return res.status(400).json({ error: e.message }) }
  try {
    const c = await obtenerCancion(cfg.fuente, cfg.id)
    if (!c) return res.status(404).json({ error: 'No se encontró la letra de esa canción.' })
    const nivel = nivelDe(lecciones)
    const opciones = { ...cfg.opciones }
    // Modo vocabulario: se buscan en el tramo las palabras de las lecciones.
    let vocabulario = null
    if (opciones.modo === 'vocabulario') {
      const ids = lecciones.map((x) => (Number.isNaN(Number(x)) ? x : Number(x)))
      const r = coincidenciasVocabulario(c.lineas, opciones.tramo ?? 'completa', await vocabularioDe(ids))
      opciones.seleccion = r.seleccion
      vocabulario = { buscadas: r.buscadas, encontradas: r.encontradas, lecciones: ids.map((id) => leccionPorId(id)?.numero).filter(Boolean) }
    }
    const actividad = armarActividadCancion({ cancion: c, audio, opciones, nivel })
    res.json({ actividad, nivel, seleccion: opciones.seleccion ?? [], vocabulario })
  } catch (e) {
    logger.warn({ err: e.message }, '[canciones] vista previa falló')
    res.status(503).json({ error: SIN_SERVICIO })
  }
})

export default r
