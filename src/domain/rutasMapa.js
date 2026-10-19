// ============================================================
// rutasMapa.js — Rutas reales de La Paz para la actividad 07
// ============================================================
// Las rutas salen de data/rutasLaPaz.json (scripts/generar-rutas-lapaz.mjs:
// calles y lugares de OpenStreetMap, giros de OSRM). Aquí se elige UNA
// por variante, con más o menos pasos según el nivel del libro, y se
// resume para el prompt: la IA no inventa el camino, solo escribe las
// indicaciones (y sus 3 opciones) sobre giros y lugares que existen.
// ============================================================
import { readFileSync } from 'node:fs'

const DATOS = JSON.parse(readFileSync(new URL('./data/rutasLaPaz.json', import.meta.url), 'utf8'))
export const FUENTE_MAPA = DATOS.fuente
export const RUTAS = DATOS.rutas

export const CODIGO_DIRECCIONES = '07-direcciones'

/** Pasos de la ruta (giros + llegar) según el nivel: A1 corto, B2 largo. */
export const PASOS_POR_NIVEL = { A1: [2, 3], A2: [3, 4], B1: [4, 5], B2: [5, 6] }

/** Qué tan específicas son las indicaciones en cada nivel (va al prompt). */
export const ESPECIFICIDAD = {
  A1: 'VERY specific and short: one action per sentence, exact number of blocks, left/right. E.g. "Go straight two blocks. Turn left."',
  A2: 'Specific: number of blocks + the landmark at the corner. E.g. "Go straight for two blocks and turn left at the pharmacy."',
  B1: 'Less specific: mainly landmarks and street names, some ordinal numbers. E.g. "Keep going until you see the bank, then take a right onto Calle 21."',
  B2: 'Natural and indirect, like a local: landmarks, "past", "opposite", "before you reach". E.g. "Head past the church and take the second right, just before the café."',
}

function hash(texto) {
  let h = 2166136261
  for (const c of String(texto)) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619) }
  return h >>> 0
}

/**
 * La ruta de una variante. Determinista: misma semilla (lecciones) +
 * variante → misma ruta (así la caché y la estimación coinciden), y
 * variantes distintas → rutas distintas mientras alcancen.
 */
export function elegirRuta({ nivel = 'A2', variante = 1, semilla = '' } = {}) {
  const [min, max] = PASOS_POR_NIVEL[nivel] ?? PASOS_POR_NIVEL.A2
  let candidatas = RUTAS.filter((r) => r.pasos.length >= min && r.pasos.length <= max)
  if (candidatas.length < 3) candidatas = RUTAS
  const orden = [...candidatas].sort((a, b) => hash(`${semilla}|${a.id}`) - hash(`${semilla}|${b.id}`))
  return orden[(Math.max(1, variante) - 1) % orden.length]
}

const GIRO_EN = { izquierda: 'LEFT', derecha: 'RIGHT' }
const lugar = (r) => (r ? `${r.tipo} "${r.nombre}"` : 'no landmark')

/** La ruta resumida para el prompt: un renglón por paso. */
export function resumenRuta(ruta) {
  return ruta.pasos.map((p, i) => {
    const tramo = `P${i + 1}: drive along ${p.calle ?? 'the street'} for ${p.cuadras} block(s) (${p.distancia} m)`
    if (p.accion === 'llegar') {
      return `${tramo}, then ARRIVE — the destination is on the ${p.lado === 'izquierda' ? 'LEFT' : 'RIGHT'}, next to ${lugar(p.referencia)}`
    }
    return `${tramo}, then turn ${GIRO_EN[p.accion]} onto ${p.calle_siguiente ?? 'the next street'} — at the corner: ${lugar(p.referencia)}`
  }).join('\n')
}

/** Las specs con la ruta de esta variante (solo la 07 la lleva). */
export function conRutas(specs, { nivel, variante = 1, lecciones = [] }) {
  const semilla = lecciones.map((l) => l.id ?? l).join(',')
  return specs.map((s) => (s.codigo === CODIGO_DIRECCIONES ? { ...s, nivel, rutaMapa: elegirRuta({ nivel, variante, semilla }) } : s))
}

/** Lo que viaja al navegador: la ruta completa con su geometría. */
export const mapaDeRuta = (ruta) => ruta && ({ ...ruta, fuente: FUENTE_MAPA })

/** Pega el mapa de su spec a cada 07 generada (antes de validarla). */
export function conMapas(actividades, specs) {
  const salida = { ...(actividades ?? {}) }
  for (const s of specs) {
    if (s.codigo === CODIGO_DIRECCIONES && s.rutaMapa && salida[s.codigo] && typeof salida[s.codigo] === 'object') {
      salida[s.codigo] = { ...salida[s.codigo], mapa: mapaDeRuta(s.rutaMapa) }
    }
  }
  return salida
}
