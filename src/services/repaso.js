// ============================================================
// repaso.js — Resumen de "en qué fallaste" al terminar (sin IA)
// ============================================================
// Se arma con los `intentos` que devuelve domain/calificador.js, así
// que es instantáneo, gratis y siempre está disponible — el comentario
// del tutor IA (services/tutorIA.js) es un extra encima de esto, nunca
// un reemplazo.
//
// Devuelve:
//   dominadas → lo que acertó (texto corto, para chips)
//   errores   → [{ pregunta, esperado, respondio, traduccion }]
//   ronda     → mini-quiz de práctica SOLO con lo que falló; no se
//               califica ni se guarda, es para cerrar con algo que
//               hacer en vez de solo un número.
// ============================================================
import { vocabularioCompleto } from '../db/store.js'

const MAX_DOMINADAS = 12
const MAX_ERRORES = 12
const MAX_RONDA = 5

const limpio = (s) => String(s ?? '').trim()
const clave = (s) => limpio(s).toLowerCase()
const barajar = (a) => [...a].sort(() => Math.random() - 0.5)

/** Diccionario inglés⇄español de las lecciones de la actividad. */
function diccionario(leccionesIds) {
  const pares = []
  try {
    for (const v of vocabularioCompleto((leccionesIds ?? []).map(String))) {
      if (v.ingles && v.espanol) pares.push({ en: limpio(v.ingles), es: limpio(v.espanol) })
    }
  } catch { /* sin vocabulario: el resumen sale igual, solo sin traducción */ }
  return pares
}

/**
 * Busca la traducción de un error: primero coincidencia exacta con lo
 * esperado o la pregunta; si no, la palabra del vocabulario más larga
 * que aparezca completa dentro de la respuesta esperada.
 */
function traducir(intento, dic) {
  for (const texto of [intento.esperado, intento.pregunta]) {
    const k = clave(texto)
    if (!k) continue
    const hallado = dic.find((p) => clave(p.en) === k || clave(p.es) === k)
    if (hallado) return hallado
  }
  const esperado = ` ${clave(intento.esperado).replace(/[^\p{L}\p{N}' ]/gu, ' ')} `
  let mejor = null
  for (const p of dic) {
    const en = clave(p.en)
    if (en.length >= 3 && esperado.includes(` ${en} `) && (!mejor || en.length > mejor.en.length)) mejor = p
  }
  return mejor
}

/** Variante desordenada de una oración (distractor para frases largas). */
function desordenar(texto) {
  const palabras = limpio(texto).split(/\s+/)
  if (palabras.length < 3) return null
  for (let n = 0; n < 6; n++) {
    const otra = barajar(palabras).join(' ')
    if (otra !== palabras.join(' ')) return otra
  }
  return null
}

/** Una pregunta de práctica por error, con distractores sacados de la misma actividad. */
function armarRonda(errores, todos) {
  const banco = [...new Set(todos.map((x) => limpio(x.esperado)).filter(Boolean))]
  const ronda = []
  for (const e of errores) {
    if (ronda.length >= MAX_RONDA) break
    const correcta = limpio(e.esperado)
    if (!correcta) continue
    const opciones = [correcta]
    const sumar = (t) => { t = limpio(t); if (t && !opciones.some((o) => clave(o) === clave(t))) opciones.push(t) }
    sumar(e.respondio)
    for (const otro of barajar(banco)) { if (opciones.length >= 3) break; sumar(otro) }
    if (opciones.length < 3) sumar(desordenar(correcta))
    if (opciones.length < 2) continue
    ronda.push({
      enunciado: limpio(e.pregunta) || '¿Cuál es la respuesta correcta?',
      significado: e.traduccion ? `${e.traduccion.en} = ${e.traduccion.es}` : null,
      opciones: barajar(opciones).map((texto, k) => ({ id: `r${ronda.length}-${k}`, texto, correcta: texto === correcta })),
    })
  }
  return ronda
}

/**
 * @param {Array<{ intentos?: object[] }>} etapas  una por actividad jugada
 * @param {Array<string|number>} leccionesIds      para buscar traducciones
 */
export function armarRepaso(etapas, leccionesIds = []) {
  const todos = etapas.flatMap((e) => e.intentos ?? [])
  if (!todos.length) return null

  const dic = diccionario(leccionesIds)
  const vistos = new Set()
  const dominadas = []
  const errores = []

  for (const x of todos) {
    // El mismo ítem puede repetirse entre etapas: se cuenta una vez.
    const id = `${clave(x.pregunta)}|${clave(x.esperado)}`
    if (vistos.has(id)) continue
    vistos.add(id)
    if (x.ok) {
      const etiqueta = limpio(x.esperado) || limpio(x.pregunta)
      if (etiqueta && dominadas.length < MAX_DOMINADAS) dominadas.push(etiqueta)
    } else if (errores.length < MAX_ERRORES) {
      errores.push({
        pregunta: limpio(x.pregunta) || null,
        esperado: limpio(x.esperado) || null,
        respondio: limpio(x.respondio) || null,
        traduccion: traducir(x, dic),
      })
    }
  }

  return {
    total: todos.length,
    aciertos: todos.filter((x) => x.ok).length,
    dominadas,
    errores,
    ronda: armarRonda(errores, todos),
  }
}
