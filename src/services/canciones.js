// ============================================================
// canciones.js — Letras de canciones (actividad 10, "completar la letra")
// ============================================================
// Fuente principal: LRCLIB (https://lrclib.net) — gratuita, sin API key
// y con letras SINCRONIZADAS (formato LRC: "[mm:ss.xx] verso"), que es
// lo que permite resaltar cada verso mientras suena la canción.
// Respaldo: Musixmatch, solo si hay MUSIXMATCH_API_KEY (ojo: el plan
// gratuito de Musixmatch devuelve solo una parte de la letra).
//
// Las letras se piden desde el SERVIDOR (no desde el navegador): así se
// controla el User-Agent que pide LRCLIB y el contenido que se guarda
// en la actividad sale de la fuente, no de lo que mande el navegador.
// ============================================================
import { config } from '../config.js'
import { logger } from './logger.js'

const LRCLIB = 'https://lrclib.net/api'
const MUSIXMATCH = 'https://api.musixmatch.com/ws/1.1'
const AGENTE = 'EnglishLessons/1.0 (plataforma educativa; actividad de canciones)'
const MAX_CARACTERES_LETRA = 20_000

async function pedirJson(url, { timeoutMs = 10_000, reintentos = 2 } = {}) {
  for (let intento = 0; ; intento++) {
    const controlador = new AbortController()
    const t = setTimeout(() => controlador.abort(), timeoutMs)
    try {
      const res = await fetch(url, { headers: { 'User-Agent': AGENTE, Accept: 'application/json' }, signal: controlador.signal })
      if (res.status === 404) return null
      // LRCLIB a veces responde 503 un momento: se reintenta (1,5 s y 3 s).
      if (res.status >= 500 && intento < reintentos) { await new Promise((r) => setTimeout(r, 1500 * (intento + 1))); continue }
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      return await res.json()
    } finally {
      clearTimeout(t)
    }
  }
}

/** "[01:02.50]Look at the stars" → { t: 62.5, texto: 'Look at the stars' }. */
export function parsearLrc(lrc) {
  const lineas = []
  for (const cruda of String(lrc ?? '').split(/\r?\n/)) {
    const marcas = [...cruda.matchAll(/\[(\d{1,2}):(\d{2})(?:[.:](\d{1,3}))?\]/g)]
    if (!marcas.length) continue
    const texto = cruda.replace(/\[[^\]]*\]/g, '').trim()
    // Una línea puede traer varias marcas (verso que se repite): una por marca.
    for (const m of marcas) {
      const frac = m[3] ? Number(`0.${m[3].padEnd(3, '0')}`) : 0
      lineas.push({ t: Number(m[1]) * 60 + Number(m[2]) + frac, texto })
    }
  }
  return lineas.sort((a, b) => a.t - b.t).filter((l) => l.texto)
}

/** Letra sin tiempos: un verso por línea, sin rótulos tipo "[Chorus]" ni líneas vacías. */
export function parsearTextoPlano(texto) {
  return String(texto ?? '').split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !/^\[[^\]]*\]$/.test(l) && !/^\(?(chorus|verse|bridge|intro|outro|estribillo)\b.*\)?:?$/i.test(l))
    .map((texto) => ({ t: null, texto }))
}

const minSeg = (s) => (s == null ? null : `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`)

// ── LRCLIB ──────────────────────────────────────────────────
function resumenLrclib(r) {
  return {
    fuente: 'lrclib', id: String(r.id), titulo: r.trackName, artista: r.artistName, album: r.albumName ?? null,
    duracion: r.duration ?? null, duracionTexto: minSeg(r.duration), sincronizada: Boolean(r.syncedLyrics),
    instrumental: Boolean(r.instrumental),
  }
}

async function buscarLrclib(titulo, artista) {
  const q = new URLSearchParams({ track_name: titulo, ...(artista ? { artist_name: artista } : {}) })
  const lista = (await pedirJson(`${LRCLIB}/search?${q}`)) ?? []
  return lista.filter((r) => !r.instrumental && (r.plainLyrics || r.syncedLyrics)).map(resumenLrclib)
}

