// ============================================================
// variantes.js — Varios juegos de preguntas por actividad
// ============================================================
// Una actividad (o aventura) se genera en N VARIANTES: mismas
// actividades y mismo vocabulario, distintas preguntas. Cuando un
// estudiante entra a la sala con su doble código (sala + matrícula) le
// toca una al azar — el docente no la asigna — para que dos compañeros
// sentados juntos no tengan las mismas preguntas.
//
// Registros anteriores a las variantes solo tienen `contenido`
// (actividad) o `contenidos` (ruta): cuentan como 1 sola variante.
// ============================================================

/** Cuántas variantes tiene una actividad o ruta guardada. */
export function totalVariantes(registro) {
  return Array.isArray(registro?.variantes) && registro.variantes.length ? registro.variantes.length : 1
}

/** Contenido de la variante `n` (1…N) de una actividad simple. */
export function contenidoDeActividad(actividad, n = 1) {
  return actividad?.variantes?.[n - 1] ?? actividad?.contenido ?? null
}

/** Contenidos por código de actividad de la variante `n` (1…N) de una ruta. */
export function contenidosDeRuta(ruta, n = 1) {
  return ruta?.variantes?.[n - 1] ?? ruta?.contenidos ?? {}
}

/**
 * Elige la variante para un estudiante que entra. Al azar, pero entre
 * las MENOS repartidas hasta ahora en esa sala: así, con 10 variantes y
 * 30 estudiantes, cada una le toca a ~3 y nunca a 6 por mala suerte.
 * @param {number}   total       variantes disponibles
 * @param {number[]} repartidas  variante (1…N) de cada partida previa de la sala
 * @param {() => number} [azar]  inyectable para tests
 */
export function elegirVariante(total, repartidas = [], azar = Math.random) {
  if (total <= 1) return 1
  const usos = Array.from({ length: total }, () => 0)
  for (const v of repartidas) if (v >= 1 && v <= total) usos[v - 1] += 1
  const minimo = Math.min(...usos)
  const candidatas = usos.map((u, i) => (u === minimo ? i + 1 : null)).filter(Boolean)
  return candidatas[Math.floor(azar() * candidatas.length)]
}
