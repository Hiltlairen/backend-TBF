// ============================================================
// activities.routes.js — /api/activities
// ============================================================
// Aquí se invocan los distintos ESCENARIOS que pide el cliente:
//   POST /generar         → 1 sola actividad (modo simple), en N variantes
//   POST /generar-ruta    → 6+ actividades encadenadas por LangGraph, en N variantes
//   POST /estimar         → cuántos tokens costaría generar (sin llamar a Gemini)
//   GET  /:id/hoja        → hoja de respuestas de una variante, para revisar antes de lanzar
//   GET  /estado-ia       → ¿está disponible la IA? (si no, solo vocabulario)
//   POST /estado-ia/comprobar → prueba Gemini ahora mismo
//   GET  /catalogo        → actividades + su escenario/interacción/presencia
//   GET  /escenarios      → catálogo de escenarios
//   GET  /uso             → telemetría de consumo de Gemini
// ============================================================
import { Router } from 'express'
import { config, tieneIA, tieneDB } from '../config.js'
import { requiereAuth, requiereRol } from '../middleware/auth.js'
import { vocabularioCompleto, leccionPorId, insertar, listar, buscar, libros as listarLibros } from '../db/store.js'
import { vocabularioDeBD } from '../db/pg.js'
import { generarVariantes } from '../services/graph/activityGraph.js'
import { consumo, estadoIA, callGemini, descripcionModelos } from '../services/gemini.js'
import { statsCache, limpiarCache, borrarCache } from '../services/cache.js'
import {
  ACTIVITY_SCENES, NOTAS_COHERENCIA, elegirEscenario, PREGUNTAS_CONFIG, preguntasDe, cantidadValida,
  catalogoOrdenadoPorDificultad, catalogoPorFranjas, NIVELES_DIFICULTAD,
  SOLO_VOCABULARIO, requiereIA,
} from '../domain/activityScenes.js'
import { listarEscenarios, resolverEscenario, INTERACCIONES, PRESENCIAS } from '../domain/scenes.js'
import { construirRuta, resumenRuta, UMBRALES_DEFAULT } from '../domain/routeBuilder.js'
import { validar } from '../middleware/validar.js'
import { vistaPreviaRutaSchema, generarActividadSchema, generarRutaSchema, estimarSchema } from '../schemas/activities.schemas.js'
import { revisarContenido } from '../services/moderacion.js'
import { estimarGeneracion, costoUSD } from '../services/costos.js'
import { hojaDeRespuestas } from '../domain/calificador.js'
import { totalVariantes, contenidoDeActividad, contenidosDeRuta } from '../domain/variantes.js'

const r = Router()

function specDe(codigo, escenarioId, cfg = {}) {
  const meta = ACTIVITY_SCENES[codigo]
  return {
    codigo,
    escenario: escenarioId ?? meta?.escenario ?? 'aula',
    interaccion: meta?.interaccion ?? 'ninguna',
    presencia: meta?.presencia ?? 'ninguna',
    // La cantidad se valida contra el rango de la actividad. Las
    // de formato fijo (canción, redacción) ignoran lo que pidan.
    cantidad: cantidadValida(codigo, cfg.cantidad),
    tiempo: cfg.tiempo ?? 120,
    penalizacion: cfg.penalizacion ?? 10,
  }
}

function cargarLecciones(ids) {
  const ls = (ids ?? []).map((id) => leccionPorId(id)).filter(Boolean)
  if (!ls.length) { const e = new Error('No se encontraron esas lecciones.'); e.status = 400; throw e }
  return ls
}

// El NIVEL ya no lo elige el docente: lo determina el LIBRO.
// 1A → A1, 1B → A2 (viene en content.json / tabla books).
function nivelDeLecciones(ls) {
  const bookId = ls[0]?.book_id
  const libro = listarLibros().find((b) => b.id === bookId)
  return libro?.nivel ?? 'A2'
}

