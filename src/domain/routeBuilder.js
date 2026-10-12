// ============================================================
// routeBuilder.js — GRAFO DE RUTAS POR PUNTAJE
// ============================================================
// Modelo: retícula de ETAPAS × CARRILES.
//
//   etapa:  1 → 2 → 3 → 4 → 5 → 6   (siempre se juegan 6 actividades)
//   carril: avanzado / estandar / refuerzo   (QUÉ actividad toca)
//
// El puntaje de la actividad decide el CARRIL de la etapa siguiente:
//
//        ┌──── ≥80 ────► e(n+1)-avanzado
//   e(n) ├──── 50-79 ──► e(n+1)-estandar
//        └──── <50 ────► e(n+1)-refuerzo
//
// Y dentro de un carril también se puede subir/bajar:
// si vas en refuerzo y sacas 90, la siguiente etapa te devuelve a
// estándar/avanzado. Nunca te quedas atrapado abajo.
//
//        e1-avanzado ──► e2-avanzado ──► e3-avanzado ...
//             ▲   ╲          ▲   ╲
//             │    ╲         │    ╲
//        e1-estandar ──► e2-estandar ...
//             ▲   ╲         ▲   ╲
//        e1-refuerzo ──► e2-refuerzo ...
//
// Ventaja: la ruta SIEMPRE dura 6 actividades (comparable entre
// estudiantes) pero NO son las mismas 6 para todos.
// ============================================================

import { ACTIVITY_SCENES, elegirEscenario } from './activityScenes.js'

export const CARRILES = ['avanzado', 'estandar', 'refuerzo']

export const UMBRALES_DEFAULT = {
  alto: 80,   // ≥ 80 → sube de carril
  medio: 50,  // 50–79 → se mantiene
  // < 50 → baja de carril
}

/** Clasifica un puntaje 0–100 en 'alto' | 'medio' | 'bajo'. */
export function clasificar(puntaje, umbrales = UMBRALES_DEFAULT) {
  if (puntaje >= umbrales.alto) return 'alto'
  if (puntaje >= umbrales.medio) return 'medio'
  return 'bajo'
}

/** Mueve de carril según el resultado. */
function siguienteCarril(carrilActual, resultado) {
  const i = CARRILES.indexOf(carrilActual)
  if (resultado === 'alto') return CARRILES[Math.max(0, i - 1)]      // sube
  if (resultado === 'bajo') return CARRILES[Math.min(2, i + 1)]      // baja
  return carrilActual                                                // se mantiene
}

/**
 * Carriles de la etapa anterior desde los que se puede llegar a `destino`.
 * Ej.: a "refuerzo" se llega bajando desde estándar o siguiendo en refuerzo;
 * a "estandar" se llega desde los tres.
 */
function alimentadores(destino) {
  return CARRILES.filter((origen) =>
    ['alto', 'medio', 'bajo'].some((r) => siguienteCarril(origen, r) === destino)
  )
}

/**
 * Reparte las actividades en 3 bandas SOLAPADAS de dificultad.
 *
 * Si las bandas fueran estancas, con las 6 actividades mínimas cada
 * carril tendría solo 2 y las repetiría en etapas alternas. Solapando
 * (cada banda toma ~2/3 del catálogo, sesgada hacia su nivel) cada
 * carril tiene de dónde elegir y la ruta no se vuelve repetitiva.
 */
function repartirEnBandas(codigos) {
  const items = codigos
    .map((c) => ({ codigo: c, ...ACTIVITY_SCENES[c] }))
    .filter((a) => a.titulo)
    .sort((a, b) => a.dificultad - b.dificultad)

  const n = items.length
  const ancho = Math.max(2, Math.ceil(n * 0.67))

  // refuerzo: las más fáciles · avanzado: las más difíciles · estandar: el centro
  const refuerzo = items.slice(0, ancho)
  const avanzado = items.slice(Math.max(0, n - ancho)).reverse()   // empieza por la más difícil
  const inicioMedio = Math.max(0, Math.floor((n - ancho) / 2))
  const estandar = items.slice(inicioMedio, inicioMedio + ancho)

  // El nodo final no puede ser una actividad que deje al alumno esperando
  // corrección a mitad de camino, así que se prefieren las marcadas 'final'.
  const finales = items.filter((a) => a.apto?.includes('final'))

  return {
    refuerzo: refuerzo.length ? refuerzo : items,
    estandar: estandar.length ? estandar : items,
    avanzado: avanzado.length ? avanzado : items,
    finales: finales.length ? finales : items.slice(-1),
    todas: items,
  }
}

