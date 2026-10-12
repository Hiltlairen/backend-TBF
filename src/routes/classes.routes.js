// ============================================================
// classes.routes.js — /api/clases
// ============================================================
// "Clase" = cohorte de estudiantes de un semestre (grupo + libro +
// docente asignado). Solo admin o curador pueden crear clases y
// gestionar el roster; el docente solo ve/usa las que se le
// asignaron, no puede crearlas. Cada estudiante es un usuario
// TEMPORAL por semestre identificado ÚNICAMENTE por un código de
// matrícula — sin email ni contraseña — que además sirve para
// entrar a la sala (junto con el código de sala de siempre).
//
// Privacidad: el nombre del estudiante se guarda CIFRADO en reposo
// (services/crypto.js) y se descifra solo para quien administra el
// roster (admin/curador/docente asignado) — nunca queda en texto
// plano en el archivo/BD. La identidad tiene una ventana de
// retención configurable (services/purga.js): al finalizar la
// clase o dar de baja a un estudiante, arranca el conteo; pasado
// ese plazo, el nombre se anonimiza solo (o a mano, para un retiro
// a mitad de semestre).
//
// Importación masiva (alta de estudiantes): la hace admin/curaduría
// desde una grilla tipo hoja de cálculo, SIEMPRE dentro de una clase
// ya elegida (docente/curso/libro quedan fijados por esa clase, no
// se piden por fila). `codigoExterno` es opcional y solo de
// referencia (código del instituto) — nunca reemplaza el código de
// matrícula interno, que sigue siendo el único que sirve para entrar
// a una sala. Antes de confirmar, el navegador llama a
// POST /:id/estudiantes/previsualizar (dry-run) para mostrar nombres
// y códigos repetidos o faltantes; el servidor vuelve a validar todo
// en POST /:id/estudiantes y rechaza el lote completo si algo sigue
// mal, en vez de importar parcialmente.
// ============================================================
import { Router } from 'express'
import PDFDocument from 'pdfkit'
import { listar, buscar, insertar, actualizar, libros as listarLibros } from '../db/store.js'
import { requiereAuth, requiereRol } from '../middleware/auth.js'
import { cifrar, descifrar } from '../services/crypto.js'
import { purgarEstudiante, diasRestantes } from '../services/purga.js'
import { conNombreResuelto } from '../services/identidad.js'
import { validar } from '../middleware/validar.js'
import { crearClaseSchema, editarClaseSchema, importarEstudiantesSchema } from '../schemas/classes.schemas.js'

const r = Router()
const gestion = [requiereAuth, requiereRol('admin', 'curador')]

// Alfabeto sin caracteres ambiguos (sin 0/O, 1/I) para que el código
// se pueda leer y escribir a mano sin confusiones.
const SIN_AMBIGUOS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'

function generarCodigoMatricula() {
  let codigo
  do {
    codigo = Array.from({ length: 6 }, () => SIN_AMBIGUOS[Math.floor(Math.random() * SIN_AMBIGUOS.length)]).join('')
  } while (buscar('estudiantes', (e) => e.codigo_matricula === codigo))
  return codigo
}

function nombreDocente(id) {
  return buscar('usuarios', (u) => u.id === id)?.nombre ?? null
}
function nombreLibro(bookId) {
  return listarLibros().find((b) => b.id === Number(bookId))?.nombre ?? null
}

/** admin/curador ven todo; el docente solo sus propias clases. */
function puedeVer(clase, usuario) {
  return usuario.rol === 'admin' || usuario.rol === 'curador' || clase.docente_id === usuario.id
}

function publicaClase(c) {
  const total = listar('estudiantes', (e) => e.clase_id === c.id && e.activo).length
  return {
    ...c,
    docenteNombre: c.docente_id ? nombreDocente(c.docente_id) : null,
    libroNombre: c.book_id ? nombreLibro(c.book_id) : null,
    totalEstudiantes: total,
  }
}

/** Descifra el nombre y agrega el estado de retención/purga para la UI.
 *  Nunca devuelve el valor cifrado crudo. */
function publicaEstudiante(e) {
  const { nombre, ...resto } = e
  return {
    ...resto,
    nombre: e.purgado_en ? null : descifrar(nombre),
    purgado: Boolean(e.purgado_en),
    diasParaPurga: e.retiro_en && !e.purgado_en ? diasRestantes(e) : null,
  }
}

function csv(filas) {
  const esc = (v) => {
    const s = v === null || v === undefined ? '' : String(v)
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }
  return filas.map((fila) => fila.map(esc).join(',')).join('\r\n')
}