// Extrae el DICCIONARIO para el agente. Si hay BD, consulta el
// vocabulario fresco en Postgres; si no (o si la consulta falla),
// cae al vocabulario del store en memoria.
async function cargarVocabulario(lessonIds) {
  if (tieneDB()) {
    const deBD = await vocabularioDeBD(lessonIds)
    if (deBD && deBD.length) return deBD
  }
  return vocabularioCompleto(lessonIds)
}

// Foto de perfil del docente/curador/admin que crea la actividad
function autorAvatar(usuarioId) {
  return buscar('usuarios', (u) => u.id === usuarioId)?.avatar ?? null
}

// Guarda el registro de CADA generación con su consumo de tokens.
// El contenido ya queda en 'actividades'/'rutas'; esto es la bitácora
// de auditoría (quién generó qué, cuándo y cuántos tokens costó).
// `estimacion` es lo que services/costos.js predijo ANTES de generar: se
// guarda junto al gasto real para que las próximas estimaciones se
// calibren solas (ver calibracion() en costos.js).
function registrarGeneracion({ tipo, referencia_id, autor, codigo, nivel, curso, claseId, telemetria, estimacion, variantes }) {
  const sinCalibrar = estimacion?.sinCalibrar
  insertar('generaciones', {
    tipo, referencia_id, autor, codigo: codigo ?? null, nivel, curso: curso ?? null,
    clase_id: claseId ?? null,
    llamadas_gemini: telemetria?.llamadasGemini ?? 0,
    tokens_entrada: telemetria?.tokensEntrada ?? 0,
    tokens_salida: telemetria?.tokensSalida ?? 0,
    tokens_estimados: sinCalibrar ? sinCalibrar.entrada + sinCalibrar.salida : null,
    variantes_pedidas: telemetria?.variantesPedidas ?? 1,
    variantes: variantes ?? 0,
    desde_cache: Boolean(telemetria?.desdeCache),
    modo_local: Boolean(telemetria?.modoLocal),
    modelo: descripcionModelos(),
    // Qué pasó en cada llamada (bible, lote, rechazos de validación con su
    // motivo, reparaciones): explica por qué una generación costó más de
    // lo estimado. Ej.: "v3 · validar: 1 rechazadas → 15-laberinto-palabras (...)".
    traza: (telemetria?.traza ?? []).slice(0, 120),
    // { deepseek: { llamadas, entrada, salida }, gemini: {...} }
    por_proveedor: telemetria?.porProveedor ?? {},
  })
}

// ── Variantes ──────────────────────────────────────────────
// Cada actividad/aventura se genera en VARIOS juegos de preguntas
// (variantes) que la sala reparte al azar entre los estudiantes de la
// clase cuando entran con su código (rooms.routes.js → elegirVariante).
// Cuántas: según los estudiantes activos de la clase (tope 30). Con IA,
// como mucho config.variantesIA (cada una cuesta tokens); sin IA, una
// por estudiante (se arman localmente, gratis).
const MAX_ESTUDIANTES_SALA = 30

function estudiantesDeClase(clase) {
  return listar('estudiantes', (e) => e.clase_id === clase.id && e.activo).length
}

function cuantasVariantes(clase, conIA) {
  const cupo = Math.max(1, Math.min(MAX_ESTUDIANTES_SALA, estudiantesDeClase(clase)))
  return conIA ? Math.max(1, Math.min(cupo, config.variantesIA)) : cupo
}

/** Separa las variantes cuyo texto pasa la moderación de las que no. */
function moderarVariantes(variantes, textoDe) {
  const limpias = []
  const bloqueadas = []
  for (const v of variantes) {
    const revision = revisarContenido(textoDe(v))
    if (revision.limpio) limpias.push(v)
    else bloqueadas.push({ ...v, hallazgos: revision.hallazgos })
  }
  return { limpias, bloqueadas }
}

/** Audita lo bloqueado y lo saca de la caché: sin esto, "genera de
 *  nuevo" traería el mismo contenido marcado de vuelta (ver cache.js). */
