// ============================================================
// generadorLocal.js — Actividades de VOCABULARIO, sin Gemini
// ============================================================
// Cuando la IA no está disponible (sin cuota, saturada, sin internet),
// solo se ofrecen las actividades que se arman con pares palabra ↔
// traducción del vocabulario REAL de la lección, sin redactar texto
// alrededor de la palabra clave (ver SOLO_VOCABULARIO en
// domain/activityScenes.js). Las que necesitan diálogos, letras,
// anuncios u oraciones NO se inventan acá con plantillas fijas: se
// bloquean hasta que vuelva la IA.
//
// Todo es determinístico y 100% local, a 0 tokens. Cada generador está
// escrito para pasar SIEMPRE las reglas de services/validators.js (no
// hay reintentos para este camino).
// ============================================================
import { SOLO_VOCABULARIO } from '../domain/activityScenes.js'

// ── Banco de palabras 100% seguras (por si la lección no tiene
// suficientes palabras válidas) ─────────────────────────────────
const POOL_SEGURO = [
  { en: 'Cat', es: 'gato' }, { en: 'Dog', es: 'perro' }, { en: 'Book', es: 'libro' },
  { en: 'Table', es: 'mesa' }, { en: 'Chair', es: 'silla' }, { en: 'Water', es: 'agua' },
  { en: 'House', es: 'casa' }, { en: 'Apple', es: 'manzana' }, { en: 'School', es: 'escuela' },
  { en: 'Friend', es: 'amigo' }, { en: 'Garden', es: 'jardín' }, { en: 'Window', es: 'ventana' },
  { en: 'Pencil', es: 'lápiz' }, { en: 'Mother', es: 'madre' }, { en: 'Father', es: 'padre' },
  { en: 'Bread', es: 'pan' }, { en: 'Music', es: 'música' }, { en: 'Phone', es: 'teléfono' },
  { en: 'Plant', es: 'planta' }, { en: 'River', es: 'río' },
]

const MAX_TEXTO_OPCION = 24 // tope del validador de 20-basquetbol

/** Solo letras A-Z en mayúscula: lo único que acepta la sopa de letras. */
const normPalabra = (s) => String(s || '').toUpperCase().replace(/[^A-Z]/g, '')
const limpiar = (s) => String(s ?? '').trim().replace(/\s+/g, ' ')
/** "Pasta / Noodles" → ['Pasta', 'Noodles'] */
const alternativasDe = (s) => String(s ?? '').split('/').map(limpiar).filter(Boolean)
const barajar = (a) => [...a].sort(() => Math.random() - 0.5)
const acotar = (n, min, max) => Math.max(min, Math.min(max, n))

/**
 * Palabras EN/ES del vocabulario real, listas para mostrar. Antes se
 * guardaba solo la versión A-Z de cada palabra (pensada para la sopa),
 * y por eso "Pasta / Noodles" llegaba a la pantalla como "Pastanoodles"
 * y "Hole Punch" como "Holepunch" — un cuarto del vocabulario tiene
 * espacios o barras. Ahora cada palabra trae:
 *   en       → texto completo para mostrar ("Pasta / Noodles")
 *   principal→ la primera alternativa ("Pasta")
 *   alts     → todas las alternativas, como respuestas aceptadas
 *   clave    → A-Z para la sopa y para no repetir palabras ("PASTA")
 * Completa con POOL_SEGURO si la lección no alcanza.
 */
function poolPalabras(vocabulario, minimo = 8, { unaPalabra = false } = {}) {
  const candidatos = []
  const vistos = new Set()
  const sumar = (ingles, espanol) => {
    const alts = alternativasDe(ingles)
    if (!alts.length) return
    const principal = alts[0]
    const clave = normPalabra(principal)
    if (clave.length < 3 || clave.length > 12 || vistos.has(clave)) return
    // La sopa no puede mostrar "Paper clip" como una sola palabra.
    if (unaPalabra && /\s/.test(principal)) return
    vistos.add(clave)
    candidatos.push({ en: alts.join(' / '), principal, alts, clave, es: limpiar(espanol) || principal })
  }
  for (const v of vocabulario ?? []) sumar(v.ingles, v.espanol)
  for (const p of POOL_SEGURO) {
    if (candidatos.length >= minimo + 8) break
    sumar(p.en, p.es)
  }
  return candidatos
}

/** Texto que entra en un botón chico: el completo si cabe, si no la primera alternativa. */
const textoCorto = (p) => (p.en.length <= MAX_TEXTO_OPCION ? p.en : p.principal.slice(0, MAX_TEXTO_OPCION))

