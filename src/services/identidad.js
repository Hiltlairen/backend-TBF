// ============================================================
// identidad.js — Resolver "¿quién hizo esto?" sin duplicar datos
// ============================================================
// Principio: las tablas de ACCIONES (resultados, partidas,
// revisiones) solo guardan un `estudiante_id` que apunta a la
// tabla de IDENTIDAD (`estudiantes`). El nombre se resuelve acá,
// en el momento de mostrarlo, según:
//   1. ¿La identidad fue purgada? → mensaje de purga, para todos.
//   2. ¿El rol que pregunta puede ver nombres reales? → sí/no.
//   3. Si sí, se descifra el nombre desde la tabla de identidad.
//
// Esto es lo que permite que purgar UNA fila (la identidad) borre
// el nombre de TODO el histórico sin tener que tocar cada resultado.
// ============================================================
import crypto from 'node:crypto'
import { buscar } from '../db/store.js'
import { descifrar } from './crypto.js'

/**
 * Roles que pueden ver el nombre real de un estudiante detrás de
 * una acción (resultado, entrega, recorrido). El curador revisa
 * CONTENIDO (vocabulario, actividades, redacciones) — no necesita
 * saber de qué estudiante es una entrega para hacer su trabajo, así
 * que por defecto no ve nombres reales.
 */
export function puedeVerNombreReal(rol) {
  return rol === 'admin' || rol === 'docente'
}

/** Pseudónimo ESTABLE (mismo estudiante → mismo pseudónimo siempre),
 *  pero que no permite reconstruir el nombre ni el id real. */
export function pseudonimoEstable(semilla) {
  const hash = crypto.createHash('sha256').update(String(semilla ?? 'anon')).digest('hex').slice(0, 6).toUpperCase()
  return `Estudiante #${hash}`
}

/**
 * Resuelve el nombre a mostrar para un registro de acción.
 * @param {{estudianteId?: string|null, nombreLibre?: string|null}} datos
 * @param {string} rolActor — rol de quien está pidiendo verlo
 */
export function nombreParaMostrar({ estudianteId = null, nombreLibre = null }, rolActor) {
  const estudiante = estudianteId ? buscar('estudiantes', (e) => e.id === estudianteId) : null

  if (estudiante?.purgado_en) {
    return { nombre: 'Estudiante retirado (dato purgado)', purgado: true, pseudonimo: false }
  }

  if (!puedeVerNombreReal(rolActor)) {
    return { nombre: pseudonimoEstable(estudianteId ?? nombreLibre), purgado: false, pseudonimo: true }
  }

  if (estudiante) return { nombre: descifrar(estudiante.nombre), purgado: false, pseudonimo: false }
  return { nombre: nombreLibre ?? 'Anónimo', purgado: false, pseudonimo: false }
}

/** ¿La partida/registro pertenece al usuario invitado que está pidiendo algo?
 *  Si el invitado tiene estudianteId (clase vinculada), compara por ahí —
 *  nunca por nombre, que puede repetirse o cambiar de significado tras una purga. */
export function esMismaPersona(registro, usuario) {
  if (usuario?.estudianteId) return registro.estudiante_id === usuario.estudianteId
  return registro.estudiante === usuario?.nombre
}

/** Azúcar para aplicar nombreParaMostrar sobre un registro de `resultados`
 *  y devolver una copia lista para mandar por la API (sin el nombre crudo). */
export function conNombreResuelto(registro, rolActor) {
  const { nombre, purgado, pseudonimo } = nombreParaMostrar(
    { estudianteId: registro.estudiante_id ?? null, nombreLibre: registro.estudiante ?? null },
    rolActor,
  )
  const { estudiante: _crudo, ...resto } = registro
  return { ...resto, estudiante: nombre, estudiantePurgado: purgado, estudiantePseudonimo: pseudonimo }
}
