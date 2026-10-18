// ============================================================
// rooms.routes.js — /api/rooms  y  /api/game
// ============================================================
// SALA = código de 5 dígitos que el docente proyecta.
// Dos modos:
//   modo 'simple' → una actividad suelta, sin escenarios.
//   modo 'juego'  → aventura con ruta ramificada por puntaje.
// ============================================================
import { Router } from 'express'
import rateLimit from 'express-rate-limit'
import { insertar, buscar, listar, actualizar, leccionPorId } from '../db/store.js'
import { requiereAuth, requiereRol, firmarTokenInvitado, mismaSala } from '../middleware/auth.js'
import { siguienteNodo, clasificar } from '../domain/routeBuilder.js'
import { resolverEscenario } from '../domain/scenes.js'
import { ACTIVITY_SCENES } from '../domain/activityScenes.js'
import { calificar } from '../domain/calificador.js'
import { armarRepaso } from '../services/repaso.js'
import { generarRetroalimentacion } from '../services/tutorIA.js'
import { esMismaPersona } from '../services/identidad.js'
import { totalVariantes, contenidoDeActividad, contenidosDeRuta, elegirVariante } from '../domain/variantes.js'
import { estadoIA } from '../services/gemini.js'
import { evaluarConTope } from '../services/evaluadorRedaccion.js'
import { logger } from '../services/logger.js'
import { validar } from '../middleware/validar.js'
import {
  crearSalaSchema, iniciarPartidaSchema, avanzarPartidaSchema, entregarSimpleSchema,
  retroalimentacionSchema,
} from '../schemas/rooms.schemas.js'

// ── Identidad vs. acciones ──────────────────────────────────
// Cuando el estudiante viene de una clase (tiene estudianteId), su
// nombre YA vive en la tabla `estudiantes` (identidad). Las acciones
// (partidas, resultados, revisiones) no vuelven a guardar el nombre:
// solo el estudiante_id. Así, purgar la identidad anonimiza todo el
// histórico sin tener que tocar cada fila de acción.
// Para estudiantes sin clase (sala suelta, nombre libre) no existe
// otra tabla de identidad que duplicar, así que el nombre se guarda
// como siempre — es el único registro que hay de esa persona.
function nombreParaAccion(usuario) {
  return usuario.estudianteId ? null : usuario.nombre
}

export const salas = Router()
export const juego = Router()

const DURACION_SALA_MS = 1000 * 60 * 60 * 6 // 6 horas

function generarCodigo() {
  let codigo
  do { codigo = String(Math.floor(10000 + Math.random() * 90000)) }
  while (buscar('salas', (s) => s.codigo === codigo && s.activa))
  return codigo
}

/** Empaqueta un nodo del grafo con todo lo que el frontend necesita para dibujarlo. */
function paqueteEscena(ruta, nodoId, contenidos) {
  const nodo = ruta.ruta.nodos[nodoId]
  if (!nodo) return null
  return {
    nodoId: nodo.id,
    etapa: nodo.etapa,
    totalEtapas: ruta.ruta.etapas,
    carril: nodo.carril,
    guion: nodo.guion,
    recorrido: nodo.recorrido,
    esFinal: nodo.esFinal,
    escena: resolverEscenario(nodo.escenario),
    leccionTitulo: ruta.leccion_titulo ?? null,
    autor: { nombre: ruta.autor_nombre ?? null, avatar: ruta.autor_avatar ?? null },
    actividad: {
      codigo: nodo.actividad,
      titulo: nodo.titulo,
      leccionTitulo: ruta.leccion_titulo ?? null,
      autor: { nombre: ruta.autor_nombre ?? null, avatar: ruta.autor_avatar ?? null },
      interaccion: nodo.interaccion,
      presencia: nodo.presencia,
      contenido: contenidos[nodo.actividad] ?? null,
    },
  }
}

// ══════════════════════════════════════════════════════════
//  SALAS
// ══════════════════════════════════════════════════════════

