// ============================================================
// activityGraph.js — LangGraph: encadena las 6+ actividades
// ============================================================
//
//            ┌──────────┐
//   START ──►│  cache   │──(hit)──────────────────────────► END
//            └────┬─────┘
//                 │ (miss)
//            ┌────▼─────┐   1 llamada: vocabulario completo → bible compacto
//            │ contexto │
//            └────┬─────┘
//            ┌────▼─────┐   1 llamada: bible → LAS 6 actividades juntas
//            │   lote   │
//            └────┬─────┘
//            ┌────▼─────┐   0 llamadas: reglas JS
//            │ validar  │
//            └────┬─────┘
//         ¿fallidas? │
//        ┌───────────┴───────────┐
//        │ sí                    │ no
//   ┌────▼─────┐            ┌────▼─────┐
//   │ reparar  │ (1 llamada └─ guardar │──► END
//   │          │  por acti-     └──────┘
//   └────┬─────┘  vidad rota)
//        └──► validar  (máx. 2 vueltas)
//
// Coste típico de una aventura de 6 actividades: 2 llamadas.
// Coste del método anterior: 6 llamadas con el vocabulario completo.
// ============================================================

import { StateGraph, Annotation, START, END } from '@langchain/langgraph'
import { config } from '../../config.js'
import { callGemini, consumo, medirTokens } from '../gemini.js'
import { buildBiblePrompt, buildBatchPrompt, buildRepairPrompt } from '../prompts.js'
import { validarLote, validarActividad } from '../validators.js'
import { getCache, setCache, claveCache } from '../cache.js'
import { generarBibleLocal, generarLoteLocal } from '../generadorLocal.js'

const MAX_REPARACIONES = 2

const ultimo = (a, b) => (b === undefined ? a : b)

const Estado = Annotation.Root({
  // Entrada
  vocabulario: Annotation({ reducer: ultimo, default: () => [] }),
  lecciones:   Annotation({ reducer: ultimo, default: () => [] }),
  nivel:       Annotation({ reducer: ultimo, default: () => 'A2' }),
  specs:       Annotation({ reducer: ultimo, default: () => [] }),
  cacheKey:    Annotation({ reducer: ultimo, default: () => null }),
  variante:    Annotation({ reducer: ultimo, default: () => 1 }),

  // Trabajo
  bible:       Annotation({ reducer: ultimo, default: () => null }),
  actividades: Annotation({ reducer: (a, b) => ({ ...(a || {}), ...(b || {}) }), default: () => ({}) }),
  fallidas:    Annotation({ reducer: ultimo, default: () => [] }),
  vueltas:     Annotation({ reducer: (a, b) => (a || 0) + (b || 0), default: () => 0 }),

  // Telemetría
  llamadas:    Annotation({ reducer: (a, b) => (a || 0) + (b || 0), default: () => 0 }),
  desdeCache:  Annotation({ reducer: ultimo, default: () => false }),
  traza:       Annotation({ reducer: (a, b) => [...(a || []), ...(b || [])], default: () => [] }),
})

// ── NODO: cache ────────────────────────────────────────────
async function nodoCache(s) {
  const hit = getCache(s.cacheKey)
  if (hit) {
    consumo.aciertosCache += 1
    return { actividades: hit.actividades, bible: hit.bible, desdeCache: true, traza: ['cache: HIT — 0 llamadas'] }
  }
  return { traza: ['cache: MISS'] }
}

// ── NODO: contexto (1 llamada) ─────────────────────────────
async function nodoContexto(s) {
  const escenarios = [...new Set(s.specs.map((x) => x.escenario))]
  const prompt = buildBiblePrompt({
    vocabulario: s.vocabulario, lecciones: s.lecciones, nivel: s.nivel, escenarios, variante: s.variante,
  })
  // Las versiones alternativas suben un poco la temperatura: más variedad.
  const { json, uso } = await callGemini(prompt, { temperature: s.variante > 1 ? 0.95 : 0.8, maxOutputTokens: 1500 })
  return {
    bible: json,
    llamadas: 1,
    traza: [`contexto: bible generado (${uso.promptTokenCount ?? '?'} tok entrada)`],
  }
}