function descartarBloqueadas(bloqueadas, { origen, codigo, usuario }) {
  if (!bloqueadas.length) return
  for (const v of bloqueadas) borrarCache(v.cacheKey)
  insertar('auditoria', {
    tipo: 'moderacion', accion: 'contenido_bloqueado', origen, codigo,
    variantes_bloqueadas: bloqueadas.length,
    categorias: [...new Set(bloqueadas.flatMap((v) => v.hallazgos.map((h) => h.categoria)))],
    por: usuario.id, por_nombre: usuario.nombre,
  })
}

// Telemetría para el docente: tokens reales, su costo, lo que se había
// estimado antes de generar y cuántas variantes quedaron.
function conCosto(telemetria, estimacion, variantes) {
  const entrada = telemetria?.tokensEntrada ?? 0
  const salida = telemetria?.tokensSalida ?? 0
  // El desglose por proveedor queda solo en la bitácora (generaciones):
  // la interfaz no muestra qué proveedor de IA se usa.
  const { porProveedor: _soloBitacora, ...publica } = telemetria ?? {}
  return {
    ...publica,
    tokensTotal: entrada + salida,
    costoUSD: costoUSD({ entrada, salida }),
    estimado: estimacion ? { total: estimacion.total, costoUSD: estimacion.costoUSD } : null,
    variantes,
  }
}

// Specs de una aventura: el grafo decide en qué escenario cae cada
// actividad. Se usa al generar y al estimar, así los dos calculan la
// MISMA clave de caché.
function specsDeRuta({ actividades, etapas, umbrales, configs = {} }) {
  const ruta = construirRuta(actividades, { etapas, umbrales })
  const escenarioPorActividad = {}
  for (const n of Object.values(ruta.nodos)) {
    escenarioPorActividad[n.actividad] ??= n.escenario
  }
  const specs = ruta.actividadesRequeridas.map((c) =>
    specDe(c, escenarioPorActividad[c], configs[c] ?? {})
  )
  return { ruta, specs }
}

const specsSimple = (codigo, cfg = {}, cantidad) =>
  [specDe(codigo, cfg.escenario, { ...cfg, cantidad: cantidad ?? cfg.cantidad })]

// ── Sin IA ─────────────────────────────────────────────────
// Cuando Gemini no está disponible (sin cuota, saturado, sin internet,
// sin API key) solo se generan las actividades de vocabulario
// (SOLO_VOCABULARIO), que se arman localmente a 0 tokens. Para el resto
// se responde 503 con lo necesario para que el panel las deshabilite.
function respuestaSinIA(ia, codigos) {
  const titulos = codigos.map((c) => `"${ACTIVITY_SCENES[c]?.titulo ?? c}"`)
  return {
    error: `La IA no está disponible: ${ia.mensaje}. ` +
      `${titulos.length === 1 ? `${titulos[0]} la necesita` : `Estas actividades la necesitan: ${titulos.join(', ')}`}. ` +
      'Mientras tanto puedes usar las actividades de vocabulario, que se arman sin IA y no gastan tokens.',
    sinIA: true,
    ia,
    requierenIA: codigos,
    soloVocabulario: [...SOLO_VOCABULARIO],
  }
}

/** Estado de la IA tras una generación que cayó al modo local a mitad de camino. */
function iaTrasFallo() {
  const ia = estadoIA()
  return ia.disponible ? { disponible: false, motivo: 'fallo', mensaje: 'la IA falló al generar esta vez' } : ia
}

// La clase es OBLIGATORIA: el docente solo genera para los cursos que le
// asignaron (el admin, para cualquiera), y el "curso" de la actividad
// es el nombre de esa clase — ya no se escribe a mano.
function resolverClase(claseId, usuario) {
  if (!claseId) { const e = new Error('Elige una de tus clases.'); e.status = 400; throw e }
  const clase = buscar('clases', (c) => c.id === claseId && c.activa)
  if (!clase) { const e = new Error('Clase no encontrada.'); e.status = 404; throw e }
  if (usuario.rol !== 'admin' && clase.docente_id !== usuario.id) {
    const e = new Error('Esa clase no te fue asignada.'); e.status = 403; throw e
  }
  return clase
}