// ── Importación masiva — normalización y validación compartidas ──
// Usadas tanto por la previsualización (dry-run) como por la carga
// real: la carga vuelve a validar en el servidor, nunca confía en
// lo que ya "aprobó" el navegador.
function normalizarFila(f) {
  const nombre = String(f?.nombre ?? '').trim().replace(/\s+/g, ' ')
  const codigoExternoBruto = String(f?.codigoExterno ?? '').trim()
  return {
    nombre: nombre.slice(0, 120),
    codigoExterno: codigoExternoBruto ? codigoExternoBruto.slice(0, 60) : null,
  }
}

/** Valida un lote contra sí mismo y contra el roster ya existente de
 *  la clase. Devuelve cada fila anotada con `issues` (array de
 *  códigos) y `valido`, más un resumen. No toca la base de datos. */
function validarLote(filasCrudas, clase) {
  const existentes = listar('estudiantes', (e) => e.clase_id === clase.id && !e.purgado_en)
  const nombresExistentes = new Set(existentes.map((e) => descifrar(e.nombre).trim().toLowerCase()))
  const codigosExistentes = new Set(
    existentes.map((e) => e.codigo_externo).filter(Boolean).map((c) => c.toLowerCase())
  )

  const nombresVistos = new Set()
  const codigosVistos = new Set()

  const filas = filasCrudas.map((cruda) => {
    const fila = normalizarFila(cruda)
    const issues = []
    const claveNombre = fila.nombre.toLowerCase()
    const claveCodigo = fila.codigoExterno?.toLowerCase()

    if (!fila.nombre) {
      issues.push('nombre_faltante')
    } else {
      if (nombresVistos.has(claveNombre)) issues.push('nombre_duplicado_en_lote')
      if (nombresExistentes.has(claveNombre)) issues.push('nombre_ya_en_clase')
      nombresVistos.add(claveNombre)
    }

    if (claveCodigo) {
      if (codigosVistos.has(claveCodigo)) issues.push('codigo_duplicado_en_lote')
      if (codigosExistentes.has(claveCodigo)) issues.push('codigo_ya_en_clase')
      codigosVistos.add(claveCodigo)
    }

    return { ...fila, issues, valido: issues.length === 0 }
  })

  const advertencias = []
  if (!clase.docente_id) advertencias.push('sin_docente')
  if (!clase.book_id) advertencias.push('sin_libro')

  return {
    filas,
    advertencias,
    resumen: {
      total: filas.length,
      validas: filas.filter((f) => f.valido).length,
      invalidas: filas.filter((f) => !f.valido).length,
    },
  }
}

// ── GET /api/clases — todas (solo admin/curador) ───────────
r.get('/', ...gestion, (_req, res) => {
  res.json({ clases: listar('clases').slice().reverse().map(publicaClase) })
})

// ── GET /api/clases/docentes — docentes activos, para el selector
//    de "asignar clase a un docente" (curador no puede ver /api/admin/usuarios,
//    que es exclusivo de admin, así que se expone aquí lo mínimo). ──
r.get('/docentes', ...gestion, (_req, res) => {
  const docentes = listar('usuarios', (u) => u.rol === 'docente' && u.activo)
    .map((u) => ({ id: u.id, nombre: u.nombre, email: u.email }))
  res.json({ docentes })
})

// ── GET /api/clases/mias — las asignadas al docente logueado
//    (admin ve todas las activas: útil para lanzar actividades). ──
r.get('/mias', requiereAuth, requiereRol('admin', 'docente'), (req, res) => {
  const propias = listar('clases', (c) =>
    c.activa && (req.usuario.rol === 'admin' || c.docente_id === req.usuario.id))
  res.json({ clases: propias.slice().reverse().map(publicaClase) })
})

// ── POST /api/clases — crear clase ──────────────────────────
// Body: { nombre, periodo?, bookId?, docenteId? }
r.post('/', ...gestion, validar(crearClaseSchema), (req, res) => {
  const { nombre, periodo, bookId, docenteId } = req.body

  let docente_id = null
  if (docenteId) {
    const d = buscar('usuarios', (u) => u.id === docenteId && u.rol === 'docente')
    if (!d) return res.status(400).json({ error: 'El docente indicado no existe o no tiene ese rol.' })
    docente_id = d.id
  }

  const clase = insertar('clases', {
    nombre: nombre.trim(),
    periodo: periodo?.trim() || null,
    book_id: bookId ? Number(bookId) : null,
    docente_id,
    creado_por: req.usuario.id,
    activa: true,
    finalizada_en: null,
  })
  res.status(201).json({ clase: publicaClase(clase) })
})