/**
 * Construye el grafo completo.
 * @param {string[]} codigos  actividades elegidas por el docente (mín. 6)
 * @param {object}   opts     { etapas = 6, umbrales, carrilInicial = 'estandar' }
 */
export function construirRuta(codigos, opts = {}) {
  const etapas = opts.etapas ?? 6
  const umbrales = { ...UMBRALES_DEFAULT, ...(opts.umbrales || {}) }
  const carrilInicial = opts.carrilInicial ?? 'estandar'

  if (!Array.isArray(codigos) || codigos.length < 6) {
    throw new Error('Se requieren al menos 6 actividades para armar la ruta.')
  }

  const bandas = repartirEnBandas(codigos)
  const nodos = {}
  const escenariosUsados = { avanzado: [], estandar: [], refuerzo: [] }

  // Cursor por carril. Se arrancan DESFASADOS: si los tres empezaran en 0,
  // con pocas actividades los carriles avanzarían en paralelo y "bajar a
  // refuerzo" no cambiaría nada de lo que ve el estudiante.
  const cursor = {
    avanzado: 0,
    estandar: Math.floor(bandas.estandar.length / 3),
    refuerzo: 0,
  }

  for (let etapa = 1; etapa <= etapas; etapa++) {
    for (const carril of CARRILES) {
      const esFinal = etapa === etapas
      const pool = esFinal ? bandas.finales : (bandas[carril].length ? bandas[carril] : bandas.todas)

      // Nadie debe repetir actividad al cambiar de etapa. Se miran TODOS
      // los carriles que pueden desembocar aquí, no solo el propio: si
      // caes de estándar a refuerzo, tampoco quieres repetir lo que
      // acabas de jugar en estándar.
      const previas = new Set(
        alimentadores(carril)
          .map((c) => nodos[`e${etapa - 1}-${c}`]?.actividad)
          .filter(Boolean)
      )
      let act = pool[cursor[carril] % pool.length]
      for (let intento = 0; intento < pool.length && previas.has(act.codigo); intento++) {
        cursor[carril] += 1
        act = pool[cursor[carril] % pool.length]
      }
      cursor[carril] += 1

      const escenarioId = elegirEscenario(act.codigo, escenariosUsados[carril])
      escenariosUsados[carril].push(escenarioId)

      const id = `e${etapa}-${carril}`
      nodos[id] = {
        id,
        etapa,
        carril,
        actividad: act.codigo,
        titulo: act.titulo,
        escenario: escenarioId,
        interaccion: act.interaccion,
        presencia: act.presencia,
        destreza: act.destreza,
        dificultad: act.dificultad,
        guion: act.guion,
        requiereRevision: Boolean(act.requiereRevision),
        esFinal,
        // Punto A → Punto B en fracciones del ancho de escena
        recorrido: {
          puntoA: 0.10,
          puntoB: act.presencia === 'fisica' ? 0.58 : 0.46,
          gapDetencion: act.presencia === 'fisica' ? 0.16 : 0.0,
        },
        salidas: esFinal ? null : {
          alto:  `e${etapa + 1}-${siguienteCarril(carril, 'alto')}`,
          medio: `e${etapa + 1}-${siguienteCarril(carril, 'medio')}`,
          bajo:  `e${etapa + 1}-${siguienteCarril(carril, 'bajo')}`,
        },
      }
    }
  }

  return {
    version: 1,
    etapas,
    umbrales,
    inicio: `e1-${carrilInicial}`,
    nodos,
    // Lista plana de actividades que hay que generar (sin duplicar)
    actividadesRequeridas: [...new Set(Object.values(nodos).map((n) => n.actividad))],
  }
}

/** Dado un nodo y un puntaje, devuelve el id del siguiente nodo (o null si terminó). */
export function siguienteNodo(ruta, nodoId, puntaje) {
  const nodo = ruta.nodos[nodoId]
  if (!nodo || nodo.esFinal || !nodo.salidas) return null
  const resultado = clasificar(puntaje, ruta.umbrales)
  return nodo.salidas[resultado === 'alto' ? 'alto' : resultado === 'medio' ? 'medio' : 'bajo'] ?? null
}

/** Resumen legible del grafo, para pintarlo en el dashboard. */
export function resumenRuta(ruta) {
  const filas = CARRILES.map((carril) => ({
    carril,
    etapas: Array.from({ length: ruta.etapas }, (_, i) => {
      const n = ruta.nodos[`e${i + 1}-${carril}`]
      return { etapa: i + 1, actividad: n.actividad, titulo: n.titulo, escenario: n.escenario }
    }),
  }))
  return { inicio: ruta.inicio, umbrales: ruta.umbrales, filas }
}