// ── GET /catalogo ──────────────────────────────────────────
// El catálogo viaja YA ORDENADO de menor a mayor dificultad (1→5):
// es el mismo orden en el que está escrito activityScenes.js. Además
// se manda agrupado en franjas (`franjas`) para que el panel del
// docente pueda pintar las 5 secciones sin tener que reordenar nada
// del lado del cliente.
r.get('/catalogo', requiereAuth, (_req, res) => {
  const catalogo = catalogoOrdenadoPorDificultad().map((a) => ({
    ...a, escenarioResuelto: resolverEscenario(a.escenario),
    preguntas: preguntasDe(a.codigo),
  }))
  const franjas = catalogoPorFranjas().map((f) => ({
    ...f,
    actividades: f.actividades.map((a) => ({
      ...a, escenarioResuelto: resolverEscenario(a.escenario), preguntas: preguntasDe(a.codigo),
    })),
  }))
  res.json({
    catalogo, franjas, nivelesDificultad: NIVELES_DIFICULTAD,
    notasCoherencia: NOTAS_COHERENCIA, preguntasConfig: PREGUNTAS_CONFIG,
    ia: estadoIA(),
  })
})

// ── GET /estado-ia ─────────────────────────────────────────
r.get('/estado-ia', requiereAuth, requiereRol('admin', 'curador', 'docente'), (_req, res) => {
  res.json({ ia: estadoIA() })
})

// ── POST /estado-ia/comprobar ──────────────────────────────
// "Comprobar ahora": una llamada mínima a Gemini aunque la IA esté en
// pausa. Si responde, la IA se vuelve a habilitar para todos; si no, la
// pausa se renueva. Cuesta unos pocos tokens.
r.post('/estado-ia/comprobar', requiereAuth, requiereRol('admin', 'docente'), async (_req, res) => {
  if (estadoIA().motivo !== 'sin_clave') {
    try {
      await callGemini('Responde SOLO este JSON: {"ok":true}', { maxOutputTokens: 256, reintentos: 0, forzar: true })
    } catch { /* el estado ya quedó actualizado por el disyuntor */ }
  }
  res.json({ ia: estadoIA() })
})

// ── GET /escenarios ────────────────────────────────────────
r.get('/escenarios', requiereAuth, (_req, res) => {
  res.json({
    escenarios: listarEscenarios().map((e) => resolverEscenario(e.id)),
    interacciones: INTERACCIONES,
    presencias: PRESENCIAS,
  })
})

// ── POST /vista-previa-ruta ────────────────────────────────
// Arma el grafo SIN llamar a Gemini. Sirve para que el docente
// vea las ramas antes de gastar tokens.
r.post('/vista-previa-ruta', requiereAuth, requiereRol('admin', 'docente'), validar(vistaPreviaRutaSchema), (req, res) => {
  const { actividades, etapas, umbrales } = req.body
  try {
    const ruta = construirRuta(actividades, { etapas: etapas ?? config.etapasPorDefecto, umbrales })
    res.json({ ruta, resumen: resumenRuta(ruta), actividadesAGenerar: ruta.actividadesRequeridas.length })
  } catch (e) {
    res.status(400).json({ error: e.message })
  }
})

