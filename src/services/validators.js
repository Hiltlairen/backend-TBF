// ============================================================
// validators.js — Validación SIN LLM
// ============================================================
// Cada actividad se valida en el servidor. Si falla, el grafo
// manda a reparar SOLO esa actividad. Validar aquí (y no con
// otra llamada al modelo) es lo que evita que el ahorro de
// tokens se pierda en re-generaciones completas.
// ============================================================

const esArray = (x, min = 1) => Array.isArray(x) && x.length >= min
const unaCorrecta = (ops) =>
  esArray(ops, 2) && ops.filter((o) => o?.correcta === true).length === 1

function metaOk(a) {
  return a?.actividad?.id && a?.actividad?.titulo &&
         typeof a?.actividad?.tiempo_limite === 'number'
}

const REGLAS = {
  '01-emparejar': (a) => {
    const L = a.columna_izquierda?.items, R = a.columna_derecha?.items, P = a.pares_correctos
    if (!esArray(L, 3) || !esArray(R, 3) || !esArray(P, 3)) return 'faltan items o pares'
    if (L.length !== R.length || P.length !== L.length) return 'columnas y pares no coinciden en longitud'
    const idsL = new Set(L.map((i) => i.id)), idsR = new Set(R.map((i) => i.id))
    for (const p of P) {
      if (!idsL.has(p.izquierda) || !idsR.has(p.derecha)) return `par inválido ${p.izquierda}→${p.derecha}`
    }
    if (new Set(P.map((p) => p.derecha)).size !== P.length) return 'hay una opción derecha repetida'
    return null
  },

  '02-conversacion-completar': (a) => {
    const c = a.conversacion
    if (!esArray(c, 4)) return 'conversación demasiado corta'
    if (c.length % 2 !== 0) return 'el número de turnos debe ser par'
    for (const t of c) {
      if (t.tipo === 'opciones') {
        if (!String(t.plantilla || '').includes('{blank}')) return `turno ${t.id} sin {blank}`
        if (!unaCorrecta(t.opciones)) return `turno ${t.id} debe tener exactamente 1 opción correcta`
      }
    }
    return null
  },

  '03-conversation-selection': (a) => {
    if (!esArray(a.conversacion, 2) || !esArray(a.preguntas, 1)) return 'falta conversación o preguntas'
    const ids = new Set(a.preguntas.map((q) => q.id))
    for (const t of a.conversacion) {
      if (t.tipo === 'pregunta' && !ids.has(t.pregunta_id)) return `pregunta_id ${t.pregunta_id} inexistente`
    }
    for (const q of a.preguntas) if (!unaCorrecta(q.opciones)) return `pregunta ${q.id} sin 1 sola correcta`
    return null
  },

  '04-sopa-letras': (a) => {
    const { filas = 12, columnas = 12 } = a.configuracion ?? {}
    if (!esArray(a.palabras, 4)) return 'menos de 4 palabras'
    const max = Math.min(filas, columnas)
    for (const p of a.palabras) {
      const w = String(p.palabra || '')
      if (!/^[A-Z]+$/.test(w)) return `"${w}" tiene caracteres no válidos (solo A-Z mayúsculas)`
      if (w.length < 3 || w.length > max) return `"${w}" no cabe en la cuadrícula ${filas}x${columnas}`
    }
    if (new Set(a.palabras.map((p) => p.palabra)).size !== a.palabras.length) return 'palabras repetidas'
    return null
  },

  '05-redaccion': (a) => {
    if (!a.consigna) return 'falta la consigna'
    if (!a.contexto) return 'falta el contexto (situación de la escritura)'
    return null
  },

  '06-diccionario': (a) => {
    if (!esArray(a.entradas, 3)) return 'menos de 3 entradas'
    for (const e of a.entradas) {
      if (!e.contenido || !e.respuesta_correcta) return `entrada ${e.id} incompleta`
      if (!Array.isArray(e.alternativas_aceptadas)) return `entrada ${e.id}: alternativas_aceptadas debe ser array`
    }
    return null
  },

  '07-pronunciacion': (a) => {
    if (!esArray(a.items, 3)) return 'menos de 3 items'
    for (const i of a.items) if (!esArray(i.silabas, 1)) return `item ${i.id} sin sílabas`
    return null
  },

  '08-inflexion': (a) => {
    if (!esArray(a.ejercicios, 3)) return 'menos de 3 ejercicios'
    const reglas = new Set((a.reglas_mostradas ?? []).map((r) => r.id))
    for (const e of a.ejercicios) {
      if (!reglas.has(e.regla_id)) return `ejercicio ${e.id} apunta a una regla inexistente`
      if (!e.respuesta_correcta) return `ejercicio ${e.id} sin respuesta`
      if (e.tipo === 'completar' && !String(e.plantilla || '').includes('{blank}'))
        return `ejercicio ${e.id} sin {blank}`
    }
    return null
  },

  '09-describir': (a) => {
    if (!esArray(a.items, 2)) return 'menos de 2 items'
    for (const i of a.items) {
      if (!i.contenido) return `item ${i.id} sin estímulo`
      if (!unaCorrecta(i.opciones)) return `item ${i.id} sin 1 sola correcta`
    }
    return null
  },

  '10-canciones': (a) => {
    if (!a.cancion?.titulo) return 'falta la canción'
    if (!['youtube', 'spotify', 'url'].includes(a.audio?.tipo) || !a.audio?.ref) return 'falta la fuente de audio'
    if (!esArray(a.lineas, 1)) return 'la letra no tiene versos'
    if (!esArray(a.huecos, 1)) return 'no quedó ninguna palabra para completar (prueba otro tramo o un largo mínimo menor)'
    const enLetra = new Set(a.lineas.flatMap((l) => (l.partes ?? []).filter((p) => p.hueco).map((p) => p.hueco)))
    for (const h of a.huecos) if (!h.respuesta || !enLetra.has(h.id)) return `hueco ${h.id} inválido`
    return null
  },

  '11-indicaciones': (a) => {
    if (!esArray(a.pasos_desordenados, 4)) return 'menos de 4 pasos'
    if (!esArray(a.orden_correcto, 4)) return 'falta orden_correcto'
    const ids = new Set(a.pasos_desordenados.map((p) => p.id))
    if (a.orden_correcto.length !== ids.size) return 'orden_correcto no cubre todos los pasos'
    for (const id of a.orden_correcto) if (!ids.has(id)) return `orden_correcto referencia ${id} inexistente`
    return null
  },

  '12-llamada': (a) => {
    if (!a.llamante?.nombre) return 'falta el llamante'
    if (!esArray(a.turnos, 4)) return 'menos de 4 turnos'
    for (const t of a.turnos) {
      if (t.tipo === 'opciones' && !unaCorrecta(t.opciones)) return `turno ${t.id} sin 1 sola correcta`
    }
    return null
  },

  '13-pedido': (a) => {
    if (!esArray(a.turnos, 4)) return 'menos de 4 turnos'
    for (const t of a.turnos) {
      if (t.tipo === 'opciones' && !unaCorrecta(t.opciones)) return `turno ${t.id} sin 1 sola correcta`
    }
    return null
  },

  '14-anuncios': (a) => {
    if (!a.anuncio?.texto) return 'falta el texto del anuncio'
    if (!esArray(a.preguntas, 2)) return 'menos de 2 preguntas'
    for (const q of a.preguntas) if (!unaCorrecta(q.opciones)) return `pregunta ${q.id} sin 1 sola correcta`
    return null
  },

  // ── 15–19: actividades nuevas tipo minijuego ──────────────

  // Cada nivel aporta 1 celda por palabra + 1 celda de partida + las
  // celdas de distractor. El laberinto (wordmaze.js, en el cliente)
  // limita la cuadrícula a 20 casillas, así que se rechaza aquí
  // cualquier nivel que ya de entrada no pueda caber.
  '15-laberinto-palabras': (a) => {
    if (!esArray(a.niveles, 3)) return 'menos de 3 niveles'
    const ids = new Set()
    for (const n of a.niveles) {
      if (!n.oracion || !n.traduccion) return `nivel ${n.id} sin oración o traducción`
      if (!esArray(n.palabras_en_orden, 4)) return `nivel ${n.id} necesita al menos 4 palabras en orden`
      if (n.palabras_en_orden.length > 8) return `nivel ${n.id} tiene demasiadas palabras (máx. 8)`
      const distractores = n.distractores ?? []
      if (!Array.isArray(distractores) || distractores.length > 4) return `nivel ${n.id}: máximo 4 distractores`
      const celdasNecesarias = 1 + n.palabras_en_orden.length + distractores.length
      if (celdasNecesarias > 20) return `nivel ${n.id} no cabe en la cuadrícula de 20 casillas`
      if (ids.has(n.id)) return `id de nivel repetido: ${n.id}`
      ids.add(n.id)
    }
    return null
  },

  '16-rompecabezas-oracion': (a) => {
    if (!esArray(a.rompecabezas, 3)) return 'menos de 3 oraciones'
    const ids = new Set()
    for (const r of a.rompecabezas) {
      if (!r.oracion || !r.traduccion) return `pieza ${r.id} sin oración o traducción`
      if (!esArray(r.piezas_en_orden, 3)) return `oración ${r.id} necesita al menos 3 piezas`
      if (r.piezas_en_orden.length > 8) return `oración ${r.id} tiene demasiadas piezas (máx. 8)`
      if (ids.has(r.id)) return `id de rompecabezas repetido: ${r.id}`
      ids.add(r.id)
    }
    return null
  },

  '17-emparejar-imagenes': (a) => {
    const L = a.columna_izquierda?.items, R = a.columna_derecha?.items, P = a.pares_correctos
    if (!esArray(L, 3) || !esArray(R, 3) || !esArray(P, 3)) return 'faltan items o pares'
    if (L.length !== R.length || P.length !== L.length) return 'columnas y pares no coinciden en longitud'
    for (const it of L) {
      if (!['imagen', 'texto'].includes(it.tipo)) return `item ${it.id}: tipo debe ser "imagen" o "texto"`
      if (!it.contenido) return `item ${it.id} sin contenido`
    }
    const idsL = new Set(L.map((i) => i.id)), idsR = new Set(R.map((i) => i.id))
    for (const p of P) {
      if (!idsL.has(p.izquierda) || !idsR.has(p.derecha)) return `par inválido ${p.izquierda}→${p.derecha}`
    }
    if (new Set(P.map((p) => p.derecha)).size !== P.length) return 'hay una opción derecha repetida'
    return null
  },

  '18-armar-escenario': (a) => {
    const zonas = a.escenario_interior?.zonas
    if (!a.escenario_interior?.imagen) return 'falta la imagen del escenario interior'
    if (!esArray(zonas, 2)) return 'el escenario necesita al menos 2 zonas'
    if (!esArray(a.objetos, 4)) return 'menos de 4 objetos'
    const idsZona = new Set(zonas.map((z) => z.id))
    let hayDistractor = false
    for (const o of a.objetos) {
      if (!o.imagen || !o.nombre) return `objeto ${o.id} sin imagen o nombre`
      if (o.zona_correcta === null || o.zona_correcta === undefined) { hayDistractor = true; continue }
      if (!idsZona.has(o.zona_correcta)) return `objeto ${o.id} apunta a una zona inexistente (${o.zona_correcta})`
    }
    if (!hayDistractor) return 'debe incluir al menos un objeto distractor (zona_correcta: null)'
    return null
  },

  '19-impostor': (a) => {
    if (!esArray(a.rondas, 3)) return 'menos de 3 rondas'
    for (const ronda of a.rondas) {
      if (!esArray(ronda.tarjetas, 6) || ronda.tarjetas.length !== 6) return `ronda ${ronda.id} necesita EXACTAMENTE 6 tarjetas (matriz 3x2)`
      const incorrectas = ronda.tarjetas.filter((t) => t.correcta === false)
      if (incorrectas.length !== 1) return `ronda ${ronda.id} debe tener EXACTAMENTE 1 tarjeta incorrecta (el impostor)`
      for (const t of ronda.tarjetas) {
        if (!t.imagen || !t.palabra_en || !t.traduccion_mostrada) return `tarjeta ${t.id} incompleta`
      }
    }
    return null
  },

  '20-basquetbol': (a) => {
    if (!esArray(a.tiros, 3)) return 'menos de 3 tiros'
    for (const t of a.tiros) {
      if (!t.palabra) return `tiro ${t.id} sin palabra`
      if (!Array.isArray(t.opciones) || t.opciones.length !== 3) return `tiro ${t.id} necesita EXACTAMENTE 3 opciones (3 posiciones de tiro)`
      if (!unaCorrecta(t.opciones)) return `tiro ${t.id} debe tener exactamente 1 opción correcta`
      for (const o of t.opciones) {
        const txt = String(o.texto || '').trim()
        if (!txt) return `tiro ${t.id}: opción ${o.id} vacía`
        if (txt.length > 24) return `tiro ${t.id}: "${txt}" es demasiado largo (máx. 24 caracteres)`
      }
      if (new Set(t.opciones.map((o) => String(o.texto).trim().toLowerCase())).size !== 3) return `tiro ${t.id} tiene opciones repetidas`
    }
    return null
  },
}