/** Generador pseudoaleatorio con semilla (mulberry32): misma semilla, mismo orden. */
function azarConSemilla(semilla) {
  let t = semilla >>> 0
  return () => {
    t = (t + 0x6D2B79F5) >>> 0
    let r = Math.imul(t ^ (t >>> 15), 1 | t)
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r)
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296
  }
}

/**
 * Cada VARIANTE baraja el vocabulario de otra forma: como los
 * generadores toman las primeras palabras válidas, así cada variante
 * pregunta otra COMBINACIÓN de palabras (con 30 estudiantes, 30
 * combinaciones). La variante 1 conserva el orden de la lección, y el
 * barajado es reproducible: la variante k siempre sale igual.
 */
function rotarPorVariante(vocabulario = [], variante = 1) {
  if (variante <= 1 || vocabulario.length < 2) return vocabulario
  const azar = azarConSemilla(variante * 2654435761)
  const copia = [...vocabulario]
  for (let i = copia.length - 1; i > 0; i--) {
    const j = Math.floor(azar() * (i + 1))
    ;[copia[i], copia[j]] = [copia[j], copia[i]]
  }
  return copia
}

/** "Bible" de emergencia (solo el léxico): no depende de Gemini para nada. */
export function generarBibleLocal({ lecciones = [], nivel = 'A2', vocabulario = [], variante = 1 }) {
  const pool = poolPalabras(rotarPorVariante(vocabulario, variante), 16)
  return {
    tema: lecciones.length ? `Vocabulario: ${lecciones.map((l) => l.titulo).join(', ')}` : 'Vocabulario de la lección',
    protagonista: null,
    npc: null,
    nivel,
    lexico: pool.slice(0, 16).map((p) => ({ en: p.en, es: p.es, cat: 'general' })),
    lexico_verbos: [],
    frases_clave: [],
    notas_escena: {},
  }
}

function metaLocal(codigo, spec, extra = {}) {
  return {
    id: codigo,
    titulo: extra.titulo || `Actividad ${codigo}`,
    instrucciones: extra.instrucciones || 'Complete the activity.',
    nivel: extra.nivel || 'A2',
    leccion: extra.leccion || '',
    tiempo_limite: spec?.tiempo ?? 120,
    puntuacion_maxima: 100,
    penalizacion_por_error: spec?.penalizacion ?? 10,
    escenario: spec?.escenario ?? 'aula',
    interaccion: spec?.interaccion ?? 'ninguna',
    presencia: spec?.presencia ?? 'ninguna',
  }
}

// ── Generadores (uno por actividad de SOLO_VOCABULARIO). Respetan la
// cantidad que eligió el docente (spec.cantidad), dentro de lo que
// permite el validador y el vocabulario disponible. ──────────────

function gen01(spec, vocab) {
  const pool = poolPalabras(vocab, 10)
  const items = pool.slice(0, acotar(Number(spec?.cantidad) || 6, 3, pool.length))
  const L = items.map((p, i) => ({ id: `L${i + 1}`, tipo: 'texto', contenido: p.es }))
  const R = items.map((p, i) => ({ id: `R${i + 1}`, tipo: 'texto', contenido: p.en }))
  return {
    actividad: metaLocal('01-emparejar', spec, { titulo: 'Match the words', instrucciones: 'Match each Spanish word with its English translation.' }),
    columna_izquierda: { tipo: 'texto', items: L },
    columna_derecha: { tipo: 'texto', items: barajar(R) },
    pares_correctos: L.map((l, i) => ({ izquierda: l.id, derecha: R[i].id })),
  }
}

function gen04(spec, vocab) {
  const pool = poolPalabras(vocab, 12, { unaPalabra: true })
  const palabras = pool.slice(0, acotar(Number(spec?.cantidad) || 8, 4, pool.length))
    .map((p) => ({ palabra: p.clave, pista: p.es }))
  return {
    actividad: metaLocal('04-sopa-letras', spec, { titulo: 'Word search', instrucciones: 'Find the English words. The clue is in Spanish.' }),
    configuracion: { filas: 12, columnas: 12, direcciones: ['horizontal', 'vertical', 'diagonal'], mayusculas: true },
    palabras,
  }
}