// ── POST /generar ──────────────────────────────────────────
// MODO SIMPLE: una sola actividad, sin juego ni escenarios, en tantas
// VARIANTES como pida la clase (ver cuantasVariantes).
// Body: { codigo, lecciones:[ids], claseId, cantidad, config }
// El NIVEL se deriva del libro y el CURSO es el nombre de la clase.
r.post('/generar', requiereAuth, requiereRol('admin', 'docente'), validar(generarActividadSchema), async (req, res, next) => {
  try {
    const { codigo, lecciones: ids, cantidad, config: cfg = {}, claseId } = req.body
    if (!ACTIVITY_SCENES[codigo]) return res.status(400).json({ error: `Actividad desconocida: ${codigo}` })
    const clase = resolverClase(claseId, req.usuario)
    const ia = estadoIA()
    if (!ia.disponible && requiereIA(codigo)) return res.status(503).json(respuestaSinIA(ia, [codigo]))

    const ls = cargarLecciones(ids)
    const nivel = nivelDeLecciones(ls)
    const vocab = await cargarVocabulario(ls.map((l) => l.id))
    if (!vocab.length) return res.status(400).json({ error: 'Esas lecciones no tienen vocabulario.' })

    const specs = specsSimple(codigo, cfg, cantidad)
    const [spec] = specs
    const pedidas = cuantasVariantes(clase, ia.disponible)
    const estimacion = estimarGeneracion({ vocabulario: vocab, lecciones: ls, nivel, specs, variantes: pedidas })
    const salida = await generarVariantes({
      vocabulario: vocab, lecciones: ls, nivel, specs, cantidad: pedidas, sinIA: ia.disponible ? null : ia,
    })
    // Los tokens se gastaron aunque el resultado no sirva: también se
    // registran los intentos fallidos o bloqueados.
    const registrar = (referencia_id, variantes) => registrarGeneracion({
      tipo: 'actividad', referencia_id, autor: req.usuario.id, codigo, nivel, curso: clase.nombre,
      claseId: clase.id, telemetria: salida.telemetria, estimacion, variantes,
    })

    // Variantes que sí trajeron la actividad (una que cayó al generador
    // local no tiene las que necesitan IA: no inventa texto).
    const conDatos = salida.variantes.filter((v) => v.actividades[codigo])
    if (!conDatos.length) {
      registrar(null, 0)
      if (salida.telemetria.modoLocal) return res.status(503).json(respuestaSinIA(iaTrasFallo(), [codigo]))
      return res.status(502).json({
        error: 'La IA no devolvió una actividad válida.',
        detalle: salida.variantes[0]?.fallidas,
      })
    }

    // ── Moderación automática (punto 5) ──────────────────────────
    // Revisa lo que Gemini generó para MOSTRARLE al estudiante, antes de
    // guardarlo. Una variante marcada se descarta; si caen todas, 422.
    const { limpias, bloqueadas } = moderarVariantes(conDatos, (v) => v.actividades[codigo])
    descartarBloqueadas(bloqueadas, { origen: 'generar', codigo, usuario: req.usuario })
    if (!limpias.length) {
      registrar(null, 0)
      return res.status(422).json({
        error: 'El contenido generado no pasó el filtro automático de moderación. Genera de nuevo — a veces basta con volver a pedirlo.',
      })
    }

    const variantes = limpias.map((v) => v.actividades[codigo])
    const guardada = insertar('actividades', {
      codigo, nivel, modo: 'simple',
      curso: clase.nombre,
      clase_id: clase.id,
      cantidad: spec.cantidad,
      lecciones_ids: ls.map((l) => l.id),
      lecciones_titulos: ls.map((l) => ({ id: l.id, numero: l.numero, titulo: l.titulo })),
      leccion_titulo: ls.map((l) => `L${l.numero} · ${l.titulo}`).join(' + '),
      titulo: variantes[0].actividad?.titulo ?? codigo,
      // `contenido` = variante 1 (lo que leen la curaduría y los registros
      // anteriores a las variantes); `variantes` = todas, en orden.
      contenido: variantes[0],
      variantes,
      autor: req.usuario.id,
      autor_nombre: req.usuario.nombre,
      autor_avatar: autorAvatar(req.usuario.id),
      estado: ACTIVITY_SCENES[codigo].requiereRevision ? 'en_curaduria' : 'aprobada',
    })

    // Registro de consumo de tokens de ESTA generación (auditoría)
    registrar(guardada.id, variantes.length)

    if (guardada.estado === 'en_curaduria') {
      insertar('revisiones', {
        tipo: 'actividad', referencia_id: guardada.id, estado: 'pendiente',
        enviado_por: req.usuario.id, enviado_por_nombre: req.usuario.nombre,
        resumen: `${guardada.titulo} — ${codigo}`,
      })
    }

    res.status(201).json({
      actividad: guardada,
      telemetria: conCosto(salida.telemetria, estimacion, {
        pedidas, generadas: variantes.length,
        incompletas: salida.variantes.length - conDatos.length,
        bloqueadas: bloqueadas.length,
      }),
    })
  } catch (e) { next(e) }
})