// POST /api/rooms — crear sala
// Body: { modo:'simple'|'juego', actividadId?, rutaId?, limiteEstudiantes? }
// La sala es SIEMPRE de la clase para la que se generó la actividad: el
// curso no se escribe, y cada estudiante entra con su doble código
// (sala + matrícula). Ahí le toca una variante al azar (/api/game/iniciar).
salas.post('/', requiereAuth, requiereRol('admin', 'docente'), validar(crearSalaSchema), (req, res) => {
  const { modo, actividadId, rutaId, limiteEstudiantes, claseId } = req.body

  let referencia, titulo
  if (modo === 'simple') {
    referencia = buscar('actividades', (a) => a.id === actividadId)
    if (!referencia) return res.status(404).json({ error: 'Actividad no encontrada.' })
    titulo = referencia.titulo
  } else {
    referencia = buscar('rutas', (a) => a.id === rutaId)
    if (!referencia) return res.status(404).json({ error: 'Ruta no encontrada.' })
    titulo = referencia.titulo
  }

  // La clase sale de la actividad (las variantes se generaron para SUS
  // estudiantes). Si el cliente manda otra, se rechaza en vez de lanzar
  // la actividad a un curso para el que no se preparó.
  const claseFinalId = referencia.clase_id ?? claseId ?? null
  if (!claseFinalId) {
    return res.status(400).json({ error: 'Esta actividad no está vinculada a ninguna clase: genérala de nuevo eligiendo tu clase.' })
  }
  if (claseId && referencia.clase_id && claseId !== referencia.clase_id) {
    return res.status(400).json({ error: 'Esta actividad se generó para otra clase.' })
  }
  const clase = buscar('clases', (c) => c.id === claseFinalId && c.activa)
  if (!clase) return res.status(404).json({ error: 'Clase no encontrada.' })
  if (req.usuario.rol !== 'admin' && clase.docente_id !== req.usuario.id) {
    return res.status(403).json({ error: 'Esa clase no te fue asignada.' })
  }

  // El curso ES la clase asignada (ya no se escribe a mano).
  const cursoFinal = clase.nombre

  // Límite de estudiantes que el docente fija (tope duro configurable hasta 30).
  const LIMITE_MAX = 30
  let limite = Number(limiteEstudiantes)
  if (!Number.isFinite(limite) || limite < 1) {
    // Sin número explícito: el cupo es la lista de estudiantes activos de la clase.
    limite = listar('estudiantes', (e) => e.clase_id === clase.id && e.activo).length || LIMITE_MAX
  }
  limite = Math.min(LIMITE_MAX, Math.max(1, Math.round(limite)))

  const sala = insertar('salas', {
    codigo: generarCodigo(),
    modo, titulo,
    curso: cursoFinal,
    limite_estudiantes: limite,
    estudiantes: [],            // nombres distintos que ya entraron
    actividad_id: modo === 'simple' ? referencia.id : null,
    ruta_id: modo === 'juego' ? referencia.id : null,
    clase_id: clase.id,
    docente_id: req.usuario.id,
    docente_nombre: req.usuario.nombre,
    activa: true,
    expira_en: new Date(Date.now() + DURACION_SALA_MS).toISOString(),
  })

  res.status(201).json({ sala })
})

// GET /api/rooms — salas del docente
salas.get('/', requiereAuth, requiereRol('admin', 'docente'), (req, res) => {
  const mias = listar('salas', (s) => req.usuario.rol === 'admin' || s.docente_id === req.usuario.id)
  res.json({ salas: mias.slice().reverse() })
})

// POST /api/rooms/:codigo/cerrar
salas.post('/:codigo/cerrar', requiereAuth, requiereRol('admin', 'docente'), (req, res) => {
  const s = buscar('salas', (x) => x.codigo === req.params.codigo)
  if (!s) return res.status(404).json({ error: 'Sala no encontrada.' })
  if (req.usuario.rol !== 'admin' && s.docente_id !== req.usuario.id) {
    return res.status(403).json({ error: 'Esa sala no es tuya.' })
  }
  actualizar('salas', s.id, { activa: false })
  res.json({ ok: true })
})