// ── PATCH /api/clases/:id — editar clase ────────────────────
// Body: { nombre?, periodo?, bookId?, docenteId?, activa? }
r.patch('/:id', ...gestion, validar(editarClaseSchema), (req, res) => {
  const c = buscar('clases', (x) => x.id === req.params.id)
  if (!c) return res.status(404).json({ error: 'Clase no encontrada.' })
  const { nombre, periodo, bookId, docenteId, activa } = req.body
  const parche = {}
  if (nombre !== undefined) parche.nombre = nombre
  if (periodo !== undefined) parche.periodo = periodo || null
  if (bookId !== undefined) parche.book_id = bookId ? Number(bookId) : null
  if (docenteId !== undefined) {
    if (docenteId === null) {
      parche.docente_id = null
    } else {
      const d = buscar('usuarios', (u) => u.id === docenteId && u.rol === 'docente')
      if (!d) return res.status(400).json({ error: 'El docente indicado no existe o no tiene ese rol.' })
      parche.docente_id = d.id
    }
  }
  if (activa !== undefined) parche.activa = activa
  res.json({ clase: publicaClase(actualizar('clases', c.id, parche)) })
})

// ── POST /api/clases/:id/finalizar — cierra la clase y arranca la
//    ventana de retención para todos sus estudiantes activos ──────
// Distinto de "dar de baja" la clase (que solo la oculta del panel):
// finalizar es la señal explícita de "este curso terminó", que
// dispara el reloj de purga de identidad (fin de curso, punto 1).
r.post('/:id/finalizar', ...gestion, (req, res) => {
  const c = buscar('clases', (x) => x.id === req.params.id)
  if (!c) return res.status(404).json({ error: 'Clase no encontrada.' })
  if (c.finalizada_en) return res.status(409).json({ error: 'Esa clase ya fue finalizada.' })

  const ahora = new Date().toISOString()
  const activos = listar('estudiantes', (e) => e.clase_id === c.id && e.activo && !e.retiro_en)
  for (const e of activos) actualizar('estudiantes', e.id, { activo: false, retiro_en: ahora })

  const clase = actualizar('clases', c.id, { activa: false, finalizada_en: ahora })
  insertar('auditoria', {
    tipo: 'purga', accion: 'finalizar_clase', clase_id: c.id,
    estudiantes_afectados: activos.length,
    por: req.usuario.id, por_nombre: req.usuario.nombre,
  })
  res.json({
    clase: publicaClase(clase),
    mensaje: `Clase finalizada. ${activos.length} estudiante(s) entraron a la ventana de retención.`,
  })
})

// ── GET /api/clases/:id/estudiantes — roster de una clase ───
r.get('/:id/estudiantes', requiereAuth, requiereRol('admin', 'curador', 'docente'), (req, res) => {
  const c = buscar('clases', (x) => x.id === req.params.id)
  if (!c) return res.status(404).json({ error: 'Clase no encontrada.' })
  if (!puedeVer(c, req.usuario)) return res.status(403).json({ error: 'Esa clase no te fue asignada.' })
  const estudiantes = listar('estudiantes', (e) => e.clase_id === c.id).slice().reverse().map(publicaEstudiante)
  res.json({ clase: publicaClase(c), estudiantes })
})