// ── NODO: lote (1 llamada para TODAS) ──────────────────────
async function nodoLote(s) {
  const prompt = buildBatchPrompt(s.bible, s.specs, s.variante)
  const { json, uso } = await callGemini(prompt, { temperature: s.variante > 1 ? 0.9 : 0.75, maxOutputTokens: 16000 })
  const actividades = json?.actividades ?? json ?? {}
  return {
    actividades,
    llamadas: 1,
    traza: [`lote: ${Object.keys(actividades).length} actividades en 1 llamada (${uso.promptTokenCount ?? '?'} tok entrada)`],
  }
}

// ── NODO: validar (0 llamadas) ─────────────────────────────
async function nodoValidar(s) {
  const codigos = s.specs.map((x) => x.codigo)
  const { fallidas } = validarLote(s.actividades, codigos)
  return {
    fallidas,
    traza: [fallidas.length
      ? `validar: ${fallidas.length} rechazadas → ${fallidas.map((f) => `${f.codigo} (${f.motivo})`).join('; ')}`
      : 'validar: todas OK'],
  }
}

// ── NODO: reparar (1 llamada por actividad rota) ───────────
async function nodoReparar(s) {
  const parches = {}
  const traza = []
  let llamadas = 0

  for (const { codigo, motivo } of s.fallidas) {
    const spec = s.specs.find((x) => x.codigo === codigo)
    if (!spec) continue
    try {
      const { json } = await callGemini(buildRepairPrompt(s.bible, spec, motivo), {
        temperature: 0.6, maxOutputTokens: 4000,
      })
      llamadas += 1
      const data = json?.[codigo] ?? json
      const sigueMal = validarActividad(codigo, data)
      if (!sigueMal) { parches[codigo] = data; traza.push(`reparar: ${codigo} OK`) }
      else traza.push(`reparar: ${codigo} sigue fallando (${sigueMal})`)
    } catch (e) {
      traza.push(`reparar: ${codigo} error — ${e.message}`)
    }
  }
  return { actividades: parches, vueltas: 1, llamadas, traza }
}

// ── NODO: guardar ──────────────────────────────────────────
async function nodoGuardar(s) {
  if (!s.desdeCache && s.cacheKey) {
    setCache(s.cacheKey, { actividades: s.actividades, bible: s.bible })
  }
  return { traza: [`fin: ${s.llamadas} llamada(s) a Gemini en total`] }
}

// ── Aristas condicionales ──────────────────────────────────
// Las variantes 2…N reciben el bible de la 1: van directo al lote.
const trasCache   = (s) => (s.desdeCache ? 'guardar' : s.bible ? 'lote' : 'contexto')
const trasValidar = (s) =>
  (s.fallidas.length > 0 && s.vueltas < MAX_REPARACIONES) ? 'reparar' : 'guardar'

const grafo = new StateGraph(Estado)
  .addNode('cache',    nodoCache)
  .addNode('contexto', nodoContexto)
  .addNode('lote',     nodoLote)
  .addNode('validar',  nodoValidar)
  .addNode('reparar',  nodoReparar)
  .addNode('guardar',  nodoGuardar)
  .addEdge(START, 'cache')
  .addConditionalEdges('cache', trasCache, { contexto: 'contexto', lote: 'lote', guardar: 'guardar' })
  .addEdge('contexto', 'lote')
  .addEdge('lote', 'validar')
  .addConditionalEdges('validar', trasValidar, { reparar: 'reparar', guardar: 'guardar' })
  .addEdge('reparar', 'validar')
  .addEdge('guardar', END)

export const appGrafo = grafo.compile()

