// ============================================================
// costos.js — Cuántos tokens (y dinero) cuesta generar
// ============================================================
// Dos usos:
//   1. ANTES de generar: estimar cuánto va a costar el juego de
//      variantes, para que el docente lo sepa antes de gastar.
//   2. DESPUÉS: traducir los tokens reales (telemetría del grafo) a USD.
//
// Cómo se estima:
//   · Entrada: se arman los prompts reales (bible + lote) y se cuenta
//     su largo. Es la parte precisa: el texto que se manda se conoce.
//   · Salida: no se puede saber antes (y los modelos con "thinking"
//     agregan razonamiento que también se cobra). Se parte de una
//     heurística por actividad × cantidad de ítems, y se CALIBRA con
//     las últimas generaciones reales: cada generación guarda lo que
//     se estimó y lo que costó de verdad, y el factor de corrección es
//     la mediana de esas proporciones. Cuantas más generaciones, mejor.
//   · Si esa misma combinación ya está en caché, cuesta 0.
// No incluye las llamadas de REPARACIÓN (solo ocurren si Gemini
// devuelve una actividad inválida) — por eso es un "≈".
// ============================================================
import { config } from '../config.js'
import { ACTIVITY_SCENES } from '../domain/activityScenes.js'
import { conRutas } from '../domain/rutasMapa.js'
import { listar } from '../db/store.js'
import { buildBiblePrompt, buildBatchPrompt } from './prompts.js'
import { getCache, claveCache } from './cache.js'

// ~3.5 caracteres por token en prompts con mucho JSON (un poco
// conservador respecto de los ~4 del inglés corrido).
const CARACTERES_POR_TOKEN = 3.5
const tokensDeTexto = (s) => Math.ceil(String(s ?? '').length / CARACTERES_POR_TOKEN)

// Heurística de salida, antes de calibrar.
const SALIDA_BIBLE = 700
const SALIDA_POR_ACTIVIDAD = 250
const SALIDA_POR_ITEM = 90

const MUESTRAS_CALIBRACION = 12

/** USD de una cantidad de tokens, o null si no hay precios configurados. */
export function costoUSD({ entrada = 0, salida = 0 }) {
  const pe = config.geminiPrecioEntrada1M
  const ps = config.geminiPrecioSalida1M
  if (pe == null || ps == null) return null
  return Math.round(((entrada / 1e6) * pe + (salida / 1e6) * ps) * 1e6) / 1e6
}

/** Bible de tamaño típico para medir el prompt del lote sin llamar a Gemini. */
function bibleTipica(vocabulario, nivel, escenarios) {
  const palabras = vocabulario.slice(0, 16)
  return {
    tema: 'x'.repeat(60), protagonista: 'Name', npc: 'Name', nivel,
    lexico: palabras.map((v) => ({ en: v.ingles, es: v.espanol, cat: v.categoria })),
    lexico_verbos: palabras.slice(0, 8).map((v) => v.ingles),
    frases_clave: Array.from({ length: 6 }, () => 'x'.repeat(25)),
    notas_escena: Object.fromEntries(escenarios.map((e) => [e, 'x'.repeat(60)])),
  }
}

/** Mediana de (real / estimado) de las últimas generaciones reales. */
function calibracion() {
  // Fuera las que salieron de caché (0 tokens) y las que terminaron en
  // el generador local: su gasto es parcial y bajaría el factor a lo loco.
  const ratios = listar('generaciones', (g) =>
    !g.desde_cache && !g.modo_local && g.tokens_estimados > 0 && (g.tokens_entrada + g.tokens_salida) > 0)
    .slice(-MUESTRAS_CALIBRACION)
    .map((g) => (g.tokens_entrada + g.tokens_salida) / g.tokens_estimados)
    .sort((a, b) => a - b)
  if (!ratios.length) return { factor: 1, muestras: 0 }
  const medio = Math.floor(ratios.length / 2)
  const mediana = ratios.length % 2 ? ratios[medio] : (ratios[medio - 1] + ratios[medio]) / 2
  // Acotado: una generación rarísima no debe disparar la estimación.
  return { factor: Math.min(5, Math.max(0.3, mediana)), muestras: ratios.length }
}

/**
 * Estima el costo de generar `variantes` juegos de `specs` (una
 * actividad o una aventura). La variante 1 paga bible + lote; las
 * demás reutilizan el bible y pagan solo su lote. Las que ya están en
 * caché cuestan 0.
 * @returns {{ entrada, salida, total, costoUSD, desdeCache, variantes, variantesEnCache, sinCalibrar: {entrada, salida}, calibracion }}
 */
export function estimarGeneracion({ vocabulario, lecciones, nivel, specs: todas, variantes = 1 }) {
  const n = Math.max(1, Math.round(variantes) || 1)
  // La canción (10) no pasa por la IA: no suma tokens.
  const specs = conRutas(todas.filter((s) => !ACTIVITY_SCENES[s.codigo]?.requiereCancion), { nivel, lecciones })
  if (!specs.length) {
    return {
      entrada: 0, salida: 0, total: 0, costoUSD: 0, desdeCache: false, sinIA: false, local: true, variantes: n, variantesEnCache: 0,
      sinCalibrar: { entrada: 0, salida: 0 }, calibracion: null,
    }
  }
  const escenarios = [...new Set(specs.map((s) => s.escenario))]
  const bible = bibleTipica(vocabulario, nivel, escenarios)
  const salidaLote = specs.reduce((t, s) => t + SALIDA_POR_ACTIVIDAD + SALIDA_POR_ITEM * (Number(s.cantidad) || 6), 0)

  let entrada = 0
  let salida = 0
  let enCache = 0
  for (let v = 1; v <= n; v++) {
    if (getCache(claveCache({ lecciones, nivel, specs, variante: v }))) { enCache += 1; continue }
    entrada += tokensDeTexto(buildBatchPrompt(bible, specs, v))
    salida += salidaLote
    if (v === 1) {
      entrada += tokensDeTexto(buildBiblePrompt({ vocabulario, lecciones, nivel, escenarios, variante: 1 }))
      salida += SALIDA_BIBLE
    }
  }

  if (enCache === n) {
    return {
      entrada: 0, salida: 0, total: 0, costoUSD: 0, desdeCache: true, variantes: n, variantesEnCache: n,
      sinCalibrar: { entrada: 0, salida: 0 }, calibracion: null,
    }
  }

  const cal = calibracion()
  const e = Math.round(entrada * cal.factor)
  const sal = Math.round(salida * cal.factor)
  return {
    entrada: e, salida: sal, total: e + sal,
    costoUSD: costoUSD({ entrada: e, salida: sal }),
    desdeCache: false,
    variantes: n,
    variantesEnCache: enCache,
    // Sin calibrar: es lo que se guarda en la bitácora para que la
    // próxima calibración compare contra la heurística pura.
    sinCalibrar: { entrada, salida },
    calibracion: cal,
  }
}