// ── GET /api/clases/:id/exportar — CSV con el registro final ──
// Para que el instituto archive su copia oficial ANTES de que la
// identidad se purgue (nombre, código, puntaje). Después de purgar,
// las filas purgadas salen como "— (purgado)".
r.get('/:id/exportar', ...gestion, (req, res) => {
  const c = buscar('clases', (x) => x.id === req.params.id)
  if (!c) return res.status(404).json({ error: 'Clase no encontrada.' })

  const estudiantes = listar('estudiantes', (e) => e.clase_id === c.id)
  const filas = [['Nombre', 'Código de matrícula', 'Código externo', 'Estado', 'Actividades entregadas', 'Puntaje promedio', 'Purgado']]

  for (const e of estudiantes) {
    const resultados = listar('resultados', (res_) => res_.estudiante_id === e.id)
    const promedio = resultados.length
      ? Math.round(resultados.reduce((s, x) => s + (x.puntaje ?? 0), 0) / resultados.length)
      : ''
    filas.push([
      e.purgado_en ? '(purgado)' : descifrar(e.nombre),
      e.purgado_en ? '(purgado)' : e.codigo_matricula,
      e.purgado_en ? '' : (e.codigo_externo ?? ''),
      e.activo ? 'activo' : 'de baja',
      resultados.length,
      promedio,
      e.purgado_en ? `sí (${e.purgado_en.slice(0, 10)})` : 'no',
    ])
  }

  insertar('auditoria', {
    tipo: 'purga', accion: 'exportar_clase', clase_id: c.id, filas: estudiantes.length,
    por: req.usuario.id, por_nombre: req.usuario.nombre,
  })

  const nombreArchivo = `registro-${(c.nombre || 'clase').replace(/[^a-z0-9]+/gi, '-').toLowerCase()}.csv`
  res.setHeader('Content-Type', 'text/csv; charset=utf-8')
  res.setHeader('Content-Disposition', `attachment; filename="${nombreArchivo}"`)
  res.send('﻿' + csv(filas)) // BOM para que Excel detecte UTF-8
})

// ════════════════════════════════════════════════════════════════
// Panel del docente — clases → actividades → resultados (punto 4)
// ════════════════════════════════════════════════════════════════
// "Actividad" aquí = una SALA ya lanzada para esta clase (una actividad
// simple o una aventura, en una fecha concreta) — es lo que el docente
// reconoce como "la tarea que mandé el jueves". Se agrupan por día para
// que el docente ubique rápido la sesión que busca. Al entrar a una de
// esas salas se ve la lista de resultados (ordenable/filtrable en el
// navegador — el payload ya trae todo, no hace falta ida y vuelta al
// servidor para reordenar) y se puede exportar en CSV o en PDF con un
// mini-reporte con gráfica de barras (services nativos, sin librería de
// gráficos: pdfkit dibuja los rectángulos a mano).
// ════════════════════════════════════════════════════════════════

function resultadosDeSala(salaId) {
  return listar('resultados', (x) => x.sala_id === salaId)
}

function promedioDe(resultados) {
  if (!resultados.length) return null
  return Math.round(resultados.reduce((s, x) => s + (x.puntaje ?? 0), 0) / resultados.length)
}

function resumenActividad(sala) {
  const resultados = resultadosDeSala(sala.id)
  return {
    id: sala.id, codigo: sala.codigo, titulo: sala.titulo, modo: sala.modo,
    curso: sala.curso ?? null, activa: sala.activa, creado_en: sala.creado_en,
    totalResultados: resultados.length,
    promedio: promedioDe(resultados),
    pendientesRevision: resultados.filter((x) => x.requiere_revision).length,
  }
}

// 5 franjas de 20 puntos — suficiente para ver la forma de la
// distribución sin que la gráfica (en pantalla o en el PDF) se sature.
const FRANJAS_HISTOGRAMA = [
  { desde: 0, hasta: 20, etiqueta: '0–20' },
  { desde: 21, hasta: 40, etiqueta: '21–40' },
  { desde: 41, hasta: 60, etiqueta: '41–60' },
  { desde: 61, hasta: 80, etiqueta: '61–80' },
  { desde: 81, hasta: 100, etiqueta: '81–100' },
]
function histograma(resultados) {
  return FRANJAS_HISTOGRAMA.map((f) => ({
    etiqueta: f.etiqueta,
    cantidad: resultados.filter((x) => x.puntaje >= f.desde && x.puntaje <= f.hasta).length,
  }))
}

// ── Tendencia de un estudiante a lo largo del semestre (punto 7:
//    analítica pedagógica longitudinal) ─────────────────────────────
// Regresión lineal simple sobre el ÍNDICE cronológico de cada entrega
// (no sobre fechas de calendario: lo que importa es "¿subió o bajó
// entre una actividad y la siguiente?", no cuántos días pasaron).
// La pendiente se interpreta en puntos-por-actividad; ±3 puntos por
// actividad es un umbral bajo a propósito, para no callar una mejora
// o caída real detrás de "estable" — el docente decide qué hacer con
// la señal, esto solo la hace visible.
function tendenciaDe(puntos) {
  const n = puntos.length
  if (n < 2) return 'insuficiente'
  const xMedia = (n - 1) / 2
  const yMedia = puntos.reduce((s, p) => s + p.puntaje, 0) / n
  let num = 0
  let den = 0
  puntos.forEach((p, i) => {
    num += (i - xMedia) * (p.puntaje - yMedia)
    den += (i - xMedia) ** 2
  })
  const pendiente = den ? num / den : 0
  if (pendiente > 3) return 'subiendo'
  if (pendiente < -3) return 'bajando'
  return 'estable'
}