// ── POST /generar-ruta ─────────────────────────────────────
// MODO JUEGO: arma el grafo y genera TODAS las actividades con
// LangGraph (bible + lote para la variante 1; 1 llamada por cada
// variante más). Todas las variantes comparten el grafo y la historia.
// Body: { actividades:[codigos>=6], lecciones:[ids], claseId, etapas, umbrales, configs:{codigo:{...}} }
r.post('/generar-ruta', requiereAuth, requiereRol('admin', 'docente'), validar(generarRutaSchema), async (req, res, next) => {
  try {
    const {
      actividades, lecciones: ids,
      etapas = config.etapasPorDefecto, umbrales = UMBRALES_DEFAULT, configs = {}, claseId,
    } = req.body
    const clase = resolverClase(claseId, req.usuario)

    const { ruta, specs } = specsDeRuta({ actividades, etapas, umbrales, configs })
    const ia = estadoIA()
    const conIA = specs.map((x) => x.codigo).filter(requiereIA)
    if (!ia.disponible && conIA.length) return res.status(503).json(respuestaSinIA(ia, conIA))
    const ls = cargarLecciones(ids)
    const nivel = nivelDeLecciones(ls)   // el nivel lo fija el libro, no el docente
    const vocab = await cargarVocabulario(ls.map((l) => l.id))
    if (!vocab.length) return res.status(400).json({ error: 'Esas lecciones no tienen vocabulario.' })

    const pedidas = cuantasVariantes(clase, ia.disponible)
    const estimacion = estimarGeneracion({ vocabulario: vocab, lecciones: ls, nivel, specs, variantes: pedidas })
    const salida = await generarVariantes({
      vocabulario: vocab, lecciones: ls, nivel, specs, cantidad: pedidas, sinIA: ia.disponible ? null : ia,
    })
    const registrar = (referencia_id, variantes) => registrarGeneracion({
      tipo: 'ruta', referencia_id, autor: req.usuario.id, codigo: actividades.join('+'), nivel,
      curso: clase.nombre, claseId: clase.id, telemetria: salida.telemetria, estimacion, variantes,
    })

    const [primera] = salida.variantes
    // Gemini se cayó desde el principio: no se "rellena" la aventura con
    // otras actividades a escondidas — se le dice al docente cuáles
    // necesitan IA para que decida.
    if (primera.modoLocal && conIA.length) {
      registrar(null, 0)
      return res.status(503).json(respuestaSinIA(iaTrasFallo(), conIA))
    }

    // Si alguna quedó rota en la variante 1, se poda el grafo: los nodos
    // que la usaban caen a una actividad válida.
    const validas = Object.keys(primera.actividades)
    if (!validas.length) {
      registrar(null, 0)
      return res.status(502).json({ error: 'No se pudo generar ninguna actividad.', detalle: primera.fallidas })
    }
    for (const n of Object.values(ruta.nodos)) {
      if (!validas.includes(n.actividad)) {
        const reemplazo = validas[0]
        n.actividadOriginal = n.actividad
        n.actividad = reemplazo
        n.escenario = elegirEscenario(reemplazo, [])
        n.degradado = true
      }
    }

    // Todas las variantes recorren el MISMO grafo: solo sirven las que
    // traen todas las actividades válidas (una que cayó al generador
    // local a mitad de camino no trae las que necesitan IA).
    const completas = salida.variantes
      .filter((v) => validas.every((c) => v.actividades[c]))
      .map((v) => ({ ...v, contenidos: Object.fromEntries(validas.map((c) => [c, v.actividades[c]])) }))

    // ── Moderación automática (punto 5) — ver nota en /generar ──
    // La historia (bible) es común a todas: si ella no pasa, no pasa ninguna.
    const { limpias, bloqueadas } = moderarVariantes(completas, (v) => ({ actividades: v.contenidos, bible: salida.bible }))
    descartarBloqueadas(bloqueadas, { origen: 'generar-ruta', codigo: actividades.join('+'), usuario: req.usuario })
    if (!limpias.length) {
      registrar(null, 0)
      return res.status(422).json({
        error: 'El contenido generado no pasó el filtro automático de moderación. Genera de nuevo — a veces basta con volver a pedirlo.',
      })
    }

    const variantes = limpias.map((v) => v.contenidos)
    const guardada = insertar('rutas', {
      nivel, etapas, umbrales,
      curso: clase.nombre,
      clase_id: clase.id,
      lecciones_ids: ls.map((l) => l.id),
      lecciones_titulos: ls.map((l) => ({ id: l.id, numero: l.numero, titulo: l.titulo })),
      leccion_titulo: ls.map((l) => `L${l.numero} · ${l.titulo}`).join(' + '),
      titulo: `Aventura · ${ls.map((l) => `L${l.numero}`).join('+')} · ${nivel}`,
      ruta,
      // `contenidos` = variante 1; `variantes` = todas (mismo grafo).
      contenidos: variantes[0],
      variantes,
      bible: salida.bible,
      autor: req.usuario.id,
      autor_nombre: req.usuario.nombre,
      autor_avatar: autorAvatar(req.usuario.id),
      estado: 'aprobada',
    })

    registrar(guardada.id, variantes.length)

    res.status(201).json({
      ruta: guardada,
      resumen: resumenRuta(ruta),
      fallidas: primera.fallidas,
      telemetria: conCosto(salida.telemetria, estimacion, {
        pedidas, generadas: variantes.length,
        incompletas: salida.variantes.length - completas.length,
        bloqueadas: bloqueadas.length,
      }),
    })
  } catch (e) { next(e) }
})