/**
 * API pública: genera todas las actividades de una ruta.
 * @param {object} p
 * @param {Array}  p.vocabulario
 * @param {Array}  p.lecciones
 * @param {string} p.nivel
 * @param {Array}  p.specs  [{codigo, escenario, interaccion, presencia, cantidad, tiempo, penalizacion}]
 * @param {object} [p.sinIA]  estadoIA() si la IA está en pausa: no se intenta llamar a Gemini
 */
export async function generarLote({ vocabulario, lecciones, nivel = 'A2', specs, variante = 1, sinIA = null, bible = null }) {
  if (!specs?.length) throw new Error('No se indicaron actividades a generar.')

  const cacheKey = claveCache({ lecciones, nivel, specs, variante })

  let estadoFinal
  let modoLocal = false
  // Todo lo que Gemini cobre durante esta generación, incluso si falla
  // a mitad de camino y termina en el generador local.
  const gasto = { entrada: 0, salida: 0, llamadas: 0, porProveedor: {} }

  // ── SALVAVIDAS ─────────────────────────────────────────────
  // Sin IA, solo se arman las actividades de VOCABULARIO (palabra ↔
  // traducción) con services/generadorLocal.js; las que necesitan
  // redactar texto quedan "fallidas" y la ruta que llamó le explica
  // al docente por qué. No se guarda en caché (para que la próxima vez
  // se vuelva a probar Gemini) y queda marcado como `modoLocal`.
  const armarLocal = (motivo) => {
    const actividades = generarLoteLocal({ specs, vocabulario, variante })
    modoLocal = true
    return {
      actividades, bible: generarBibleLocal({ lecciones, nivel, vocabulario, variante }), llamadas: 0, desdeCache: false,
      traza: [`local (sin IA): ${Object.keys(actividades).length}/${specs.length} actividades de vocabulario — motivo: ${motivo}`],
    }
  }

  const enCache = sinIA ? getCache(cacheKey) : null
  if (enCache) {
    // La IA está en pausa, pero esta misma combinación ya se generó con
    // IA antes: se sirve esa versión, gratis y mejor que la local.
    estadoFinal = { actividades: enCache.actividades, bible: enCache.bible, llamadas: 0, desdeCache: true, traza: ['cache: HIT (IA en pausa) — 0 llamadas'] }
  } else if (sinIA) {
    // Ni se intenta: con la IA en pausa, cada intento sería esperar un
    // error seguro (ver el disyuntor en services/gemini.js).
    estadoFinal = armarLocal(sinIA.mensaje ?? 'IA no disponible')
  } else {
    try {
      const { resultado, tokens } = await medirTokens(() =>
        appGrafo.invoke({ vocabulario, lecciones, nivel, specs, cacheKey, variante, bible }))
      Object.assign(gasto, tokens)
      estadoFinal = resultado
    } catch (e) {
      // Gemini falló por completo (bible o lote, tras reintentos y modelos de respaldo)
      if (e.tokensGastados) Object.assign(gasto, e.tokensGastados)
      estadoFinal = armarLocal(e.message)
    }
  }

  const codigos = specs.map((x) => x.codigo)
  const { validas, fallidas } = validarLote(estadoFinal.actividades, codigos)

  return {
    actividades: validas,
    fallidas,
    // Expuesto para que quien llama pueda invalidar puntualmente esta
    // entrada si hace falta (ver moderación en activities.routes.js) —
    // sin esto, no hay forma de saber qué clave usar sin recalcularla.
    cacheKey,
    telemetria: {
      // Del medidor: cuenta también las llamadas que respondieron pero no
      // sirvieron (JSON inválido, intento previo al generador local).
      llamadasGemini: gasto.llamadas,
      desdeCache: estadoFinal.desdeCache,
      llamadasEvitadas: Math.max(0, codigos.length - (estadoFinal.llamadas || 0)),
      // Tokens REALES que reportó Gemini (pensamiento incluido en salida),
      // también los de intentos que fallaron antes del generador local.
      tokensEntrada: gasto.entrada,
      tokensSalida: gasto.salida,
      porProveedor: gasto.porProveedor,
      traza: estadoFinal.traza,
      modoLocal,
    },
    bible: estadoFinal.bible,
  }
}