// GET /api/rooms/:codigo — info pública mínima (sin token)
salas.get('/:codigo', (req, res) => {
  const s = buscar('salas', (x) => x.codigo === req.params.codigo && x.activa)
  if (!s) return res.status(404).json({ error: 'Código incorrecto o sala cerrada.' })
  const dentro = (s.estudiantes ?? []).length
  res.json({ sala: {
    codigo: s.codigo, modo: s.modo, titulo: s.titulo,
    curso: s.curso ?? null,
    docente: s.docente_nombre,
    claseVinculada: Boolean(s.clase_id),
    cupo: { dentro, limite: s.limite_estudiantes ?? null },
  } })
})

// ══════════════════════════════════════════════════════════
//  JUEGO  (el estudiante ya trae token de invitado)
// ══════════════════════════════════════════════════════════

/**
 * Variante que le toca a este estudiante en esta sala. Si ya había
 * entrado antes (se reconectó), conserva la suya: volver a entrar no
 * sirve para "buscar" otras preguntas. Si es nuevo, al azar entre las
 * menos repartidas (domain/variantes.js).
 */
function varianteParaEstudiante(sala, registro, usuario) {
  const total = totalVariantes(registro)
  const previas = listar('partidas', (p) => p.sala_id === sala.id)
  const suya = previas.filter((p) => esMismaPersona(p, usuario) && p.variante).at(-1)
  if (suya && suya.variante <= total) return suya.variante
  return elegirVariante(total, previas.map((p) => p.variante ?? 1))
}

// POST /api/game/iniciar — Body: { codigo }
juego.post('/iniciar', requiereAuth, mismaSala(), validar(iniciarPartidaSchema), (req, res) => {
  const codigo = req.body.codigo ?? req.usuario.codigo
  const sala = buscar('salas', (s) => s.codigo === String(codigo) && s.activa)
  if (!sala) return res.status(404).json({ error: 'Sala cerrada o inexistente.' })

  // ── Cupo de estudiantes: el docente fija el límite; al llegar
  //    al tope la sala se cierra sola. Un mismo nombre no cuenta doble
  //    (para que reconectar no consuma un cupo extra). ──
  const nombre = req.usuario.nombre
  const yaDentro = (sala.estudiantes ?? []).includes(nombre)
  const dentro = (sala.estudiantes ?? []).length
  const limite = sala.limite_estudiantes ?? 30

  if (!yaDentro && dentro >= limite) {
    // Sala llena: se cierra y se rechaza al que llega tarde.
    actualizar('salas', sala.id, { activa: false, cerrada_por: 'cupo', cerrada_en: new Date().toISOString() })
    return res.status(409).json({ error: 'La sala alcanzó su cupo y se cerró.' })
  }

  if (!yaDentro) {
    const estudiantes = [...(sala.estudiantes ?? []), nombre]
    const parche = { estudiantes }
    // Si este estudiante completa el cupo, la sala se cierra tras admitirlo.
    if (estudiantes.length >= limite) {
      parche.activa = false
      parche.cerrada_por = 'cupo'
      parche.cerrada_en = new Date().toISOString()
    }
    actualizar('salas', sala.id, parche)
  }

  // ── Modo simple: se devuelve la actividad y ya ──
  if (sala.modo === 'simple') {
    const act = buscar('actividades', (a) => a.id === sala.actividad_id)
    if (!act) return res.status(404).json({ error: 'La actividad de esta sala ya no existe.' })
    const meta = ACTIVITY_SCENES[act.codigo]
    const variante = varianteParaEstudiante(sala, act, req.usuario)
    const partida = insertar('partidas', {
      sala_id: sala.id, codigo: sala.codigo, modo: 'simple',
      estudiante: nombreParaAccion(req.usuario), estudiante_id: req.usuario.estudianteId ?? null, estado: 'en_curso',
      variante,
      historial: [], puntajeTotal: 0,
    })
    return res.json({
      modo: 'simple',
      partidaId: partida.id,
      curso: sala.curso ?? null,
      token: firmarTokenInvitado({ salaId: sala.id, codigo: sala.codigo, nombre: req.usuario.nombre, partidaId: partida.id, estudianteId: req.usuario.estudianteId ?? null }),
      actividad: {
        codigo: act.codigo, titulo: act.titulo,
        curso: sala.curso ?? act.curso ?? null,
        leccionTitulo: act.leccion_titulo ?? null,
        autor: { nombre: act.autor_nombre ?? null, avatar: act.autor_avatar ?? null },
        interaccion: meta?.interaccion ?? 'ninguna',
        presencia: meta?.presencia ?? 'ninguna',
        contenido: contenidoDeActividad(act, variante),
      },
    })
  }

  // ── Modo juego: se arranca en el nodo inicial ──
  const ruta = buscar('rutas', (a) => a.id === sala.ruta_id)
  if (!ruta) return res.status(404).json({ error: 'La ruta de esta sala ya no existe.' })

  const variante = varianteParaEstudiante(sala, ruta, req.usuario)
  const partida = insertar('partidas', {
    sala_id: sala.id, codigo: sala.codigo, modo: 'juego',
    ruta_id: ruta.id,
    variante,
    estudiante: nombreParaAccion(req.usuario),
    estudiante_id: req.usuario.estudianteId ?? null,
    estado: 'en_curso',
    nodoActual: ruta.ruta.inicio,
    historial: [],
    puntajeTotal: 0,
  })

  res.json({
    modo: 'juego',
    partidaId: partida.id,
    curso: sala.curso ?? ruta.curso ?? null,
    token: firmarTokenInvitado({ salaId: sala.id, codigo: sala.codigo, nombre: req.usuario.nombre, partidaId: partida.id, estudianteId: req.usuario.estudianteId ?? null }),
    escena: paqueteEscena(ruta, ruta.ruta.inicio, contenidosDeRuta(ruta, variante)),
    progreso: { etapa: 1, totalEtapas: ruta.ruta.etapas, puntajeTotal: 0 },
  })
})