function claseYSalaOMuere(req, res) {
  const c = buscar('clases', (x) => x.id === req.params.id)
  if (!c) { res.status(404).json({ error: 'Clase no encontrada.' }); return null }
  if (!puedeVer(c, req.usuario)) { res.status(403).json({ error: 'Esa clase no te fue asignada.' }); return null }
  const sala = buscar('salas', (s) => s.id === req.params.salaId && s.clase_id === c.id)
  if (!sala) { res.status(404).json({ error: 'Actividad no encontrada en esta clase.' }); return null }
  return { c, sala }
}

// ── GET /api/clases/:id/actividades — bandeja de "mis clases" → esta
//    clase, con sus actividades lanzadas agrupadas por día ──────────
r.get('/:id/actividades', requiereAuth, requiereRol('admin', 'docente'), (req, res) => {
  const c = buscar('clases', (x) => x.id === req.params.id)
  if (!c) return res.status(404).json({ error: 'Clase no encontrada.' })
  if (!puedeVer(c, req.usuario)) return res.status(403).json({ error: 'Esa clase no te fue asignada.' })

  const salasClase = listar('salas', (s) => s.clase_id === c.id)
    .slice().sort((a, b) => new Date(b.creado_en) - new Date(a.creado_en))

  const porDia = new Map()
  for (const s of salasClase) {
    const fecha = s.creado_en.slice(0, 10) // YYYY-MM-DD, ya viene ordenado desc
    if (!porDia.has(fecha)) porDia.set(fecha, [])
    porDia.get(fecha).push(resumenActividad(s))
  }

  res.json({
    clase: publicaClase(c),
    dias: [...porDia.entries()].map(([fecha, actividades]) => ({ fecha, actividades })),
  })
})

// ── GET /api/clases/:id/progreso — progreso de CADA estudiante a
//    través de TODAS las actividades de la clase, en orden cronológico
//    (punto 7: "analítica pedagógica longitudinal más allá del puntaje
//    por actividad"). `/:id/actividades` de arriba ya deja ver el
//    promedio de una actividad puntual; esto es lo que le faltaba:
//    seguir a UN estudiante entre actividades para notar si mejora,
//    se estanca o empeora — no solo cómo le fue "el jueves".
//    Se ordena con los que más atención necesitan primero (promedio
//    más bajo), y respeta las mismas reglas de nombre/pseudónimo/purga
//    que el resto del panel (services/identidad.js).
r.get('/:id/progreso', requiereAuth, requiereRol('admin', 'docente'), (req, res) => {
  const c = buscar('clases', (x) => x.id === req.params.id)
  if (!c) return res.status(404).json({ error: 'Clase no encontrada.' })
  if (!puedeVer(c, req.usuario)) return res.status(403).json({ error: 'Esa clase no te fue asignada.' })

  const salaPorId = new Map(listar('salas', (s) => s.clase_id === c.id).map((s) => [s.id, s]))
  const resultadosClase = listar('resultados', (x) => salaPorId.has(x.sala_id))
    .slice().sort((a, b) => new Date(a.creado_en) - new Date(b.creado_en))

  const porEstudiante = new Map()
  for (const crudo of resultadosClase) {
    // Sin estudiante_id (sala suelta sin clase vinculada, nombre libre)
    // no hay identidad estable para agrupar entre actividades — se
    // agrupa por el nombre libre tal cual, a sabiendas de que dos
    // estudiantes con el mismo nombre se mezclarían; por eso el panel
    // de progreso solo tiene sentido pleno en clases con roster.
    const clave = crudo.estudiante_id ?? `libre:${crudo.estudiante ?? 'anonimo'}`
    const resuelto = conNombreResuelto(crudo, req.usuario.rol)
    const sala = salaPorId.get(crudo.sala_id)
    if (!porEstudiante.has(clave)) porEstudiante.set(clave, [])
    porEstudiante.get(clave).push({
      salaId: crudo.sala_id,
      actividad: sala?.titulo ?? '—',
      fecha: crudo.creado_en,
      puntaje: crudo.puntaje ?? 0,
      puntajeMaximo: crudo.puntaje_maximo ?? 100,
      estudiante: resuelto.estudiante,
      estudiantePurgado: resuelto.estudiantePurgado,
      estudiantePseudonimo: resuelto.estudiantePseudonimo,
    })
  }

  const estudiantes = [...porEstudiante.values()]
    .map((puntos) => ({
      estudiante: puntos[0].estudiante,
      estudiantePurgado: puntos[0].estudiantePurgado,
      estudiantePseudonimo: puntos[0].estudiantePseudonimo,
      totalActividades: puntos.length,
      promedio: promedioDe(puntos),
      tendencia: tendenciaDe(puntos),
      puntos: puntos.map(({ salaId, actividad, fecha, puntaje, puntajeMaximo }) =>
        ({ salaId, actividad, fecha, puntaje, puntajeMaximo })),
    }))
    .sort((a, b) => (a.promedio ?? 0) - (b.promedio ?? 0))

  res.json({ clase: publicaClase(c), estudiantes })
})