function gen06(spec, vocab) {
  const pool = poolPalabras(vocab, 10)
  const entradas = pool.slice(0, acotar(Number(spec?.cantidad) || 6, 3, pool.length)).map((p, i) => ({
    id: `D${i + 1}`, tipo_entrada: 'texto', contenido: p.es, idioma_entrada: 'es',
    // Cualquiera de las alternativas vale ("Pasta" o "Noodles"), y también el texto completo.
    respuesta_correcta: p.principal,
    alternativas_aceptadas: [...new Set([...p.alts.slice(1), p.en])].filter((a) => a !== p.principal),
  }))
  return { actividad: metaLocal('06-diccionario', spec, { titulo: 'Translate the word', instrucciones: 'Write the English word.' }), entradas }
}

function gen17(spec, vocab) {
  const pool = poolPalabras(vocab, 10)
  const items = pool.slice(0, acotar(Number(spec?.cantidad) || 6, 3, pool.length))
  // Alterna imagen y texto. Si no hay un dibujo con ese nombre, la
  // tarjeta muestra un ícono genérico con la palabra (ver Sprite.jsx).
  const L = items.map((p, i) => (i % 2 === 0
    ? { id: `L${i + 1}`, tipo: 'imagen', contenido: `${p.clave.toLowerCase()}.png`, alt: p.en }
    : { id: `L${i + 1}`, tipo: 'texto', contenido: p.en }))
  const R = items.map((p, i) => ({ id: `R${i + 1}`, tipo: 'texto', contenido: p.es }))
  return {
    actividad: metaLocal('17-emparejar-imagenes', spec, { titulo: 'Match pictures and words' }),
    columna_izquierda: { tipo: 'mixta', items: L },
    columna_derecha: { tipo: 'texto', items: barajar(R) },
    pares_correctos: L.map((l, i) => ({ izquierda: l.id, derecha: R[i].id })),
  }
}

function gen19(spec, vocab) {
  const pool = poolPalabras(vocab, 8)
  const ronda = (offset) => {
    const base = Array.from({ length: 6 }, (_, i) => pool[(offset + i) % pool.length])
    // La última tarjeta muestra la traducción de OTRA palabra: es el impostor.
    const tarjetas = base.map((p, i) => ({
      id: `T${i + 1}`, imagen: `${p.clave.toLowerCase()}.png`, palabra_en: p.en,
      traduccion_mostrada: i === 5 ? base[0].es : p.es,
      correcta: i !== 5,
    }))
    return barajar(tarjetas)
  }
  const n = acotar(Number(spec?.cantidad) || 4, 3, 8)
  const rondas = Array.from({ length: n }, (_, i) => ({ id: `RD${i + 1}`, tarjetas: ronda(i * 2) }))
  return { actividad: metaLocal('19-impostor', spec, { titulo: 'Find the impostor' }), rondas }
}

function gen20(spec, vocab) {
  const pool = poolPalabras(vocab, 10)
  const n = acotar(Number(spec?.cantidad) || 6, 4, Math.min(10, pool.length))
  const tiros = pool.slice(0, n).map((p, i) => {
    const otros = [pool[(i + 1) % pool.length], pool[(i + 2) % pool.length]]
    const opciones = [p, ...otros].map((x, k) => ({
      id: `B${i + 1}${String.fromCharCode(65 + k)}`, texto: textoCorto(x), correcta: k === 0,
    }))
    return { id: `B${i + 1}`, palabra: p.es, idioma: 'es', opciones: barajar(opciones) }
  })
  return { actividad: metaLocal('20-basquetbol', spec, { titulo: 'Shoot the hoop', instrucciones: 'Shoot from the spot with the right translation.' }), tiros }
}

const GENERADORES = {
  '01-emparejar': gen01, '04-sopa-letras': gen04, '06-diccionario': gen06,
  '17-emparejar-imagenes': gen17, '19-impostor': gen19, '20-basquetbol': gen20,
}

// Si alguien agrega una actividad a SOLO_VOCABULARIO sin escribir su
// generador, que se note al arrancar y no el día que se cae la IA.
for (const codigo of SOLO_VOCABULARIO) {
  if (!GENERADORES[codigo]) throw new Error(`generadorLocal: falta el generador de ${codigo}`)
}

/**
 * Arma, sin Gemini, las actividades de vocabulario del lote. Las que
 * necesitan IA quedan ausentes (validarLote las marca "fallidas").
 */
export function generarLoteLocal({ specs, vocabulario, variante = 1 }) {
  const actividades = {}
  const vocab = rotarPorVariante(vocabulario, variante)
  for (const spec of specs) {
    const fn = GENERADORES[spec.codigo]
    if (fn) actividades[spec.codigo] = fn(spec, vocab)
  }
  return actividades
}