// ── Redacción (05): la evalúa la IA ──────────────────────────
// Solo contexto y escritura correcta (services/evaluadorRedaccion.js).
// La nota es PROVISIONAL: la entrega sigue pendiente de que el docente
// la confirme. Sin IA (o si tarda demasiado) queda sin nota, como antes.
const TOPE_EVALUACION_MS = 30_000

async function evaluarSiEsRedaccion(codigo, contenido, calificacion, nivel, alLlegarTarde) {
  if (codigo !== '05-redaccion') return calificacion
  const ev = await evaluarConTope(
    { nivel, contenido, texto: calificacion.detalle?.texto ?? '' },
    { ms: TOPE_EVALUACION_MS, alLlegarTarde },
  )
  return ev ? conEvaluacion(calificacion, ev) : calificacion
}
// La evaluación va aparte (no como intentos): el resumen final la muestra
// en su propio bloque, y el repaso de "aciertos" no aplica a un texto libre.
function conEvaluacion(calificacion, ev) {
  return { ...calificacion, puntaje: ev.total, detalle: { ...calificacion.detalle, evaluacion_ia: ev } }
}

/** Intentos de cada etapa del historial, en el formato que espera armarRepaso(). */
const etapasDe = (historial) => (historial ?? []).map((h) => ({ intentos: h.detalle?.intentos ?? [] }))