// ── GET /api/clases/:id/actividades/:salaId/resultados — resultados de
//    UNA actividad lanzada, con el nombre ya resuelto según el rol ────
r.get('/:id/actividades/:salaId/resultados', requiereAuth, requiereRol('admin', 'docente'), (req, res) => {
  const hallado = claseYSalaOMuere(req, res)
  if (!hallado) return
  const { c, sala } = hallado

  const crudos = resultadosDeSala(sala.id)
  const resultados = crudos.map((x) => conNombreResuelto(x, req.usuario.rol))

  res.json({
    clase: publicaClase(c),
    sala: {
      id: sala.id, codigo: sala.codigo, titulo: sala.titulo, modo: sala.modo,
      curso: sala.curso ?? null, activa: sala.activa, creado_en: sala.creado_en,
    },
    resultados,
    resumen: {
      total: resultados.length,
      promedio: promedioDe(crudos),
      pendientesRevision: resultados.filter((x) => x.requiere_revision).length,
      histograma: histograma(crudos),
    },
  })
})

// ── GET /api/clases/:id/actividades/:salaId/exportar.csv ───────────
r.get('/:id/actividades/:salaId/exportar.csv', requiereAuth, requiereRol('admin', 'docente'), (req, res) => {
  const hallado = claseYSalaOMuere(req, res)
  if (!hallado) return
  const { sala } = hallado

  const resultados = resultadosDeSala(sala.id).map((x) => conNombreResuelto(x, req.usuario.rol))
  const filas = [['Estudiante', 'Puntaje', 'Puntaje máximo', 'Requiere revisión', 'Fecha']]
  for (const resultado of resultados) {
    filas.push([
      resultado.estudiante, resultado.puntaje, resultado.puntaje_maximo,
      resultado.requiere_revision ? 'sí' : 'no',
      new Date(resultado.creado_en).toLocaleString('es-BO'),
    ])
  }

  const nombreArchivo = `resultados-${(sala.titulo || 'actividad').replace(/[^a-z0-9]+/gi, '-').toLowerCase()}.csv`
  res.setHeader('Content-Type', 'text/csv; charset=utf-8')
  res.setHeader('Content-Disposition', `attachment; filename="${nombreArchivo}"`)
  res.send('﻿' + csv(filas)) // BOM para que Excel detecte UTF-8
})

