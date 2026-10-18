// ============================================================
// cancionHuecos.js — Letra con huecos (actividad 10, sin IA)
// ============================================================
// De una letra (versos con su tiempo, si es sincronizada) arma el
// ejercicio "escucha y completa": oculta un porcentaje de palabras y
// deja un hueco editable en su lugar. Todo es determinista y gratis:
//   · El PORCENTAJE lo fija el libro (su nivel), no el docente.
//   · El docente elige: largo mínimo de la palabra, qué ocultar
//     (aleatorias, verbos o sustantivos) y qué tramo (toda la canción,
//     el estribillo o un rango de versos).
//   · Cada VARIANTE oculta otras palabras (semilla = número de variante):
//     dos compañeros no tienen los mismos huecos.
// Verbos y sustantivos se distinguen con `compromise` (análisis
// gramatical del inglés que corre en el servidor, sin IA).
// ============================================================
import nlp from 'compromise'

/** Porcentaje de palabras ocultas según el nivel del libro. */
export const PORCENTAJE_POR_NIVEL = { A1: 30, A2: 40, B1: 50, B2: 50 }
export const porcentajeDeNivel = (nivel) => PORCENTAJE_POR_NIVEL[nivel] ?? 40

export const TIPOS_HUECO = ['aleatorio', 'verbos', 'sustantivos']
export const TIPOS_AUDIO = ['youtube', 'spotify', 'url']
const PALABRA = /[A-Za-z][A-Za-z']*/g

// ── Audio ───────────────────────────────────────────────────
/**
 * Normaliza la fuente de audio que eligió el docente. Acepta el enlace
 * tal cual lo copia (YouTube, Spotify o un .mp3/.ogg por https).
 * Devuelve { tipo, ref } o lanza un Error con el motivo.
 */
export function normalizarAudio(audio) {
  const tipo = audio?.tipo
  const valor = String(audio?.ref ?? '').trim()
  if (!TIPOS_AUDIO.includes(tipo)) throw new Error('Elige de dónde sale el audio: YouTube, Spotify o una URL.')
  if (tipo === 'youtube') {
    const id = valor.match(/(?:v=|youtu\.be\/|embed\/|shorts\/)([\w-]{11})/)?.[1] ?? (/^[\w-]{11}$/.test(valor) ? valor : null)
    if (!id) throw new Error('El enlace de YouTube no es válido.')
    return { tipo, ref: id }
  }
  if (tipo === 'spotify') {
    const id = valor.match(/track[/:]([A-Za-z0-9]{22})/)?.[1] ?? (/^[A-Za-z0-9]{22}$/.test(valor) ? valor : null)
    if (!id) throw new Error('El enlace de Spotify debe ser de una canción (open.spotify.com/track/…).')
    return { tipo, ref: id }
  }
  let url
  try { url = new URL(valor) } catch { throw new Error('La URL del audio no es válida.') }
  if (url.protocol !== 'https:') throw new Error('La URL del audio tiene que empezar con https://')
  return { tipo, ref: url.toString() }
}

// ── Estribillo ──────────────────────────────────────────────
const normal = (s) => String(s).toLowerCase().replace(/[^a-z0-9' ]/g, '').replace(/\s+/g, ' ').trim()

/**
 * Detecta el estribillo: el bloque de versos seguidos (2 a 8) que más
 * "pesa" (versos × veces que se repite), entre los que aparecen 2+ veces.
 * Devuelve { desde, hasta } (índices de su primera aparición) o null.
 */
export function detectarEstribillo(lineas) {
  const n = lineas.map((l) => normal(l.texto))
  let mejor = null
  for (let largo = 8; largo >= 2; largo--) {
    for (let i = 0; i + largo <= n.length; i++) {
      const bloque = n.slice(i, i + largo).join('\n')
      if (!bloque.replace(/\n/g, '')) continue
      let veces = 0
      for (let j = 0; j + largo <= n.length; j++) if (n.slice(j, j + largo).join('\n') === bloque) veces++
      // Puntaje = versos × repeticiones: un bloque largo que vuelve 2 veces
      // gana a un par de versos sueltos que se repiten 3.
      const puntaje = largo * veces
      if (veces >= 2 && (!mejor || puntaje > mejor.puntaje || (puntaje === mejor.puntaje && largo > mejor.largo))) {
        mejor = { desde: i, hasta: i + largo - 1, veces, largo, puntaje }
      }
    }
  }
  return mejor && { desde: mejor.desde, hasta: mejor.hasta }
}

/** Índices de los versos del tramo elegido. */
export function indicesDelTramo(lineas, tramo) {
  const todos = lineas.map((_, i) => i)
  if (!tramo || tramo === 'completa') return todos
  if (tramo === 'estribillo') {
    const e = detectarEstribillo(lineas)
    return e ? todos.slice(e.desde, e.hasta + 1) : todos
  }
  const desde = Math.max(0, Math.min(lineas.length - 1, Number(tramo.desde) || 0))
  const hasta = Math.max(desde, Math.min(lineas.length - 1, Number(tramo.hasta ?? desde)))
  return todos.slice(desde, hasta + 1)
}

// ── Azar reproducible ───────────────────────────────────────
function semillaDe(...partes) {
  let h = 2166136261
  for (const c of partes.join('|')) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619) }
  return h >>> 0
}
function generador(semilla) {   // mulberry32
  let a = semilla
  return () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
const barajar = (lista, azar) => {
  const a = [...lista]
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(azar() * (i + 1)); [a[i], a[j]] = [a[j], a[i]] }
  return a
}

/** Palabras de un verso con su posición y si son verbo / sustantivo. */
function palabrasDe(texto) {
  const palabras = [...texto.matchAll(PALABRA)].map((m) => ({ texto: m[0], ini: m.index, fin: m.index + m[0].length }))
  // compromise etiqueta términos; se emparejan por orden con las palabras.
  const terminos = nlp(texto).json()[0]?.terms ?? []
  const etiquetas = terminos.map((t) => ({ texto: String(t.text).replace(/[^A-Za-z']/g, ''), tags: t.tags ?? [] }))
  let k = 0
  for (const p of palabras) {
    while (k < etiquetas.length && etiquetas[k].texto.toLowerCase() !== p.texto.toLowerCase()) k++
    const tags = etiquetas[k]?.tags ?? []
    p.verbo = tags.includes('Verb')
    p.sustantivo = tags.includes('Noun') && !tags.includes('Pronoun')
    if (k < etiquetas.length) k++
  }
  return palabras
}

const letras = (palabra) => palabra.replace(/'/g, '').length

/**
 * Arma la letra con huecos.
 * @param {object} p
 * @param {Array<{t:number|null, texto:string}>} p.lineas  versos de la canción
 * @param {number} p.porcentaje   % de palabras a ocultar (lo fija el libro)
 * @param {number} [p.minLetras]  solo palabras de al menos esta cantidad de letras
 * @param {'aleatorio'|'verbos'|'sustantivos'} [p.tipo]
 * @param {'completa'|'estribillo'|{desde:number,hasta:number}} [p.tramo]
 * @param {number} [p.variante]   cambia qué palabras se ocultan
 * @returns {{ lineas: Array, huecos: Array<{id, respuesta, linea}>, totalPalabras: number }}
 */
export function generarHuecos({ lineas, porcentaje, minLetras = 4, tipo = 'aleatorio', tramo = 'completa', variante = 1 }) {
  const azar = generador(semillaDe(variante, lineas.map((l) => l.texto).join('\n')))
  const indices = indicesDelTramo(lineas, tramo)

  const versos = indices.map((i, k) => ({ id: `L${k + 1}`, t: lineas[i].t ?? null, texto: lineas[i].texto, palabras: palabrasDe(lineas[i].texto) }))
  const totalPalabras = versos.reduce((n, v) => n + v.palabras.length, 0)
  const apta = (p) => letras(p.texto) >= minLetras && (tipo === 'verbos' ? p.verbo : tipo === 'sustantivos' ? p.sustantivo : true)

  // Repartidas entre versos: por turnos, cada verso (en orden al azar)
  // aporta una palabra al azar, hasta llegar a la cantidad pedida.
  const porVerso = barajar(versos.map((v, vi) => barajar(v.palabras.map((p, pi) => ({ vi, pi })).filter(({ pi }) => apta(v.palabras[pi])), azar)), azar)
  const candidatas = porVerso.reduce((n, c) => n + c.length, 0)
  const objetivo = Math.min(candidatas, Math.max(candidatas ? 1 : 0, Math.round((porcentaje / 100) * totalPalabras)))
  const elegidas = new Set()
  while (elegidas.size < objetivo) {
    for (const cola of porVerso) {
      if (elegidas.size >= objetivo) break
      const sig = cola.shift()
      if (sig) elegidas.add(`${sig.vi}:${sig.pi}`)
    }
  }

  const huecos = []
  const salida = versos.map((v, vi) => {
    const partes = []
    let cursor = 0
    v.palabras.forEach((p, pi) => {
      if (!elegidas.has(`${vi}:${pi}`)) return
      if (p.ini > cursor) partes.push({ texto: v.texto.slice(cursor, p.ini) })
      const id = `H${huecos.length + 1}`
      huecos.push({ id, respuesta: p.texto, linea: v.id })
      partes.push({ hueco: id })
      cursor = p.fin
    })
    if (cursor < v.texto.length) partes.push({ texto: v.texto.slice(cursor) })
    return { id: v.id, t: v.t, partes }
  })
  return { lineas: salida, huecos, totalPalabras }
}

/**
 * Contenido completo de la actividad 10 a partir de la canción ya
 * descargada (services/canciones.js) y la configuración del docente.
 */
export function armarActividadCancion({ cancion, audio, opciones = {}, nivel = 'A2', spec = {}, variante = 1 }) {
  const porcentaje = porcentajeDeNivel(nivel)
  const tipo = TIPOS_HUECO.includes(opciones.tipo) ? opciones.tipo : 'aleatorio'
  const minLetras = Math.max(1, Math.min(10, Number(opciones.minLetras) || 4))
  const tramo = opciones.tramo ?? 'completa'
  const { lineas, huecos, totalPalabras } = generarHuecos({ lineas: cancion.lineas, porcentaje, minLetras, tipo, tramo, variante })
  return {
    actividad: {
      id: '10-canciones',
      titulo: `${cancion.titulo} — ${cancion.artista}`,
      instrucciones: 'Listen to the song and type the missing words.',
      nivel,
      tiempo_limite: spec.tiempo ?? Math.max(120, Math.round(cancion.duracion ?? 0) + 60),
      puntuacion_maxima: 100,
      penalizacion_por_error: 0,
      escenario: spec.escenario ?? 'karaoke',
      interaccion: spec.interaccion ?? 'performance',
      presencia: spec.presencia ?? 'ninguna',
    },
    cancion: {
      titulo: cancion.titulo, artista: cancion.artista, fuente: cancion.fuente, id: cancion.id,
      duracion: cancion.duracion ?? null, sincronizada: Boolean(cancion.sincronizada),
    },
    audio,
    opciones: { porcentaje, minLetras, tipo, tramo },
    total_palabras: totalPalabras,
    lineas,
    huecos,
  }
}