// POST /api/game/avanzar — Body: { partidaId, respuestas }
// Es el corazón de la lógica: respuestas → nota (calculada aquí) →
// escenario siguiente.
juego.post('/avanzar', requiereAuth, validar(avanzarPartidaSchema), async (req, res) => {
  const { partidaId, respuestas } = req.body
  const partida = buscar('partidas', (p) => p.id === partidaId)
  if (!partida) return res.status(404).json({ error: 'Partida no encontrada.' })
  if (!esMismaPersona(partida, req.usuario) || partida.codigo !== req.usuario.codigo) {
    return res.status(403).json({ error: 'Esa partida no es tuya.' })
  }
  if (partida.estado === 'terminada') return res.status(409).json({ error: 'La partida ya terminó.' })

  const ruta = buscar('rutas', (a) => a.id === partida.ruta_id)
  if (!ruta) return res.status(404).json({ error: 'Ruta no encontrada.' })

  const contenidos = contenidosDeRuta(ruta, partida.variante ?? 1)
  const nodo = ruta.ruta.nodos[partida.nodoActual]
  const calificacion = await evaluarSiEsRedaccion(nodo.actividad, contenidos[nodo.actividad],
    calificar(nodo.actividad, contenidos[nodo.actividad], respuestas), ruta.nivel ?? 'A2')
  // La partida pudo avanzar mientras la IA evaluaba (doble envío): no se pisa.
  const fresca = buscar('partidas', (p) => p.id === partidaId)
  if (fresca.estado === 'terminada' || fresca.nodoActual !== partida.nodoActual) {
    return res.status(409).json({ error: 'Esa etapa ya se entregó.' })
  }
  // Redacción sin evaluación de la IA cuenta como 0 para la ramificación,
  // igual que antes, cuando el navegador mandaba `puntaje ?? 0`.
  const normalizado = calificacion.puntaje ?? 0
  const resultado = clasificar(normalizado, ruta.ruta.umbrales)

  const historial = [...partida.historial, {
    nodoId: nodo.id, etapa: nodo.etapa, carril: nodo.carril,
    actividad: nodo.actividad, escenario: nodo.escenario,
    puntaje: normalizado, resultado, detalle: calificacion.detalle,
    en: new Date().toISOString(),
  }]
  const puntajeTotal = Math.round(historial.reduce((s, h) => s + h.puntaje, 0) / historial.length)

  const siguienteId = siguienteNodo(ruta.ruta, nodo.id, normalizado)

  // ── Fin de la aventura ──
  if (!siguienteId) {
    actualizar('partidas', partida.id, {
      estado: 'terminada', historial, puntajeTotal, nodoActual: null,
      terminada_en: new Date().toISOString(),
    })
    const requiereRevision = historial.some((h) => ACTIVITY_SCENES[h.actividad]?.requiereRevision)
    insertar('resultados', {
      partida_id: partida.id, sala_id: partida.sala_id, codigo: partida.codigo,
      modo: 'juego', estudiante: partida.estudiante ?? null, estudiante_id: partida.estudiante_id ?? null,
      ruta_id: ruta.id, ruta_titulo: ruta.titulo, variante: partida.variante ?? 1,
      lecciones: ruta.lecciones_ids.map((id) => leccionPorId(id)?.titulo).filter(Boolean),
      puntaje: puntajeTotal, puntaje_maximo: 100,
      requiere_revision: requiereRevision,
      recorrido: historial.map((h) => `${h.actividad}@${h.escenario}(${h.puntaje})`),
      historial,
    })
    return res.json({
      fin: true,
      resultado, puntajeEtapa: normalizado, puntajeTotal,
      resumen: historial.map((h) => ({
        etapa: h.etapa, actividad: h.actividad,
        titulo: ACTIVITY_SCENES[h.actividad]?.titulo ?? h.actividad,
        escenario: h.escenario,
        puntaje: h.puntaje, resultado: h.resultado,
      })),
      repaso: armarRepaso(etapasDe(historial), ruta.lecciones_ids),
      evaluacionIA: historial.find((h) => h.detalle?.evaluacion_ia)?.detalle.evaluacion_ia ?? null,
      iaDisponible: estadoIA().disponible,
    })
  }

  // ── Siguiente escena ──
  actualizar('partidas', partida.id, { nodoActual: siguienteId, historial, puntajeTotal })
  const escena = paqueteEscena(ruta, siguienteId, contenidos)

  res.json({
    fin: false,
    resultado,               // 'alto' | 'medio' | 'bajo'
    puntajeEtapa: normalizado,
    puntajeTotal,
    // Explicación de por qué se ramificó así — el frontend la muestra
    porQue: resultado === 'alto'
      ? 'Buen puntaje: subes al carril avanzado.'
      : resultado === 'bajo'
        ? 'Puntaje bajo: pasas a una actividad de refuerzo.'
        : 'Puntaje medio: sigues en el mismo carril.',
    escena,
    progreso: { etapa: escena.etapa, totalEtapas: escena.totalEtapas, puntajeTotal },
  })
})