// ── POST /estimar ──────────────────────────────────────────
// Cuánto costaría generar una actividad o aventura con todas sus
// variantes, SIN llamar a Gemini. El panel lo muestra antes de que el
// docente gaste tokens. Ver services/costos.js.
r.post('/estimar', requiereAuth, requiereRol('admin', 'docente'), validar(estimarSchema), async (req, res, next) => {
  try {
    const { modo, codigo, actividades, lecciones: ids, cantidad, config: cfg = {}, configs = {}, umbrales, claseId } = req.body
    const etapas = req.body.etapas ?? config.etapasPorDefecto
    const clase = resolverClase(claseId, req.usuario)

    let specs
    if (modo === 'simple') {
      if (!ACTIVITY_SCENES[codigo]) return res.status(400).json({ error: `Actividad desconocida: ${codigo}` })
      specs = specsSimple(codigo, cfg, cantidad)
    } else {
      try { ({ specs } = specsDeRuta({ actividades: actividades ?? [], etapas, umbrales, configs })) }
      catch (e) { return res.status(400).json({ error: e.message }) }
    }

    const ls = cargarLecciones(ids)
    const nivel = nivelDeLecciones(ls)
    const vocab = await cargarVocabulario(ls.map((l) => l.id))
    // Sin IA no se llama a Gemini: lo que se pueda armar sale gratis del
    // generador local (o de la caché, si ya estaba hecho con IA).
    const ia = estadoIA()
    const variantes = cuantasVariantes(clase, ia.disponible)
    const est = estimarGeneracion({ vocabulario: vocab, lecciones: ls, nivel, specs, variantes })
    const sinIA = !ia.disponible && !est.desdeCache

    res.json({
      estimacion: sinIA
        ? { entrada: 0, salida: 0, total: 0, costoUSD: 0, desdeCache: false, sinIA: true, muestrasCalibracion: 0, variantes }
        : {
          entrada: est.entrada, salida: est.salida, total: est.total, costoUSD: est.costoUSD,
          desdeCache: est.desdeCache, muestrasCalibracion: est.calibracion?.muestras ?? 0,
          variantes, variantesEnCache: est.variantesEnCache,
        },
      ia,
      requierenIA: ia.disponible ? [] : specs.map((x) => x.codigo).filter(requiereIA),
      variantes,
      estudiantes: estudiantesDeClase(clase),
      maxVariantesIA: config.variantesIA,
      preciosConfigurados: costoUSD({ entrada: 1, salida: 1 }) != null,
    })
  } catch (e) { next(e) }
})

