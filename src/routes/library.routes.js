// ============================================================
// library.routes.js — /api/library
// ============================================================
// Biblioteca: libros, lecciones y vocabulario.
// Lectura: cualquier cuenta autenticada.
// Escritura de vocabulario: docente o superior, y queda en cola
// de curaduría si el rol es docente.
// ============================================================
import { Router } from 'express'
import { libros, lecciones, leccionPorId, vocabularioCompleto, agregarVocabulario, insertar, listar } from '../db/store.js'
import { requiereAuth, requiereRol } from '../middleware/auth.js'
import { validar } from '../middleware/validar.js'
import { agregarVocabularioSchema } from '../schemas/library.schemas.js'

const r = Router()

r.get('/libros', requiereAuth, (_req, res) => res.json({ libros: libros() }))

r.get('/libros/:bookId/lecciones', requiereAuth, (req, res) => {
  const data = lecciones(req.params.bookId)
  if (!data.length) return res.status(404).json({ error: 'Ese libro no tiene lecciones.' })
  res.json({ lecciones: data })
})

// GET /api/library/libros/:bookId/hoja
// Vista tipo hoja de cálculo: todas las lecciones del libro, cada
// una con su vocabulario ya adjunto. Una sola llamada alimenta la
// pantalla de "libro → lecciones (columna) → vocabulario (tabla)".
r.get('/libros/:bookId/hoja', requiereAuth, (req, res) => {
  const ls = lecciones(req.params.bookId)
  if (!ls.length) return res.status(404).json({ error: 'Ese libro no tiene lecciones.' })
  const hoja = ls.map((l) => {
    const vocab = vocabularioCompleto([l.id])
      .sort((a, b) => a.categoria.localeCompare(b.categoria) || a.ingles.localeCompare(b.ingles))
    return {
      id: l.id, numero: l.numero, titulo: l.titulo,
      temas: l.temas ?? '', competencia: l.competencia ?? '',
      total: vocab.length, vocabulario: vocab,
    }
  })
  res.json({
    libro: libros().find((b) => b.id === Number(req.params.bookId)) ?? null,
    lecciones: hoja,
    total: hoja.reduce((n, l) => n + l.total, 0),
  })
})

r.get('/lecciones/:id', requiereAuth, (req, res) => {
  const l = leccionPorId(req.params.id)
  if (!l) return res.status(404).json({ error: 'Lección no encontrada.' })
  res.json({ leccion: l })
})

// GET /api/library/vocabulario?lecciones=1,2,3
r.get('/vocabulario', requiereAuth, (req, res) => {
  const ids = String(req.query.lecciones ?? '').split(',').map((s) => s.trim()).filter(Boolean)
  if (!ids.length) return res.json({ vocabulario: [] })
  const data = vocabularioCompleto(ids).sort((a, b) => a.categoria.localeCompare(b.categoria))
  res.json({ vocabulario: data, total: data.length })
})

// POST /api/library/vocabulario
r.post('/vocabulario', requiereAuth, requiereRol('admin', 'curador', 'docente'), validar(agregarVocabularioSchema), (req, res) => {
  const { lesson_id, categoria, ingles, espanol } = req.body
  if (!leccionPorId(lesson_id)) return res.status(404).json({ error: 'Esa lección no existe.' })

  const registro = agregarVocabulario({ lesson_id, categoria, ingles, espanol, autor: req.usuario.id })

  // Si lo sube un docente, entra a curaduría. Curador/admin lo dan por aprobado.
  const requiereRevision = req.usuario.rol === 'docente'
  if (requiereRevision) {
    insertar('revisiones', {
      tipo: 'vocabulario',
      referencia_id: registro.id,
      estado: 'pendiente',
      enviado_por: req.usuario.id,
      enviado_por_nombre: req.usuario.nombre,
      resumen: `${ingles} = ${espanol} (${categoria})`,
      payload: registro.payload,
    })
  }
  res.status(201).json({ vocabulario: registro.payload, enCuraduria: requiereRevision })
})

// Resumen de la biblioteca para la pantalla de inicio
r.get('/resumen', requiereAuth, (_req, res) => {
  const ls = lecciones()
  res.json({
    libros: libros().length,
    lecciones: ls.length,
    vocabulario: vocabularioCompleto(ls.map((l) => l.id)).length,
    actividadesGuardadas: listar('actividades').length,
  })
})

export default r