// POST /api/game/entregar-simple — Body: { partidaId, respuestas }
juego.post('/entregar-simple', requiereAuth, validar(entregarSimpleSchema), async (req, res) => {
  const { partidaId, respuestas } = req.body
  const partida = buscar('partidas', (p) => p.id === partidaId)
  if (!partida) return res.status(404).json({ error: 'Partida no encontrada.' })
  if (!esMismaPersona(partida, req.usuario) || partida.codigo !== req.usuario.codigo) {
    return res.status(403).json({ error: 'Esa partida no es tuya.' })
  }
  if (partida.estado === 'terminada') return res.status(409).json({ error: 'Ya entregaste esta actividad.' })

  const sala = buscar('salas', (s) => s.id === partida.sala_id)
  const act = buscar('actividades', (a) => a.id === sala?.actividad_id)
  if (!act) return res.status(404).json({ error: 'La actividad de esta sala ya no existe.' })
  const contenido = contenidoDeActividad(act, partida.variante ?? 1)
  // Si la IA tarda más que el tope, la evaluación se guarda cuando llegue.
  let resultadoId = null
  const guardarTarde = (ev) => {
    const rdo = resultadoId && buscar('resultados', (x) => x.id === resultadoId)
    if (!rdo || !rdo.requiere_revision) return
    const c = conEvaluacion({ puntaje: null, detalle: rdo.detalle ?? {} }, ev)
    actualizar('resultados', rdo.id, { puntaje: c.puntaje, puntaje_provisional: true, detalle: c.detalle })
  }
  const calificacion = await evaluarSiEsRedaccion(act.codigo, contenido, calificar(act.codigo, contenido, respuestas),
    act.nivel ?? 'A2', guardarTarde)
  if (buscar('partidas', (p) => p.id === partidaId)?.estado === 'terminada') {
    return res.status(409).json({ error: 'Ya entregaste esta actividad.' })
  }
  const normalizado = calificacion.puntaje ?? 0

  // El historial de una partida simple tiene UNA etapa: así el resumen
  // y el tutor IA leen las dos modalidades de la misma forma.
  const historial = [{ actividad: act.codigo, puntaje: normalizado, detalle: calificacion.detalle }]
  actualizar('partidas', partida.id, {
    estado: 'terminada', puntajeTotal: normalizado, historial,
    terminada_en: new Date().toISOString(),
  })

  const requiereRevision = Boolean(ACTIVITY_SCENES[act?.codigo]?.requiereRevision)
  const resultado = insertar('resultados', {
    partida_id: partida.id, sala_id: partida.sala_id, codigo: partida.codigo,
    modo: 'simple', estudiante: partida.estudiante, estudiante_id: partida.estudiante_id ?? null,
    actividad_codigo: act?.codigo, actividad_titulo: act?.titulo, variante: partida.variante ?? 1,
    lecciones: (act?.lecciones_ids ?? []).map((id) => leccionPorId(id)?.titulo).filter(Boolean),
    puntaje: normalizado, puntaje_maximo: 100,
    requiere_revision: requiereRevision,
    // Nota de la IA (redacción) que el docente todavía debe confirmar.
    ...(calificacion.detalle?.evaluacion_ia ? { puntaje_provisional: true } : {}),
    detalle: calificacion.detalle,
  })
  resultadoId = resultado.id

  if (requiereRevision) {
    // El nombre NO se mete en `resumen` (texto opaco, no se puede
    // enmascarar después). Si hay identidad (estudiante_id), no se
    // duplica el nombre aquí en absoluto — se resuelve al leer, según
    // quién pregunte. Solo para salas sueltas sin clase (sin identidad
    // que duplicar) se guarda el nombre libre, tal como se hacía antes.
    insertar('revisiones', {
      tipo: 'entrega', referencia_id: resultado.id, estado: 'pendiente',
      enviado_por: null,
      enviado_por_estudiante_id: partida.estudiante_id ?? null,
      enviado_por_nombre: partida.estudiante ?? null,
      resumen: act?.titulo ?? act?.codigo ?? 'Entrega',
    })
  }

  res.json({
    ok: true, puntaje: normalizado, requiereRevision,
    evaluacionIA: calificacion.detalle?.evaluacion_ia ?? null,
    repaso: armarRepaso(etapasDe(historial), act.lecciones_ids),
    iaDisponible: estadoIA().disponible,
  })
})