/**
 * @returns {string|null} motivo del rechazo, o null si está bien
 */
export function validarActividad(codigo, data) {
  if (!data || typeof data !== 'object') return 'respuesta vacía'
  if (!metaOk(data)) return 'bloque "actividad" incompleto (id/titulo/tiempo_limite)'
  const regla = REGLAS[codigo]
  if (!regla) return null
  try { return regla(data) } catch (e) { return `error al validar: ${e.message}` }
}

/** Valida un lote. @returns {{validas: object, fallidas: Array<{codigo, motivo}>}} */
// ── Arreglos automáticos (sin IA, gratis) ──────────────────
// Antes, un solo nivel mal hecho descartaba la actividad ENTERA y se
// pedía una reparación a la IA (~1.400 tokens cada una; en el laberinto
// eran casi la mitad del gasto). Ahora se corrige en código lo que tiene
// arreglo obvio: se recortan los distractores de más y se quitan los
// ítems que rompen una regla, SIEMPRE que queden suficientes ítems
// buenos para la actividad. Si no quedan, sigue siendo inválida.
// Rúbrica fija de la redacción: el agente evalúa SOLO esto.
export const CRITERIOS_REDACCION = [
  { id: 'C1', nombre: 'Contexto', descripcion: 'Responde a la consigna y se adecua a la situación (a quién escribe, dónde, para qué).', peso: 50 },
  { id: 'C2', nombre: 'Escritura correcta', descripcion: 'Gramática, ortografía y puntuación correctas en inglés.', peso: 50 },
]