// ── GET /api/clases/:id/actividades/:salaId/exportar.pdf — reporte con
//    gráfica de barras de la distribución de puntajes + tabla ─────────
r.get('/:id/actividades/:salaId/exportar.pdf', requiereAuth, requiereRol('admin', 'docente'), (req, res) => {
  const hallado = claseYSalaOMuere(req, res)
  if (!hallado) return
  const { c, sala } = hallado

  const crudos = resultadosDeSala(sala.id)
  const resultados = crudos.map((x) => conNombreResuelto(x, req.usuario.rol))
    .sort((a, b) => (b.puntaje ?? 0) - (a.puntaje ?? 0))
  const promedio = promedioDe(crudos)
  const pendientes = resultados.filter((x) => x.requiere_revision).length
  const bins = histograma(crudos)

  const nombreArchivo = `reporte-${(sala.titulo || 'actividad').replace(/[^a-z0-9]+/gi, '-').toLowerCase()}.pdf`
  res.setHeader('Content-Type', 'application/pdf')
  res.setHeader('Content-Disposition', `attachment; filename="${nombreArchivo}"`)

  const doc = new PDFDocument({ margin: 50, size: 'A4' })
  doc.pipe(res)

  // ── Encabezado ──
  doc.fontSize(18).fillColor('#111').text('Reporte de resultados')
  doc.moveDown(0.3)
  doc.fontSize(10.5).fillColor('#555')
    .text(`Clase: ${c.nombre}${c.periodo ? ' · ' + c.periodo : ''}`)
    .text(`Actividad: ${sala.titulo} (${sala.modo === 'juego' ? 'aventura' : 'actividad simple'})`)
    .text(`Generado: ${new Date().toLocaleString('es-BO')}`)
  doc.fillColor('#111')
  doc.moveDown(1)

  doc.fontSize(11)
    .text(`Entregas: ${resultados.length}    Promedio: ${promedio ?? '—'}    Pendientes de revisión: ${pendientes}`)
  doc.moveDown(1.2)

  // ── Gráfica de barras: distribución de puntajes ──
  doc.fontSize(13).text('Distribución de puntajes', { underline: true })
  doc.moveDown(0.6)

  const chartX = doc.page.margins.left
  const chartTop = doc.y
  const chartWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right
  const chartHeight = 130
  const barGap = 16
  const barWidth = (chartWidth - barGap * (bins.length - 1)) / bins.length
  const maxCantidad = Math.max(1, ...bins.map((b) => b.cantidad))

  bins.forEach((b, i) => {
    const x = chartX + i * (barWidth + barGap)
    const alturaBarra = b.cantidad ? (b.cantidad / maxCantidad) * chartHeight : 0
    const y = chartTop + chartHeight - alturaBarra
    if (b.cantidad) doc.rect(x, y, barWidth, alturaBarra).fill('#4f6df5')
    doc.fillColor('#111').fontSize(9.5).text(String(b.cantidad), x, chartTop + chartHeight + 4, { width: barWidth, align: 'center' })
    doc.fillColor('#666').fontSize(8.5).text(b.etiqueta, x, chartTop + chartHeight + 18, { width: barWidth, align: 'center' })
  })
  doc.fillColor('#111')
  doc.y = chartTop + chartHeight + 40
  doc.x = chartX

  // ── Tabla: detalle por estudiante ──
  doc.moveDown(0.6)
  doc.fontSize(13).text('Detalle por estudiante', { underline: true })
  doc.moveDown(0.5)

  const colX = { nombre: doc.page.margins.left, puntaje: doc.page.margins.left + 230, revision: doc.page.margins.left + 300, fecha: doc.page.margins.left + 390 }
  const anchoFinal = doc.page.width - doc.page.margins.right

  function filaEncabezado(y) {
    doc.font('Helvetica-Bold').fontSize(9.5).fillColor('#111')
    doc.text('Estudiante', colX.nombre, y, { width: colX.puntaje - colX.nombre - 8 })
    doc.text('Puntaje', colX.puntaje, y, { width: colX.revision - colX.puntaje - 8 })
    doc.text('Revisión', colX.revision, y, { width: colX.fecha - colX.revision - 8 })
    doc.text('Fecha', colX.fecha, y, { width: anchoFinal - colX.fecha })
    doc.font('Helvetica')
  }

  let y = doc.y
  filaEncabezado(y)
  y += 16
  doc.moveTo(colX.nombre, y - 3).lineTo(anchoFinal, y - 3).strokeColor('#ccc').stroke()

  for (const x of resultados) {
    if (y > doc.page.height - doc.page.margins.bottom - 30) {
      doc.addPage()
      y = doc.page.margins.top
      filaEncabezado(y)
      y += 16
      doc.moveTo(colX.nombre, y - 3).lineTo(anchoFinal, y - 3).strokeColor('#ccc').stroke()
    }
    doc.fontSize(9.5).fillColor('#111')
    doc.text(x.estudiante ?? '—', colX.nombre, y, { width: colX.puntaje - colX.nombre - 8 })
    doc.text(`${x.puntaje ?? '—'} / ${x.puntaje_maximo ?? 100}`, colX.puntaje, y, { width: colX.revision - colX.puntaje - 8 })
    doc.text(x.requiere_revision ? 'pendiente' : '—', colX.revision, y, { width: colX.fecha - colX.revision - 8 })
    doc.text(new Date(x.creado_en).toLocaleDateString('es-BO', { day: '2-digit', month: '2-digit' })
      + ' ' + new Date(x.creado_en).toLocaleTimeString('es-BO', { hour: '2-digit', minute: '2-digit' }),
      colX.fecha, y, { width: anchoFinal - colX.fecha })
    y += 16
  }

  if (!resultados.length) {
    doc.fontSize(9.5).fillColor('#888').text('Todavía no hay entregas para esta actividad.', colX.nombre, y)
  }

  doc.end()
})