/**
 * Genera `cantidad` VARIANTES de las mismas actividades: juegos de
 * preguntas distintos sobre el mismo vocabulario, que la sala reparte
 * al azar entre los estudiantes (rooms.routes.js → elegirVariante).
 *
 *   · Variante 1: el grafo completo (bible + lote).
 *   · Variantes 2…N: reutilizan el bible de la 1 → 1 llamada cada una
 *     (el lote), con la nota "VARIANT #k" en el prompt y su propia
 *     entrada de caché. Van de a `config.variantesConcurrencia`.
 *   · Sin IA (o si Gemini se cae a mitad): cada variante sale del
 *     generador local, a 0 tokens, con otra combinación de palabras.
 *
 * Una variante que no pudo armar alguna actividad igual se devuelve
 * (con sus `fallidas`): la ruta decide qué hacer con ella.
 */
/** Junta el desglose por proveedor de varias variantes. */
function sumarPorProveedor(telemetrias) {
  const total = {}
  for (const t of telemetrias) {
    for (const [nombre, p] of Object.entries(t.porProveedor ?? {})) {
      const acc = (total[nombre] ??= { llamadas: 0, entrada: 0, salida: 0 })
      acc.llamadas += p.llamadas; acc.entrada += p.entrada; acc.salida += p.salida
    }
  }
  return total
}

export async function generarVariantes({ vocabulario, lecciones, nivel = 'A2', specs, cantidad = 1, sinIA = null }) {
  const n = Math.max(1, Math.round(cantidad) || 1)
  const base = { vocabulario, lecciones, nivel, specs, sinIA }

  const primera = await generarLote({ ...base, variante: 1 })
  const resultados = [primera]
  const bible = primera.bible

  // Si la 1 ya tuvo que armarse sin Gemini (cayó a mitad de camino), las
  // demás siguen por el camino local: reintentar la IA N veces solo
  // haría esperar al docente para terminar igual en lo mismo.
  const sinIALocal = sinIA ?? (primera.telemetria.modoLocal
    ? { disponible: false, motivo: 'fallo', mensaje: 'la IA falló al generar la primera variante' }
    : null)

  const pendientes = Array.from({ length: n - 1 }, (_, i) => i + 2)
  const trabajador = async () => {
    for (let v = pendientes.shift(); v != null; v = pendientes.shift()) {
      resultados[v - 1] = await generarLote({ ...base, variante: v, bible, sinIA: sinIALocal })
    }
  }
  const hilos = sinIALocal ? 1 : Math.max(1, config.variantesConcurrencia)
  await Promise.all(Array.from({ length: Math.min(hilos, pendientes.length) }, trabajador))

  const tel = resultados.map((r) => r.telemetria)
  const suma = (k) => tel.reduce((t, x) => t + (x[k] ?? 0), 0)
  return {
    variantes: resultados.map((r, i) => ({
      numero: i + 1,
      actividades: r.actividades,
      fallidas: r.fallidas,
      cacheKey: r.cacheKey,
      modoLocal: r.telemetria.modoLocal,
      desdeCache: r.telemetria.desdeCache,
    })),
    bible,
    telemetria: {
      variantesPedidas: n,
      llamadasGemini: suma('llamadasGemini'),
      tokensEntrada: suma('tokensEntrada'),
      tokensSalida: suma('tokensSalida'),
      porProveedor: sumarPorProveedor(tel),
      desdeCache: tel.every((x) => x.desdeCache),
      modoLocal: tel.some((x) => x.modoLocal),
      llamadasEvitadas: suma('llamadasEvitadas'),
      traza: tel.flatMap((x, i) => (x.traza ?? []).map((t) => `v${i + 1} · ${t}`)),
    },
  }
}