// POST /api/game/retroalimentacion — Body: { partidaId }
// Comentario del tutor IA sobre los errores de una partida TERMINADA.
// Los errores se leen de lo que el servidor guardó al calificar — el
// navegador no puede mandar los suyos. Con caché por combinación de
// errores (services/tutorIA.js), pedirlo otra vez no gasta tokens.
// El freno por IP es holgado a propósito: una clase entera suele salir
// a internet por la misma IP del colegio.
const limiteRetro = rateLimit({
  windowMs: 60_000, max: 60,
  message: { error: 'Muchas solicitudes al tutor. Espera un minuto.' },
})

juego.post('/retroalimentacion', limiteRetro, requiereAuth, validar(retroalimentacionSchema), async (req, res) => {
  const partida = buscar('partidas', (p) => p.id === req.body.partidaId)
  if (!partida) return res.status(404).json({ error: 'Partida no encontrada.' })
  if (!esMismaPersona(partida, req.usuario) || partida.codigo !== req.usuario.codigo) {
    return res.status(403).json({ error: 'Esa partida no es tuya.' })
  }
  if (partida.estado !== 'terminada') return res.status(409).json({ error: 'Termina la actividad primero.' })

  let nivel = 'A2', leccionesIds = [], actividades = []
  if (partida.modo === 'juego') {
    const ruta = buscar('rutas', (a) => a.id === partida.ruta_id)
    nivel = ruta?.nivel ?? nivel
    leccionesIds = ruta?.lecciones_ids ?? []
    actividades = [...new Set((partida.historial ?? []).map((h) => ACTIVITY_SCENES[h.actividad]?.titulo ?? h.actividad))]
  } else {
    const sala = buscar('salas', (s) => s.id === partida.sala_id)
    const act = buscar('actividades', (a) => a.id === sala?.actividad_id)
    nivel = act?.nivel ?? nivel
    leccionesIds = act?.lecciones_ids ?? []
    actividades = [act?.titulo ?? act?.codigo].filter(Boolean)
  }

  const errores = armarRepaso(etapasDe(partida.historial), leccionesIds)?.errores ?? []
  if (errores.length && !estadoIA().disponible) {
    return res.status(503).json({ error: 'El tutor IA no está disponible en este momento.' })
  }

  try {
    const retro = await generarRetroalimentacion({ nivel, actividades, errores })
    res.json({ retroalimentacion: retro })
  } catch (e) {
    // El estudiante no necesita el detalle técnico (HTTP de Google,
    // modelo saturado…): con un mensaje claro le basta, y el resumen del
    // sistema sigue en pantalla. El detalle sí queda en el log.
    logger.warn({ err: e.message, status: e.status, partidaId: partida.id }, '[tutor IA] no se pudo generar la retroalimentación')
    const status = e.status === 422 ? 422 : 503
    res.status(status).json({ error: 'El tutor IA no pudo responder ahora. Inténtalo de nuevo en un momento.' })
  }
})

// GET /api/game/partida/:id — estado actual (para reanudar)
juego.get('/partida/:id', requiereAuth, (req, res) => {
  const p = buscar('partidas', (x) => x.id === req.params.id)
  if (!p) return res.status(404).json({ error: 'Partida no encontrada.' })
  if (p.codigo !== req.usuario.codigo && req.usuario.tipo === 'invitado') {
    return res.status(403).json({ error: 'No es tu partida.' })
  }
  const ruta = p.ruta_id ? buscar('rutas', (a) => a.id === p.ruta_id) : null
  res.json({
    partida: p,
    escena: ruta && p.nodoActual ? paqueteEscena(ruta, p.nodoActual, contenidosDeRuta(ruta, p.variante ?? 1)) : null,
  })
})