// ── POST /api/clases/:id/estudiantes/previsualizar — revisión antes
//    de confirmar la carga (dry-run, no escribe nada) ──────────────
// Body: { filas: [{ nombre, codigoExterno? }] }
// Detecta: nombres faltantes, duplicados dentro del lote pegado, y
// choques contra el roster ya existente de ESTA clase (nombre o
// código externo repetido) — el docente/curso/libro ya están fijos
// por la clase seleccionada, así que no aplica validarlos por fila.
r.post('/:id/estudiantes/previsualizar', ...gestion, validar(importarEstudiantesSchema), (req, res) => {
  const c = buscar('clases', (x) => x.id === req.params.id)
  if (!c) return res.status(404).json({ error: 'Clase no encontrada.' })
  res.json(validarLote(req.body.filas, c))
})

// ── POST /api/clases/:id/estudiantes — alta masiva de estudiantes ──
// Body: { filas: [{ nombre, codigoExterno? }] }  → un código de
// matrícula único (interno, para entrar a salas) por estudiante.
// `codigoExterno` es de referencia (código del instituto): se guarda
// tal cual, SIN reemplazar ni afectar el código de matrícula interno.
// El servidor vuelve a validar el lote completo (nunca confía en la
// revisión que ya hizo el navegador contra /previsualizar) y rechaza
// TODO el lote si algo sigue inválido, para que la corrección se haga
// en la grilla antes de reintentar. El import crea directamente en la
// tabla de IDENTIDAD (estudiantes), nunca en una tabla de acciones —
// ver domain notes arriba.
r.post('/:id/estudiantes', ...gestion, validar(importarEstudiantesSchema), (req, res) => {
  const c = buscar('clases', (x) => x.id === req.params.id)
  if (!c) return res.status(404).json({ error: 'Clase no encontrada.' })

  const revision = validarLote(req.body.filas, c)
  if (revision.resumen.invalidas > 0) {
    return res.status(400).json({
      error: 'Hay filas con problemas (duplicados o datos faltantes). Corrígelas y vuelve a intentar.',
      ...revision,
    })
  }

  const creados = revision.filas.map(({ nombre, codigoExterno }) => {
    const registro = insertar('estudiantes', {
      clase_id: c.id, nombre: cifrar(nombre), codigo_matricula: generarCodigoMatricula(),
      codigo_externo: codigoExterno, activo: true, retiro_en: null, purgado_en: null,
    })
    // Se devuelve el nombre en claro SOLO en esta respuesta (para
    // copiar/imprimir los códigos recién generados); nunca se guarda así.
    return { ...registro, nombre }
  })
  res.status(201).json({ estudiantes: creados })
})

// ── POST /api/clases/estudiantes/:id/baja — dar de baja (soft-delete) ──
// Arranca el reloj de retención de ESTE estudiante (retiro a mitad
// de semestre, sin esperar a que termine el curso).
r.post('/estudiantes/:id/baja', ...gestion, (req, res) => {
  const e = buscar('estudiantes', (x) => x.id === req.params.id)
  if (!e) return res.status(404).json({ error: 'Estudiante no encontrado.' })
  const parche = { activo: false }
  if (!e.retiro_en) parche.retiro_en = new Date().toISOString()
  res.json({ estudiante: publicaEstudiante(actualizar('estudiantes', e.id, parche)) })
})

// ── POST /api/clases/estudiantes/:id/purgar — purga manual inmediata ──
// Para un retiro a mitad de semestre donde no se quiere esperar la
// ventana de retención (ej. pedido explícito de la familia/instituto).
r.post('/estudiantes/:id/purgar', ...gestion, (req, res) => {
  const e = buscar('estudiantes', (x) => x.id === req.params.id)
  if (!e) return res.status(404).json({ error: 'Estudiante no encontrado.' })
  if (e.purgado_en) return res.status(409).json({ error: 'Ese estudiante ya fue purgado.' })

  if (e.activo || !e.retiro_en) {
    actualizar('estudiantes', e.id, { activo: false, retiro_en: e.retiro_en ?? new Date().toISOString() })
  }
  const resultado = purgarEstudiante(e.id, {
    motivo: 'manual', porId: req.usuario.id, porNombre: req.usuario.nombre,
  })
  if (!resultado.ok) return res.status(400).json({ error: resultado.error })
  res.json({ estudiante: publicaEstudiante(resultado.estudiante), redacciones_purgadas: resultado.redactados ?? 0 })
})

export default r
