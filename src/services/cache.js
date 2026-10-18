// ============================================================
// cache.js — Caché en memoria + disco de lotes generados
// ============================================================
// Si el docente genera dos veces la misma combinación
// (lecciones + nivel + actividades + cantidades), NO se vuelve
// a llamar a Gemini. Es el ahorro más grande de todos.
// ============================================================
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { config } from '../config.js'

const ARCHIVO = path.join(config.dataDir, 'cache-lotes.json')
const TTL_MS = 1000 * 60 * 60 * 24 * 14 // 14 días

let memoria = {}

function cargar() {
  try {
    if (fs.existsSync(ARCHIVO)) memoria = JSON.parse(fs.readFileSync(ARCHIVO, 'utf8'))
  } catch { memoria = {} }
}
function persistir() {
  try {
    fs.mkdirSync(config.dataDir, { recursive: true })
    fs.writeFileSync(ARCHIVO, JSON.stringify(memoria), 'utf8')
  } catch { /* la caché es best-effort */ }
}
cargar()

/**
 * Clave estable: no depende del orden en que llegaron las actividades.
 * Cada VERSIÓN alternativa (variante 2, 3…) tiene su propia entrada; la
 * versión 1 no agrega nada, así que las claves que ya estaban
 * guardadas antes de existir las versiones siguen sirviendo.
 */
export function claveCache({ lecciones, nivel, specs, variante = 1 }) {
  const base = {
    l: [...(lecciones ?? [])].map((x) => x.id ?? x).sort(),
    n: nivel,
    s: [...(specs ?? [])]
      .map((x) => `${x.codigo}:${x.cantidad}:${x.escenario}:${x.tiempo}:${x.penalizacion}${x.tipoTexto ? `:${x.tipoTexto}` : ''}`)
      .sort(),
  }
  if (variante > 1) base.v = variante
  return crypto.createHash('sha1').update(JSON.stringify(base)).digest('hex').slice(0, 20)
}

export function getCache(clave) {
  if (!clave) return null
  const e = memoria[clave]
  if (!e) return null
  if (Date.now() - e.ts > TTL_MS) { delete memoria[clave]; persistir(); return null }
  return e.valor
}

export function setCache(clave, valor) {
  if (!clave) return
  memoria[clave] = { ts: Date.now(), valor }
  persistir()
}

/**
 * Borra UNA entrada puntual (no toda la caché). Se usa cuando el
 * contenido que quedó cacheado no debía guardarse — hoy, el único
 * caso es la moderación automática (punto 5): si no se invalidara,
 * "genera de nuevo" con la misma combinación de lecciones/actividades
 * devolvería el mismo contenido marcado desde la caché, sin volver a
 * llamar a Gemini — justo lo contrario de lo que el mensaje de error
 * le sugiere hacer al docente.
 */
export function borrarCache(clave) {
  if (!clave || !(clave in memoria)) return false
  delete memoria[clave]
  persistir()
  return true
}

export function limpiarCache() { memoria = {}; persistir() }
export function statsCache() { return { entradas: Object.keys(memoria).length, archivo: ARCHIVO } }
