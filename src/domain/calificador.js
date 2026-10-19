// ============================================================
// calificador.js — El SERVIDOR pone la nota, no el navegador
// ============================================================
// Antes, /api/game/avanzar y /entregar-simple recibían `puntaje` tal
// cual lo mandaba el navegador: bastaba con editar la petición para
// sacar 100 sin resolver nada. Ahora el navegador manda las
// RESPUESTAS del estudiante y este módulo las compara con la clave
// que el servidor ya tiene guardada (el contenido de la actividad).
//
// Cada calificador devuelve:
//   puntaje  → 0–100 (o null si lo corrige el docente: redacción)
//   intentos → [{ pregunta, esperado, respondio, ok }] — una fila por
//              ítem; es lo que alimenta el resumen de errores y el
//              tutor IA (services/repaso.js, services/tutorIA.js)
//   detalle  → lo que se guarda en `resultados.detalle`
//
// IMPORTANTE: el orden en que se arman los ítems de cada actividad
// tiene que ser EL MISMO que usa `normalizar()` en
// web/src/game/ActivityRunner.jsx — el navegador manda índices.
//
// Límite conocido: el contenido (con la clave) igual viaja al
// navegador para poder dibujar la actividad, así que un estudiante
// muy decidido podría leerla y mandar respuestas correctas. Esto
// cierra el atajo trivial ("puntaje: 100"); cerrarlo del todo exige
// esconder la clave y validar ítem por ítem contra el servidor.
// Además, el laberinto (15) se juega entero en el navegador y el
// servidor solo puede creerle qué pisos completó.
// ============================================================

const pct = (ok, total) => (total ? Math.round((ok / total) * 100) : 0)
const acotar = (n) => Math.max(0, Math.min(100, Math.round(n)))
const normalizarTexto = (s) => String(s ?? '').trim().toLowerCase().replace(/\s+/g, ' ')
const lista = (x) => (Array.isArray(x) ? x : [])

/** Respuestas por índice de ítem: [{ i, ... }] → Map(i → respuesta). */
function porIndice(items) {
  const m = new Map()
  for (const r of lista(items)) {
    const i = Number(r?.i)
    if (Number.isInteger(i) && !m.has(i)) m.set(i, r)
  }
  return m
}

// ── Ítems de opción múltiple (misma lógica que normalizar()) ──
// `pregunta` es lo que se le muestra al estudiante en el resumen: en
// las conversaciones el enunciado es genérico ("¿Qué respondes?"),
// así que se usa la última línea del interlocutor como contexto.
function itemsQuiz(codigo, d) {
  const items = []
  switch (codigo) {
    case '02-conversacion-completar': {
      for (const t of lista(d.conversacion)) {
        if (t.tipo === 'opciones') {
          items.push({ pregunta: String(t.plantilla ?? '').replace('{blank}', '_____'), opciones: lista(t.opciones) })
        }
      }
      break
    }
    case '03-conversation-selection': {
      const preguntas = Object.fromEntries(lista(d.preguntas).map((q) => [q.id, q]))
      let ultima = null
      for (const t of lista(d.conversacion)) {
        if (t.tipo === 'pregunta') {
          const q = preguntas[t.pregunta_id]
          if (q) items.push({ pregunta: q.texto ?? ultima ?? '¿Qué respondes?', opciones: lista(q.opciones) })
        } else {
          ultima = t.texto
        }
      }
      break
    }
    case '09-describir':
      for (const it of lista(d.items)) items.push({ pregunta: it.contenido, opciones: lista(it.opciones) })
      break
    case '07-direcciones':
      for (const p of lista(d.pasos)) items.push({ pregunta: p.instruccion, opciones: lista(p.opciones) })
      break
    case '12-llamada':
    case '13-pedido': {
      let ultima = null
      for (const t of lista(d.turnos)) {
        if (t.tipo === 'opciones') items.push({ pregunta: ultima ?? '¿Qué dices?', opciones: lista(t.opciones) })
        else ultima = t.texto
      }
      break
    }
    case '14-anuncios':
      for (const q of lista(d.preguntas)) items.push({ pregunta: q.texto, opciones: lista(q.opciones) })
      break
  }
  return items
}

