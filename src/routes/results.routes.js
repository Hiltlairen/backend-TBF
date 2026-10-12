// ============================================================
// results.routes.js — /api/results
// ============================================================
import { Router } from 'express'
import { listar, buscar } from '../db/store.js'
import { requiereAuth, requiereRol } from '../middleware/auth.js'
import { conNombreResuelto } from '../services/identidad.js'

const r = Router()

// GET /api/results — docente ve los suyos; admin/curador ven todo
// El nombre del estudiante se resuelve al leer (nunca se guarda
// duplicado): el curador ve un pseudónimo, no el nombre real — no
// lo necesita para revisar contenido. Ver services/identidad.js.
r.get('/', requiereAuth, requiereRol('admin', 'curador', 'docente'), (req, res) => {
  const misSalas = new Set(
    listar('salas', (s) => s.docente_id === req.usuario.id).map((s) => s.id)
  )
  const todo = listar('resultados')
  const datos = req.usuario.rol === 'docente'
    ? todo.filter((x) => misSalas.has(x.sala_id))
    : todo

  res.json({ resultados: datos.slice().reverse().map((x) => conNombreResuelto(x, req.usuario.rol)) })
})

// GET /api/results/estadisticas — para las tarjetas del dashboard
r.get('/estadisticas', requiereAuth, requiereRol('admin', 'curador', 'docente'), (req, res) => {
  const misSalas = new Set(listar('salas', (s) => s.docente_id === req.usuario.id).map((s) => s.id))
  const datos = req.usuario.rol === 'docente'
    ? listar('resultados', (x) => misSalas.has(x.sala_id))
    : listar('resultados')

  const puntajes = datos.map((d) => d.puntaje)
  const promedio = puntajes.length ? Math.round(puntajes.reduce((a, b) => a + b, 0) / puntajes.length) : 0

  // Distribución por carril final: dónde se atascan los estudiantes
  const porCarril = { avanzado: 0, estandar: 0, refuerzo: 0 }
  for (const d of datos) {
    const ultimo = d.historial?.at(-1)
    if (ultimo) {
      const carril = ultimo.nodoId?.split('-')[1]
      if (porCarril[carril] != null) porCarril[carril] += 1
    }
  }

  res.json({
    total: datos.length,
    promedio,
    pendientesRevision: datos.filter((d) => d.requiere_revision).length,
    modos: {
      simple: datos.filter((d) => d.modo === 'simple').length,
      juego: datos.filter((d) => d.modo === 'juego').length,
    },
    porCarril,
    salasActivas: listar('salas', (s) => s.activa).length,
  })
})

// GET /api/results/:id — detalle con el recorrido completo
r.get('/:id', requiereAuth, requiereRol('admin', 'curador', 'docente'), (req, res) => {
  const rdo = buscar('resultados', (x) => x.id === req.params.id)
  if (!rdo) return res.status(404).json({ error: 'Resultado no encontrado.' })
  res.json({ resultado: conNombreResuelto(rdo, req.usuario.rol) })
})

export default r