const SANEADORES = {
  '05-redaccion': (a) => (a ? { ...a, criterios: CRITERIOS_REDACCION } : a),
  '15-laberinto-palabras': (a) => {
    if (!Array.isArray(a?.niveles)) return a
    const vistos = new Set()
    const niveles = a.niveles
      .filter((n) => n?.oracion && n?.traduccion && Array.isArray(n.palabras_en_orden)
        && n.palabras_en_orden.length >= 4 && n.palabras_en_orden.length <= 8)
      .map((n, i) => {
        const palabras = new Set(n.palabras_en_orden.map((p) => String(p).toLowerCase()))
        const distractores = (Array.isArray(n.distractores) ? n.distractores : [])
          .filter((d) => !palabras.has(String(d).toLowerCase())).slice(0, 4)
        const id = n.id && !vistos.has(n.id) ? n.id : `N${i + 1}`
        vistos.add(id)
        return { ...n, id, distractores }
      })
    return niveles.length >= 3 ? { ...a, niveles } : a
  },
  '16-rompecabezas-oracion': (a) => {
    if (!Array.isArray(a?.rompecabezas)) return a
    const vistos = new Set()
    const rompecabezas = a.rompecabezas
      .filter((r) => r?.oracion && r?.traduccion && Array.isArray(r.piezas_en_orden)
        && r.piezas_en_orden.length >= 3 && r.piezas_en_orden.length <= 8)
      .map((r, i) => {
        const id = r.id && !vistos.has(r.id) ? r.id : `R${i + 1}`
        vistos.add(id)
        return { ...r, id }
      })
    return rompecabezas.length >= 3 ? { ...a, rompecabezas } : a
  },
}

/** Corrige lo que se puede corregir sin IA (ver SANEADORES). */
export function sanear(codigo, data) {
  const f = SANEADORES[codigo]
  return f && data ? f(data) : data
}

export function validarLote(actividades, codigosEsperados) {
  const validas = {}, fallidas = []
  for (const codigo of codigosEsperados) {
    const data = sanear(codigo, actividades?.[codigo])
    const motivo = validarActividad(codigo, data)
    if (motivo) fallidas.push({ codigo, motivo })
    else validas[codigo] = data
  }
  return { validas, fallidas }
}
