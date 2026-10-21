// ============================================================
// cancionHuecos.js — Letra con huecos (actividad 10, sin IA)
// ============================================================
// De una letra (versos con su tiempo, si es sincronizada) arma el
// ejercicio "escucha y completa". Los huecos los decide el DOCENTE:
//   · modo 'manual'      → toca en la letra las palabras a ocultar;
//   · modo 'vocabulario' → el sistema busca en la letra las palabras del
//     vocabulario de las lecciones elegidas (y el docente puede ajustar).
// Siempre dentro del tramo elegido (toda la canción, el estribillo o un
// rango de versos). Nada de ocultar verbos o tiempos al azar.
//
// Cada palabra se identifica con "verso:palabra" — índice del verso en
// la letra original y orden de la palabra dentro del verso (contando
// con PALABRA, la misma expresión que usa el panel del docente).
// ============================================================

export const TIPOS_AUDIO = ['youtube', 'spotify', 'url']
export const MODOS_HUECO = ['manual', 'vocabulario']
export const PALABRA = /[A-Za-z][A-Za-z\u2019']*/g
export const MAX_HUECOS = 300

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

/** Palabras de un verso con su posición (mismo orden que en el panel). */
function palabrasDe(texto) {
  return [...String(texto).matchAll(PALABRA)].map((m) => ({ texto: m[0], ini: m.index, fin: m.index + m[0].length }))
}
const clave = (verso, palabra) => `${verso}:${palabra}`
const normal1 = (w) => String(w).toLowerCase().replace(/[\u2019']/g, "'")

// Palabras muy comunes que nunca se ocultan aunque aparezcan en una entrada
// del vocabulario: artículos, pronombres, auxiliares, preposiciones…
const VACIAS = new Set(`a an the to of and or but so if as at in on for with from by up out
  i you he she it we they me him us them my your his her its our their this that these those
  is are am was were be been do does did have has had can will would may might must shall should
  how what where when who why which there here not no yes very too also all just`.split(/\s+/))

/**
 * Palabras de la letra (dentro del tramo) que coinciden con el vocabulario.
 * Compara palabra por palabra, sin mayúsculas, y acepta plural / 's
 * ("friends", "friend's" → friend). De cada entrada del vocabulario se
 * toman sus palabras sueltas, sin artículos ni palabras comunes ("to read" → read). Las frases enteras del vocabulario no
 * cuentan como palabras clave.
 * @returns {{ seleccion: string[], encontradas: {palabra, veces}[], buscadas: number }}
 */
export function coincidenciasVocabulario(lineas, tramo, vocabulario = []) {
  const buscadas = new Set()
  for (const v of vocabulario) {
    // "Brazil / Brazilian" son dos entradas; las frases del aula ("How do you
    // say ___ in English?", "Can you repeat, please?") son expresiones, no
    // palabras clave: se saltan (si no, se ocultaría "you", "how", "do"…).
    for (const alt of String(v.ingles ?? v.en ?? '').split('/')) {
      const t = alt.trim()
      if (!t || /[?!.,]|_{2,}/.test(t) || t.split(/\s+/).length >= 3) continue
      for (const w of t.toLowerCase().split(/[^a-z']+/)) {
        if (w.length >= 2 && !VACIAS.has(w)) buscadas.add(w)
      }
    }
  }
  const raiz = (w) => {
    const n = normal1(w).replace(/'s$/, '')
    if (buscadas.has(n)) return n
    if (n.endsWith('es') && buscadas.has(n.slice(0, -2))) return n.slice(0, -2)
    if (n.endsWith('s') && buscadas.has(n.slice(0, -1))) return n.slice(0, -1)
    return null
  }
  const seleccion = []
  const veces = new Map()
  for (const vi of indicesDelTramo(lineas, tramo)) {
    palabrasDe(lineas[vi].texto).forEach((p, pi) => {
      const r = raiz(p.texto)
      if (!r) return
      seleccion.push(clave(vi, pi))
      veces.set(r, (veces.get(r) ?? 0) + 1)
    })
  }
  return {
    seleccion: seleccion.slice(0, MAX_HUECOS),
    encontradas: [...veces].map(([palabra, n]) => ({ palabra, veces: n })).sort((a, b) => b.veces - a.veces),
    buscadas: buscadas.size,
  }
}

/**
 * Arma la letra con huecos: oculta las palabras elegidas que caen en el tramo.
 * @param {object} p
 * @param {Array<{t:number|null, texto:string}>} p.lineas  versos de la canción
 * @param {string[]} p.seleccion  claves "verso:palabra" a ocultar
 * @param {'completa'|'estribillo'|{desde:number,hasta:number}} [p.tramo]
 * @returns {{ lineas: Array, huecos: Array<{id, respuesta, linea}>, totalPalabras: number }}
 */
export function generarHuecos({ lineas, seleccion = [], tramo = 'completa' }) {
  const elegidas = new Set(seleccion)
  const huecos = []
  let totalPalabras = 0
  const salida = indicesDelTramo(lineas, tramo).map((vi, k) => {
    const id = `L${k + 1}`
    const texto = lineas[vi].texto
    const partes = []
    let cursor = 0
    palabrasDe(texto).forEach((p, pi) => {
      totalPalabras++
      if (!elegidas.has(clave(vi, pi))) return
      if (p.ini > cursor) partes.push({ texto: texto.slice(cursor, p.ini) })
      const hid = `H${huecos.length + 1}`
      huecos.push({ id: hid, respuesta: p.texto, linea: id })
      partes.push({ hueco: hid })
      cursor = p.fin
    })
    if (cursor < texto.length) partes.push({ texto: texto.slice(cursor) })
    return { id, t: lineas[vi].t ?? null, partes }
  })
  return { lineas: salida, huecos, totalPalabras }
}

/**
 * Contenido completo de la actividad 10 a partir de la canción ya
 * descargada (services/canciones.js) y la configuración del docente.
 */
export function armarActividadCancion({ cancion, audio, opciones = {}, nivel = 'A2', spec = {} }) {
  const tramo = opciones.tramo ?? 'completa'
  const modo = MODOS_HUECO.includes(opciones.modo) ? opciones.modo : 'manual'
  const seleccion = Array.isArray(opciones.seleccion) ? opciones.seleccion.slice(0, MAX_HUECOS) : []
  const { lineas, huecos, totalPalabras } = generarHuecos({ lineas: cancion.lineas, seleccion, tramo })
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
    opciones: { modo, tramo },
    total_palabras: totalPalabras,
    lineas,
    huecos,
  }
}
