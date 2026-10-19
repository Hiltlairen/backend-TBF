// ============================================================
// generar-rutas-lapaz.mjs — Biblioteca de rutas REALES de La Paz
// ============================================================
// Para la actividad 07 ("Find the way"). Se corre UNA vez (o cuando se
// quieran más rutas) y deja src/domain/data/rutasLaPaz.json:
//
//   1. Lugares con nombre de cada zona (farmacias, iglesias, plazas,
//      colegios…) desde OpenStreetMap vía Overpass.
//   2. Rutas en auto entre dos puntos de la zona, por calles reales,
//      desde OSRM (giros, cuadras, nombres de calle).
//   3. Cada ruta queda en "pasos": seguir N cuadras por una calle y
//      girar (izquierda/derecha) junto a un lugar de referencia, hasta
//      llegar.
//
// Así, en clase el mapa no depende de que Overpass u OSRM respondan
// (los servidores públicos se saturan y no son para uso continuo): en
// el navegador solo se cargan los mosaicos del mapa.
//
// Uso:  node scripts/generar-rutas-lapaz.mjs [rutasPorZona=10]
// Datos: © OpenStreetMap contributors (ODbL). Rutas: OSRM.
// ============================================================
import { writeFileSync, mkdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const AQUI = path.dirname(fileURLToPath(import.meta.url))
const SALIDA = path.join(AQUI, '..', 'src', 'domain', 'data', 'rutasLaPaz.json')
const POR_ZONA = Number(process.argv[2]) || 10
const AGENTE = 'EnglishLessons/1.0 (plataforma educativa; generador de rutas, uso único)'
const OSRM = 'https://router.project-osrm.org/route/v1/driving'
const OVERPASS = ['https://overpass-api.de/api/interpreter', 'https://overpass.kumi.systems/api/interpreter', 'https://overpass.private.coffee/api/interpreter']

// Zonas con calles en cuadrícula (más fáciles de explicar en inglés).
// bbox = [sur, oeste, norte, este]
const ZONAS = [
  { id: 'centro',     nombre: 'Centro (Plaza Murillo)',     bbox: [-16.5010, -68.1385, -16.4925, -68.1290] },
  { id: 'sopocachi',  nombre: 'Sopocachi',                  bbox: [-16.5150, -68.1330, -16.5060, -68.1220] },
  { id: 'miraflores', nombre: 'Miraflores',                 bbox: [-16.5045, -68.1265, -16.4960, -68.1150] },
  { id: 'san_miguel', nombre: 'San Miguel / Calacoto',      bbox: [-16.5440, -68.0850, -16.5355, -68.0735] },
]

// Tipo de lugar de OSM → cómo se dice en inglés (para las indicaciones)
const TIPOS = {
  pharmacy: 'pharmacy', school: 'school', kindergarten: 'kindergarten', university: 'university', bank: 'bank',
  restaurant: 'restaurant', cafe: 'café', fast_food: 'fast food place', ice_cream: 'ice cream shop', hospital: 'hospital',
  clinic: 'clinic', place_of_worship: 'church', library: 'library', police: 'police station', fuel: 'gas station',
  marketplace: 'market', cinema: 'cinema', post_office: 'post office', bakery: 'bakery', supermarket: 'supermarket',
  books: 'bookstore', convenience: 'shop', clothes: 'clothes shop', park: 'park', playground: 'playground',
  stadium: 'stadium', museum: 'museum', hotel: 'hotel', attraction: 'landmark',
}

const esperar = (ms) => new Promise((r) => setTimeout(r, ms))
const r5 = (n) => Math.round(n * 1e5) / 1e5

async function pedir(url, opciones = {}, intentos = 4) {
  for (let i = 0; ; i++) {
    try {
      const res = await fetch(url, { ...opciones, headers: { 'User-Agent': AGENTE, ...(opciones.headers ?? {}) } })
      if (res.ok) return await res.json()
      if (i >= intentos) throw new Error(`HTTP ${res.status}`)
    } catch (e) {
      if (i >= intentos) throw e
    }
    await esperar(2000 * 2 ** i)
  }
}

async function lugaresDe(zona) {
  const b = zona.bbox.join(',')
  const q = `[out:json][timeout:90];(
    nwr["name"]["amenity"~"^(${Object.keys(TIPOS).join('|')})$"](${b});
    nwr["name"]["shop"~"^(bakery|supermarket|books|convenience|clothes)$"](${b});
    nwr["name"]["leisure"~"^(park|playground|stadium)$"](${b});
    nwr["name"]["tourism"~"^(museum|hotel|attraction)$"](${b});
  );out center tags;`
  for (const url of OVERPASS) {
    try {
      const data = await pedir(url, { method: 'POST', body: new URLSearchParams({ data: q }) }, 2)
      return (data.elements ?? []).map((e) => {
        const t = e.tags ?? {}
        const tipo = TIPOS[t.amenity] ?? TIPOS[t.shop] ?? TIPOS[t.leisure] ?? TIPOS[t.tourism] ?? null
        const lat = e.lat ?? e.center?.lat
        const lng = e.lon ?? e.center?.lon
        return tipo && lat ? { nombre: t.name, tipo, lat: r5(lat), lng: r5(lng) } : null
      }).filter(Boolean)
    } catch (e) {
      console.warn(`  Overpass ${url} falló: ${e.message}`)
    }
  }
  throw new Error(`No se pudieron traer los lugares de ${zona.id}`)
}

// Distancia en metros (aprox. equirectangular: sobra para < 2 km)
function metros(a, b) {
  const R = 6371000
  const x = ((b[1] - a[1]) * Math.PI / 180) * Math.cos(((a[0] + b[0]) / 2) * Math.PI / 180)
  const y = (b[0] - a[0]) * Math.PI / 180
  return Math.sqrt(x * x + y * y) * R
}
function cercano(lugares, punto, radio = 60) {
  let mejor = null
  for (const l of lugares) {
    const d = metros(punto, [l.lat, l.lng])
    if (d <= radio && (!mejor || d < mejor.d)) mejor = { ...l, d }
  }
  return mejor && { nombre: mejor.nombre, tipo: mejor.tipo, lat: mejor.lat, lng: mejor.lng }
}

export const cuadrasDe = (p) => Math.max(p.accion === 'llegar' ? 0 : 1, Math.round(p.distancia / 100))
const lado = (mod = '') => (mod.includes('left') ? 'izquierda' : mod.includes('right') ? 'derecha' : null)
const GIRO = new Set(['turn', 'end of road', 'fork', 'on ramp', 'off ramp', 'merge'])

/** Pasos de la ruta OSRM: N cuadras por una calle y girar, hasta llegar. null si no sirve. */
function aPasos(ruta, lugares) {
  const steps = ruta.legs[0].steps
  if (steps.some((s) => ['roundabout', 'rotary', 'roundabout turn', 'exit roundabout', 'exit rotary'].includes(s.maneuver.type))) return null
  if (steps.some((s) => s.maneuver.modifier === 'uturn')) return null

  const pasos = []
  let actual = null
  const abrir = (s) => ({ calle: s.name || null, distancia: 0, cruces: 0, geometria: [] })
  for (let i = 0; i < steps.length; i++) {
    const s = steps[i]
    if (s.maneuver.type === 'arrive') break
    actual ??= abrir(s)
    actual.distancia += s.distance
    // Cruces de calles por el camino (sin contar donde arranca el tramo)
    actual.cruces += (s.intersections ?? []).filter((x, k) => (k > 0 || i > 0) && (x.bearings?.length ?? 0) >= 3).length
    for (const [lng, lat] of s.geometry.coordinates) {
      const p = [r5(lat), r5(lng)]
      const u = actual.geometria.at(-1)
      if (!u || u[0] !== p[0] || u[1] !== p[1]) actual.geometria.push(p)
    }
    const sig = steps[i + 1]
    if (!sig) break
    const giro = lado(sig.maneuver.modifier)
    const esGiro = giro && (GIRO.has(sig.maneuver.type) || ((sig.maneuver.type === 'new name' || sig.maneuver.type === 'continue') && !sig.maneuver.modifier.includes('slight')))
    if (sig.maneuver.type === 'arrive' || esGiro) {
      const punto = [r5(sig.maneuver.location[1]), r5(sig.maneuver.location[0])]
      const llegar = sig.maneuver.type === 'arrive'
      pasos.push({
        accion: llegar ? 'llegar' : giro,
        lado: llegar ? lado(sig.maneuver.modifier) : null,
        calle: actual.calle,
        calle_siguiente: llegar ? null : (sig.name || null),
        cuadras: llegar ? actual.cruces : Math.max(1, actual.cruces),
        distancia: Math.round(actual.distancia),
        punto,
        referencia: cercano(lugares, punto, llegar ? 70 : 55),
        geometria: actual.geometria,
      })
      actual = null
    }
  }
  const giros = pasos.filter((p) => p.accion !== 'llegar').length
  if (pasos.at(-1)?.accion !== 'llegar' || giros < 1 || pasos.length > 6) return null
  if (pasos.some((p) => p.distancia < 45 || p.geometria.length < 2)) return null
  // Cuadras: OSRM cuenta como cruce cualquier pasaje o entrada, así que
  // se estima por distancia (una cuadra de La Paz anda por ~100 m).
  for (const p of pasos) p.cuadras = cuadrasDe(p)
  return pasos
}

// Azar con semilla: correr el script de nuevo da las mismas rutas.
function generador(semilla) {
  let a = semilla
  return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296 }
}