function calificarQuiz(codigo, d, r, penalizacion) {
  const items = itemsQuiz(codigo, d)
  const resp = porIndice(r?.items)
  const intentos = items.map((it, i) => {
    const correcta = it.opciones.find((o) => o.correcta === true)
    const elegida = resp.get(i)?.opcion ?? null
    return {
      pregunta: it.pregunta,
      esperado: correcta?.texto ?? null,
      respondio: elegida,
      ok: elegida != null && normalizarTexto(elegida) === normalizarTexto(correcta?.texto),
    }
  })
  const aciertos = intentos.filter((x) => x.ok).length
  const errores = items.length - aciertos
  return { puntaje: acotar(pct(aciertos, items.length) - (errores * penalizacion) / 10), intentos }
}

function itemsEscribir(codigo, d) {
  if (codigo === '06-diccionario') {
    return lista(d.entradas).map((e) => ({
      pregunta: e.contenido, respuesta: e.respuesta_correcta, alternativas: lista(e.alternativas_aceptadas),
    }))
  }
  // 08-inflexion
  return lista(d.ejercicios).map((e) => ({
    pregunta: e.tipo === 'completar'
      ? String(e.plantilla ?? '').replace('{blank}', '_____')
      : `${e.instruccion}: ${e.palabra_base}`,
    respuesta: e.respuesta_correcta, alternativas: [],
  }))
}