async function obtenerLrclib(id) {
  const r = await pedirJson(`${LRCLIB}/get/${encodeURIComponent(id)}`)
  if (!r) return null
  const lineas = r.syncedLyrics ? parsearLrc(r.syncedLyrics) : parsearTextoPlano(r.plainLyrics)
  return { ...resumenLrclib(r), sincronizada: Boolean(r.syncedLyrics) && lineas.length > 0, lineas }
}

// ── Musixmatch (respaldo, opcional) ─────────────────────────
async function buscarMusixmatch(titulo, artista) {
  if (!config.musixmatchApiKey) return []
  const q = new URLSearchParams({
    q_track: titulo, ...(artista ? { q_artist: artista } : {}), f_has_lyrics: '1', page_size: '10', apikey: config.musixmatchApiKey,
  })
  const data = await pedirJson(`${MUSIXMATCH}/track.search?${q}`)
  return (data?.message?.body?.track_list ?? []).map(({ track: t }) => ({
    fuente: 'musixmatch', id: String(t.track_id), titulo: t.track_name, artista: t.artist_name, album: t.album_name ?? null,
    duracion: t.track_length || null, duracionTexto: minSeg(t.track_length || null), sincronizada: false, instrumental: false,
  }))
}

async function obtenerMusixmatch(id) {
  if (!config.musixmatchApiKey) return null
  const q = (extra) => new URLSearchParams({ track_id: id, apikey: config.musixmatchApiKey, ...extra })
  const [pista, letra] = await Promise.all([
    pedirJson(`${MUSIXMATCH}/track.get?${q()}`),
    pedirJson(`${MUSIXMATCH}/track.lyrics.get?${q()}`),
  ])
  const t = pista?.message?.body?.track
  const cuerpo = letra?.message?.body?.lyrics?.lyrics_body
  if (!t || !cuerpo) return null
  // El plan gratuito agrega un aviso al final de la letra parcial: se quita.
  const texto = cuerpo.replace(/\*{3,}[\s\S]*$/, '').trim()
  return {
    fuente: 'musixmatch', id: String(t.track_id), titulo: t.track_name, artista: t.artist_name, album: t.album_name ?? null,
    duracion: t.track_length || null, duracionTexto: minSeg(t.track_length || null), sincronizada: false,
    instrumental: false, lineas: parsearTextoPlano(texto),
  }
}

/** Busca por título (+ artista). Primero LRCLIB; si no hay nada, Musixmatch. */
export async function buscarCanciones(titulo, artista = '') {
  let resultados = []
  try { resultados = await buscarLrclib(titulo, artista) } catch (e) {
    logger.warn({ err: e.message }, '[canciones] LRCLIB no respondió a la búsqueda')
  }
  if (!resultados.length) {
    try { resultados = await buscarMusixmatch(titulo, artista) } catch (e) {
      logger.warn({ err: e.message }, '[canciones] Musixmatch no respondió a la búsqueda')
    }
  }
  // Primero las sincronizadas; sin repetir la misma canción de distintos discos.
  const vistas = new Set()
  return resultados
    .sort((a, b) => Number(b.sincronizada) - Number(a.sincronizada))
    .filter((r) => {
      const k = `${r.titulo}|${r.artista}|${r.sincronizada}`.toLowerCase()
      if (vistas.has(k)) return false
      vistas.add(k); return true
    })
    .slice(0, 12)
}

/** Letra completa de una canción, en versos ({ t, texto }). null si no existe. */
export async function obtenerCancion(fuente, id) {
  const r = fuente === 'musixmatch' ? await obtenerMusixmatch(id) : await obtenerLrclib(id)
  if (!r || !r.lineas.length) return null
  // Tope de tamaño: una "letra" desmesurada no es una canción.
  let total = 0
  r.lineas = r.lineas.filter((l) => (total += l.texto.length) <= MAX_CARACTERES_LETRA)
  return r
}