const rutas = []
for (const [zi, zona] of ZONAS.entries()) {
  console.log(`\n▸ ${zona.nombre}`)
  const lugares = await lugaresDe(zona)
  console.log(`  ${lugares.length} lugares con nombre`)
  const azar = generador(1000 + zi)
  const [s, w, n, e] = zona.bbox
  const punto = () => [s + azar() * (n - s), w + azar() * (e - w)]
  let hechas = 0
  for (let intento = 0; intento < POR_ZONA * 8 && hechas < POR_ZONA; intento++) {
    const a = punto()
    const b = punto()
    const recta = metros(a, b)
    if (recta < 300 || recta > 900) continue
    await esperar(1100)   // OSRM público: como mucho ~1 pedido por segundo
    let data
    try { data = await pedir(`${OSRM}/${a[1]},${a[0]};${b[1]},${b[0]}?steps=true&overview=false&geometries=geojson`, {}, 2) } catch { continue }
    const ruta = data.routes?.[0]
    if (!ruta || ruta.distance < 300 || ruta.distance > 1600) continue
    const pasos = aPasos(ruta, lugares)
    if (!pasos) continue
    const conReferencia = pasos.filter((p) => p.referencia).length
    if (conReferencia === 0) continue   // sin ningún lugar de referencia no se puede dar indicaciones "reales"
    const id = `${zona.id}-${hechas + 1}`
    rutas.push({
      id, zona: zona.id, zona_nombre: zona.nombre,
      inicio: pasos[0].geometria[0], fin: pasos.at(-1).punto,
      distancia: Math.round(ruta.distance), giros: pasos.length - 1, pasos,
    })
    hechas++
    console.log(`  ✓ ${id}: ${pasos.length} pasos, ${Math.round(ruta.distance)} m, ${conReferencia} con referencia`)
  }
}

mkdirSync(path.dirname(SALIDA), { recursive: true })
writeFileSync(SALIDA, JSON.stringify({
  generado: new Date().toISOString(),
  fuente: '© OpenStreetMap contributors (ODbL) · rutas: OSRM',
  zonas: ZONAS.map(({ id, nombre }) => ({ id, nombre })),
  rutas,
}))
console.log(`\n${rutas.length} rutas → ${path.relative(process.cwd(), SALIDA)}`)