// Canción (10): cada hueco se compara con la palabra original, sin
// importar mayúsculas, tildes, signos ni el tipo de apóstrofo.
const normalizarPalabra = (s) => String(s ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  .replace(/[’‘`´]/g, "'").toLowerCase().replace(/[^a-z0-9']/g, '')

/** El verso con el hueco marcado, para el repaso y la hoja de respuestas. */
function versoConHueco(d, hueco) {
  const linea = lista(d.lineas).find((l) => l.id === hueco.linea)
  if (!linea) return null
  return lista(linea.partes).map((p) => (p.hueco === hueco.id ? '_____' : p.hueco ? '…' : p.texto)).join('')
}

function calificarCancion(d, r) {
  const escritos = r?.huecos && typeof r.huecos === 'object' ? r.huecos : {}
  const intentos = lista(d.huecos).map((h) => {
    const escrito = typeof escritos[h.id] === 'string' ? escritos[h.id].slice(0, 60) : null
    return {
      pregunta: versoConHueco(d, h), esperado: h.respuesta, respondio: escrito,
      ok: escrito != null && normalizarPalabra(escrito) === normalizarPalabra(h.respuesta),
    }
  })
  return { puntaje: pct(intentos.filter((x) => x.ok).length, intentos.length), intentos }
}

function calificarEscribir(codigo, d, r) {
  const items = itemsEscribir(codigo, d)
  const resp = porIndice(r?.items)
  const intentos = items.map((it, i) => {
    const escrito = resp.get(i)?.texto ?? null
    const aceptadas = [it.respuesta, ...it.alternativas].map(normalizarTexto)
    return {
      pregunta: it.pregunta, esperado: it.respuesta, respondio: escrito,
      ok: escrito != null && aceptadas.includes(normalizarTexto(escrito)),
    }
  })
  return { puntaje: pct(intentos.filter((x) => x.ok).length, items.length), intentos }
}

const textoCelda = (it) => (it?.tipo === 'imagen' ? (it.alt ?? it.contenido) : it?.contenido) ?? null

function calificarEmparejar(d, r, penalizacion) {
  const izq = lista(d.columna_izquierda?.items)
  const der = lista(d.columna_derecha?.items)
  const pares = lista(d.pares_correctos)
  const mapa = Object.fromEntries(pares.map((p) => [p.izquierda, p.derecha]))
  const porIdIzq = Object.fromEntries(izq.map((x) => [x.id, x]))
  const porIdDer = Object.fromEntries(der.map((x) => [x.id, x]))

  let fallos = 0
  const resueltos = new Set()
  const primerError = {}
  for (const { izq: a, der: b } of lista(r?.intentos)) {
    if (!(a in mapa) || resueltos.has(a)) continue
    if (mapa[a] === b) resueltos.add(a)
    else { fallos++; primerError[a] ??= b }
  }

  const intentos = pares.map((p) => ({
    pregunta: textoCelda(porIdIzq[p.izquierda]),
    esperado: textoCelda(porIdDer[p.derecha]),
    respondio: primerError[p.izquierda] ? textoCelda(porIdDer[primerError[p.izquierda]]) : (resueltos.has(p.izquierda) ? textoCelda(porIdDer[p.derecha]) : null),
    ok: resueltos.has(p.izquierda) && !primerError[p.izquierda],
  }))
  // Si dejó pares sin resolver, la nota no puede superar lo que completó.
  const puntaje = Math.min(100 - fallos * penalizacion, pct(resueltos.size, pares.length))
  return { puntaje: acotar(puntaje), intentos, detalle: { fallos, pares: resueltos.size } }
}

function calificarOrdenar(d, r) {
  const pasos = Object.fromEntries(lista(d.pasos_desordenados).map((p) => [p.id, p.texto]))
  const correcto = lista(d.orden_correcto)
  const elegido = lista(r?.orden)
  const intentos = correcto.map((id, k) => ({
    pregunta: `Paso ${k + 1}`,
    esperado: pasos[id] ?? null,
    respondio: pasos[elegido[k]] ?? null,
    ok: elegido[k] === id,
  }))
  return { puntaje: pct(intentos.filter((x) => x.ok).length, correcto.length), intentos }
}

function calificarSopa(d, r) {
  const limpia = (w) => String(w ?? '').toUpperCase().replace(/[^A-Z]/g, '')
  const palabras = lista(d.palabras)
  const validas = new Set(palabras.map((p) => limpia(p.palabra)))
  // La cuadrícula se arma al azar en el navegador y una palabra puede no
  // entrar: solo cuentan las que el navegador dice que colocó (y que sí
  // existen en la actividad).
  const colocadas = new Set(lista(r?.colocadas).map(limpia).filter((w) => validas.has(w)))
  const encontradas = new Set(lista(r?.encontradas).map(limpia).filter((w) => colocadas.has(w)))
  const intentos = palabras
    .filter((p) => colocadas.has(limpia(p.palabra)))
    .map((p) => ({
      pregunta: p.pista ?? p.palabra, esperado: p.palabra,
      respondio: encontradas.has(limpia(p.palabra)) ? p.palabra : null,
      ok: encontradas.has(limpia(p.palabra)),
    }))
  return { puntaje: pct(encontradas.size, colocadas.size), intentos, detalle: { encontradas: [...encontradas] } }
}

function calificarLaberinto(d, r) {
  const pisos = lista(r?.pisos)
  const intentos = lista(d.niveles).map((n, k) => ({
    pregunta: n.traduccion, esperado: n.oracion, respondio: pisos[k] === true ? n.oracion : null, ok: pisos[k] === true,
  }))
  return { puntaje: pct(intentos.filter((x) => x.ok).length, intentos.length), intentos }
}

function calificarRompecabezas(d, r) {
  const resp = porIndice(r?.items)
  const intentos = lista(d.rompecabezas).map((item, i) => {
    const armado = lista(resp.get(i)?.piezas).map(String)
    const orden = lista(item.piezas_en_orden).map(String)
    return {
      pregunta: item.traduccion, esperado: item.oracion,
      respondio: armado.length ? armado.join(' ') : null,
      ok: armado.length === orden.length && armado.every((p, k) => p === orden[k]),
    }
  })
  return { puntaje: pct(intentos.filter((x) => x.ok).length, intentos.length), intentos }
}

const DESCARTE = '__descartar__'

function calificarArmar(d, r) {
  const zonas = Object.fromEntries(lista(d.escenario_interior?.zonas).map((z) => [z.id, z.nombre]))
  const nombreZona = (id) => (id === DESCARTE ? 'No pertenece aquí' : zonas[id] ?? null)
  const colocados = r?.colocados && typeof r.colocados === 'object' ? r.colocados : {}
  const intentos = lista(d.objetos).map((o) => {
    const correcta = o.zona_correcta == null ? DESCARTE : o.zona_correcta
    return {
      pregunta: o.nombre, esperado: nombreZona(correcta),
      respondio: nombreZona(colocados[o.id]), ok: colocados[o.id] === correcta,
    }
  })
  return { puntaje: pct(intentos.filter((x) => x.ok).length, intentos.length), intentos }
}

function calificarImpostor(d, r) {
  const resp = porIndice(r?.items)
  const intentos = lista(d.rondas).map((ronda, i) => {
    const tarjetas = lista(ronda.tarjetas)
    const impostor = tarjetas.find((t) => t.correcta === false)
    const elegida = tarjetas.find((t) => t.id === resp.get(i)?.tarjeta)
    return {
      pregunta: `¿Qué traducción está mal? (ronda ${i + 1})`,
      esperado: impostor ? `${impostor.palabra_en} ≠ ${impostor.traduccion_mostrada}` : null,
      respondio: elegida ? `${elegida.palabra_en} = ${elegida.traduccion_mostrada}` : null,
      ok: elegida?.correcta === false,
    }
  })
  return { puntaje: pct(intentos.filter((x) => x.ok).length, intentos.length), intentos }
}

function calificarBasquet(d, r) {
  const resp = porIndice(r?.items)
  const intentos = lista(d.tiros).map((tiro, i) => {
    const correcta = lista(tiro.opciones).find((o) => o.correcta === true)
    const elegida = resp.get(i)?.opcion ?? null
    return {
      pregunta: tiro.palabra, esperado: correcta?.texto ?? null, respondio: elegida,
      ok: elegida != null && normalizarTexto(elegida) === normalizarTexto(correcta?.texto),
    }
  })
  return { puntaje: pct(intentos.filter((x) => x.ok).length, intentos.length), intentos }
}

/**
 * Califica las respuestas de UNA actividad contra su contenido.
 * @returns {{ puntaje: number|null, intentos: object[], detalle: object }}
 */
export function calificar(codigo, contenido, respuestas) {
  const d = contenido ?? {}
  const r = respuestas && typeof respuestas === 'object' ? respuestas : {}
  const penalizacion = d.actividad?.penalizacion_por_error ?? 10

  let salida
  switch (codigo) {
    case '02-conversacion-completar':
    case '03-conversation-selection':
    case '09-describir':
    case '07-direcciones':
    case '12-llamada':
    case '13-pedido':
    case '14-anuncios':
      salida = calificarQuiz(codigo, d, r, penalizacion); break
    case '06-diccionario':
    case '08-inflexion':
      salida = calificarEscribir(codigo, d, r); break
    case '01-emparejar':
    case '17-emparejar-imagenes':
      salida = calificarEmparejar(d, r, penalizacion); break
    case '11-indicaciones':  salida = calificarOrdenar(d, r); break
    case '10-canciones':     salida = calificarCancion(d, r); break
    case '04-sopa-letras':   salida = calificarSopa(d, r); break
    case '15-laberinto-palabras': salida = calificarLaberinto(d, r); break
    case '16-rompecabezas-oracion': salida = calificarRompecabezas(d, r); break
    case '18-armar-escenario': salida = calificarArmar(d, r); break
    case '19-impostor':      salida = calificarImpostor(d, r); break
    case '20-basquetbol':    salida = calificarBasquet(d, r); break
    case '05-redaccion': {
      // La corrige el docente: no hay nota automática ni intentos.
      const texto = String(r.texto ?? '').slice(0, 10_000)
      return { puntaje: null, intentos: [], detalle: { texto, palabras: texto.trim() ? texto.trim().split(/\s+/).length : 0 } }
    }
    case '07-pronunciacion':
      // Material de referencia: solo se registra que lo recorrió.
      return { puntaje: 100, intentos: [], detalle: { revisado: true } }
    default:
      return { puntaje: 0, intentos: [], detalle: { error: `Actividad desconocida: ${codigo}` } }
  }
  return { puntaje: salida.puntaje, intentos: salida.intentos, detalle: { ...(salida.detalle ?? {}), intentos: salida.intentos } }
}

/**
 * Hoja de respuestas de una actividad, para que el DOCENTE revise lo
 * que generó la IA antes de lanzarlo: cada ítem con su respuesta
 * correcta. Sale del mismo armado de ítems que usa la calificación, así
 * que lo que el docente ve es exactamente lo que se va a corregir.
 * @returns {Array<{ pregunta: string|null, esperado: string|null }>}
 */
export function hojaDeRespuestas(codigo, contenido) {
  const d = contenido ?? {}
  if (codigo === '05-redaccion') {
    return [
      { pregunta: d.contexto ? `Situación: ${d.contexto}` : null, esperado: d.tipo_texto ? `Tipo de texto: ${d.tipo_texto}` : null },
      { pregunta: d.consigna ?? null, esperado: `Mínimo ${d.minimo_palabras ?? 40} palabras · la evalúa la IA y la confirma el docente` },
      ...lista(d.criterios).map((c) => ({ pregunta: `Criterio: ${c.nombre}`, esperado: `${c.peso}%` })),
    ]
  }
  if (codigo === '07-pronunciacion') {
    return lista(d.items).map((it) => ({ pregunta: it.palabra, esperado: [it.ipa, it.consejo].filter(Boolean).join(' · ') || null }))
  }
  if (codigo === '04-sopa-letras') {
    // Sin respuestas, calificarSopa no lista nada (solo cuenta las colocadas).
    return lista(d.palabras).map((p) => ({ pregunta: p.pista ?? null, esperado: p.palabra }))
  }
  return calificar(codigo, d, {}).intentos.map(({ pregunta, esperado }) => ({ pregunta, esperado }))
}