// ── GET /:id/hoja?variante=N ───────────────────────────────
// Lo que generó la IA, legible para el docente ANTES de lanzarlo: cada
// pregunta con su respuesta correcta (domain/calificador.js), de UNA
// variante (la 1 por defecto). Para una aventura, una sección por
// actividad y la historia que las une.
r.get('/:id/hoja', requiereAuth, requiereRol('admin', 'curador', 'docente'), (req, res) => {
  const act = buscar('actividades', (x) => x.id === req.params.id)
  const ruta = act ? null : buscar('rutas', (x) => x.id === req.params.id)
  const registro = act ?? ruta
  if (!registro) return res.status(404).json({ error: 'No encontrada.' })
  if (req.usuario.rol === 'docente' && registro.autor !== req.usuario.id) {
    return res.status(403).json({ error: 'Esa actividad no es tuya.' })
  }

  const total = totalVariantes(registro)
  const variante = Math.max(1, Math.min(total, Number(req.query.variante) || 1))
  const seccion = (codigo, contenido) => ({
    codigo,
    titulo: contenido?.actividad?.titulo ?? ACTIVITY_SCENES[codigo]?.titulo ?? codigo,
    tipo: ACTIVITY_SCENES[codigo]?.titulo ?? codigo,
    instrucciones: contenido?.actividad?.instrucciones ?? null,
    requiereRevision: Boolean(ACTIVITY_SCENES[codigo]?.requiereRevision),
    items: hojaDeRespuestas(codigo, contenido),
    contenido,
  })

  if (act) {
    return res.json({
      tipo: 'simple', titulo: act.titulo, variante, totalVariantes: total,
      actividades: [seccion(act.codigo, contenidoDeActividad(act, variante))],
    })
  }
  const b = ruta.bible ?? {}
  res.json({
    tipo: 'aventura', titulo: ruta.titulo, variante, totalVariantes: total,
    historia: { tema: b.tema ?? null, protagonista: b.protagonista ?? null, npc: b.npc ?? null },
    actividades: Object.entries(contenidosDeRuta(ruta, variante) ?? {}).map(([codigo, contenido]) => seccion(codigo, contenido)),
  })
})

// ── GET / (listado) ────────────────────────────────────────
r.get('/', requiereAuth, requiereRol('admin', 'curador', 'docente'), (req, res) => {
  const mias = req.usuario.rol === 'docente'
  // El avatar se resuelve al vuelo: si el docente cambió su foto,
  // se refleja en todas sus actividades sin reescribir registros.
  const conAutor = (a) => ({
    ...a,
    autor_avatar: autorAvatar(a.autor) ?? a.autor_avatar ?? null,
    leccion_titulo: a.leccion_titulo ?? null,
  })
  const actividades = listar('actividades', (a) => !mias || a.autor === req.usuario.id).map(conAutor)
  const rutas = listar('rutas', (a) => !mias || a.autor === req.usuario.id).map(conAutor)
  res.json({
    actividades: actividades.slice().reverse(),
    rutas: rutas.slice().reverse(),
  })
})

r.get('/:id', requiereAuth, (req, res) => {
  const a = buscar('actividades', (x) => x.id === req.params.id) ?? buscar('rutas', (x) => x.id === req.params.id)
  if (!a) return res.status(404).json({ error: 'No encontrada.' })
  res.json({ actividad: a })
})

// ── GET /uso ───────────────────────────────────────────────
r.get('/meta/uso', requiereAuth, requiereRol('admin', 'docente'), (_req, res) => {
  res.json({
    consumo: {
      llamadas: consumo.llamadas,
      tokensEntrada: consumo.tokensEntrada,
      tokensSalida: consumo.tokensSalida,
      aciertosCache: consumo.aciertosCache,
    },
    cache: statsCache(),
    // Sin nombre de proveedor: el panel solo muestra si la IA está configurada.
    iaConfigurada: tieneIA(),
  })
})

r.delete('/meta/cache', requiereAuth, requiereRol('admin'), (_req, res) => {
  limpiarCache()
  res.json({ ok: true })
})

export default r
