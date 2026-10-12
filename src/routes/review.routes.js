// ============================================================
// review.routes.js — /api/review   (rol CURADOR)
// ============================================================
// La "sala" donde se revisa TODO lo que se carga a los libros y
// lecciones antes de que llegue a los estudiantes:
//   · vocabulario nuevo subido por docentes
//   · actividades generadas que requieren corrección humana
//   · entregas de estudiantes que no se autocorrigen (redacción)
// ============================================================
import { Router } from 'express'
import { listar, buscar, actualizar, insertar } from '../db/store.js'
import { requiereAuth, requiereRol } from '../middleware/auth.js'
import { nombreParaMostrar, conNombreResuelto } from '../services/identidad.js'
import { validar } from '../middleware/validar.js'
import { decidirRevisionSchema, notaRevisionSchema } from '../schemas/review.schemas.js'

const r = Router()
const soloCuradores = [requiereAuth, requiereRol('admin', 'curador')]

// El curador cura CONTENIDO; por diseño no necesita saber de qué
// estudiante es una entrega para aprobarla/corregirla. Se resuelve
// el nombre (o su pseudónimo) al leer, nunca se guarda en la fila.
function conRevisionNombreResuelto(item, rolActor) {
  if (item.tipo !== 'entrega') return item
  const { nombre } = nombreParaMostrar(
    { estudianteId: item.enviado_por_estudiante_id ?? null, nombreLibre: item.enviado_por_nombre ?? null },
    rolActor,
  )
  return { ...item, enviado_por_nombre: nombre }
}

// GET /api/review/cola?estado=pendiente&tipo=vocabulario
r.get('/cola', ...soloCuradores, (req, res) => {
  const { estado = 'pendiente', tipo } = req.query
  const items = listar('revisiones', (x) =>
    (estado === 'todos' || x.estado === estado) && (!tipo || x.tipo === tipo)
  ).slice().reverse().map((x) => conRevisionNombreResuelto(x, req.usuario.rol))

  res.json({
    items,
    contadores: {
      pendiente: listar('revisiones', (x) => x.estado === 'pendiente').length,
      aprobado:  listar('revisiones', (x) => x.estado === 'aprobado').length,
      rechazado: listar('revisiones', (x) => x.estado === 'rechazado').length,
      corregido: listar('revisiones', (x) => x.estado === 'corregido').length,
    },
  })
})

// GET /api/review/:id — item con su contenido completo
r.get('/:id', ...soloCuradores, (req, res) => {
  const item = buscar('revisiones', (x) => x.id === req.params.id)
  if (!item) return res.status(404).json({ error: 'Item no encontrado.' })

  let contenido = null
  if (item.tipo === 'actividad') contenido = buscar('actividades', (a) => a.id === item.referencia_id)
  if (item.tipo === 'entrega') {
    const rdo = buscar('resultados', (a) => a.id === item.referencia_id)
    contenido = rdo ? conNombreResuelto(rdo, req.usuario.rol) : null
  }
  if (item.tipo === 'vocabulario') contenido = item.payload

  res.json({ item: conRevisionNombreResuelto(item, req.usuario.rol), contenido })
})

// POST /api/review/:id/decidir — Body: { decision:'aprobar'|'rechazar', comentario, correcciones }
r.post('/:id/decidir', ...soloCuradores, validar(decidirRevisionSchema), (req, res) => {
  const { decision, comentario, correcciones } = req.body
  const item = buscar('revisiones', (x) => x.id === req.params.id)
  if (!item) return res.status(404).json({ error: 'Item no encontrado.' })
  if (item.estado !== 'pendiente') return res.status(409).json({ error: 'Ese item ya fue revisado.' })

  const estado = decision === 'aprobar' ? (correcciones ? 'corregido' : 'aprobado') : 'rechazado'
  const actualizado = actualizar('revisiones', item.id, {
    estado, comentario,
    revisado_por: req.usuario.id,
    revisado_por_nombre: req.usuario.nombre,
    revisado_en: new Date().toISOString(),
    correcciones,
  })

  // Propaga la decisión al objeto original
  if (item.tipo === 'actividad') {
    const parche = { estado: estado === 'rechazado' ? 'rechazada' : 'aprobada', revision_id: item.id }
    if (correcciones) {
      // `contenido` es la variante 1: la corrección la reemplaza también
      // dentro de `variantes`, que es lo que se reparte en la sala.
      parche.contenido = correcciones
      const act = buscar('actividades', (a) => a.id === item.referencia_id)
      if (Array.isArray(act?.variantes) && act.variantes.length) {
        parche.variantes = [correcciones, ...act.variantes.slice(1)]
      }
    }
    actualizar('actividades', item.referencia_id, parche)
  }
  if (item.tipo === 'entrega' && correcciones?.puntaje != null) {
    actualizar('resultados', item.referencia_id, {
      puntaje: correcciones.puntaje,
      requiere_revision: false,
      comentario_docente: comentario,
    })
  }

  insertar('auditoria', {
    tipo: 'revision', accion: decision, item_id: item.id,
    por: req.usuario.id, por_nombre: req.usuario.nombre,
  })

  res.json({ item: actualizado })
})

// POST /api/review/:id/nota — comentario sin cerrar el item
r.post('/:id/nota', ...soloCuradores, validar(notaRevisionSchema), (req, res) => {
  const item = buscar('revisiones', (x) => x.id === req.params.id)
  if (!item) return res.status(404).json({ error: 'Item no encontrado.' })
  const notas = [...(item.notas ?? []), {
    texto: req.body.texto, por: req.usuario.nombre, en: new Date().toISOString(),
  }]
  res.json({ item: actualizar('revisiones', item.id, { notas }) })
})

export default r
