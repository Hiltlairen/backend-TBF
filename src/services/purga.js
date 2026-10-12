// ============================================================
// purga.js — Retención y purga de identidad de estudiantes
// ============================================================
// "Purgar" = anonimizar la IDENTIDAD (estudiantes.nombre,
// codigo_matricula, codigo_externo) de un estudiante. Los HECHOS (resultados,
// puntajes) NO se tocan — quedan como historial anónimo, porque
// ya no hay nombre al que reconectarlos (ver services/identidad.js).
//
// Excepción: el contenido de TEXTO LIBRE que el estudiante escribió
// (ej. "My Writing") sí puede contener información personal en el
// propio texto, no solo en el nombre — así que ese contenido se
// redacta también al purgar, no solo el nombre.
//
// Elegibilidad: un estudiante tiene un único `retiro_en` (se marca
// al darlo de baja individualmente O al finalizar su clase). Pasados
// `DATA_RETENTION_DAYS` desde esa fecha, entra en el barrido
// automático. `purgarEstudiante` también se puede llamar a mano
// (retiro a mitad de semestre) sin esperar la ventana.
// ============================================================
import { listar, buscar, actualizar, insertar } from '../db/store.js'
import { config } from '../config.js'
import { logger } from './logger.js'
import { enviarAlerta } from './alertas.js'

// Códigos de actividad cuyo `detalle`/historial puede contener texto
// libre escrito por el estudiante (más allá de nombre y puntaje).
// Ampliar esta lista si se agregan más formatos de respuesta abierta.
export const ACTIVIDADES_TEXTO_LIBRE = new Set(['05-redaccion'])

function msDeRetencion() {
  return Math.max(0, config.retencionDias) * 24 * 60 * 60 * 1000
}

/** Estudiantes cuya ventana de retención ya venció y siguen sin purgar. */
export function elegiblesParaPurga(ahora = Date.now()) {
  return listar('estudiantes', (e) =>
    !e.purgado_en && e.retiro_en && (ahora - new Date(e.retiro_en).getTime()) >= msDeRetencion())
}

/** Días que faltan (puede ser negativo = ya vencida) para que un estudiante dado de baja sea elegible. */
export function diasRestantes(estudiante, ahora = Date.now()) {
  if (!estudiante.retiro_en) return null
  const vence = new Date(estudiante.retiro_en).getTime() + msDeRetencion()
  return Math.ceil((vence - ahora) / (24 * 60 * 60 * 1000))
}

function redactarTextoLibreDe(estudianteId) {
  const resultados = listar('resultados', (r) => r.estudiante_id === estudianteId)
  let redactados = 0
  for (const r of resultados) {
    const parche = {}
    const codigosDeEsteResultado = new Set([
      r.actividad_codigo,
      ...(r.historial ?? []).map((h) => h.actividad),
    ].filter(Boolean))
    const tieneTextoLibre = [...codigosDeEsteResultado].some((c) => ACTIVIDADES_TEXTO_LIBRE.has(c))

    if (tieneTextoLibre && r.detalle != null) {
      parche.detalle = '[contenido purgado — venció la ventana de retención]'
      redactados++
    }
    // Nombre libre residual (solo pudo quedar aquí en flujos viejos o
    // salas sueltas que luego sí terminaron ligadas a una identidad).
    if (r.estudiante) parche.estudiante = null

    if (Object.keys(parche).length) actualizar('resultados', r.id, parche)
  }
  return redactados
}

/** Anonimiza la identidad de un estudiante. Idempotente. */
export function purgarEstudiante(estudianteId, { motivo = 'manual', porId = null, porNombre = 'sistema' } = {}) {
  const e = buscar('estudiantes', (x) => x.id === estudianteId)
  if (!e) return { ok: false, error: 'Estudiante no encontrado.' }
  if (e.purgado_en) return { ok: true, estudiante: e, yaEstaba: true }

  const redactados = redactarTextoLibreDe(estudianteId)

  const purgado = actualizar('estudiantes', estudianteId, {
    nombre: null,
    codigo_matricula: null,
    codigo_externo: null,
    activo: false,
    purgado_en: new Date().toISOString(),
    purgado_motivo: motivo,
  })

  // Auditoría SIN datos personales: ids opacos y conteos, nunca el nombre.
  insertar('auditoria', {
    tipo: 'purga', accion: 'purgar_estudiante',
    estudiante_id: estudianteId, clase_id: e.clase_id ?? null,
    motivo, redacciones_purgadas: redactados,
    por: porId, por_nombre: porNombre,
  })

  return { ok: true, estudiante: purgado, redactados }
}

/** Barrido automático: purga a todos los que ya vencieron su ventana. */
export function ejecutarPurgaAutomatica() {
  const elegibles = elegiblesParaPurga()
  let contador = 0
  for (const e of elegibles) {
    const r = purgarEstudiante(e.id, { motivo: 'automatica', porNombre: 'job automático (retención vencida)' })
    if (r.ok && !r.yaEstaba) contador++
  }
  if (contador) {
    insertar('auditoria', {
      tipo: 'purga', accion: 'barrido_automatico', cantidad: contador,
      dias_retencion: config.retencionDias, por_nombre: 'job automático',
    })
    logger.info({ contador, retencionDias: config.retencionDias }, 'barrido automático de purga')
  }
  return contador
}

function fallo(e, momento) {
  logger.error({ err: e.message, momento }, 'barrido de purga falló')
  enviarAlerta('purga-fallo', `El job de purga (${momento}) falló: ${e.message}`, { momento }).catch(() => {})
}

let temporizador = null

/** Arranca el job periódico. Llamar una sola vez al iniciar el servidor. */
export function iniciarProgramadorPurga() {
  if (temporizador) return
  // setInterval/setTimeout de Node no aceptan un delay de más de
  // 2^31-1 ms (~24.8 días): pasarse de eso no tira error, dispara
  // el timer casi de inmediato (y en bucle) — un footgun silencioso
  // si alguien pone un número grande en PURGE_INTERVAL_HOURS por
  // error. Se acota acá en vez de confiar en que el .env sea sensato.
  const intervaloMs = Math.min(Math.max(1, config.purgaIntervaloHoras) * 60 * 60 * 1000, 2_147_483_647)

  // Primer barrido poco después de arrancar (da tiempo a que termine
  // la hidratación desde Postgres, si aplica) y luego cada intervalo.
  const primero = setTimeout(() => {
    try { ejecutarPurgaAutomatica() } catch (e) { fallo(e, 'inicial') }
  }, 30_000)
  primero.unref?.()

  temporizador = setInterval(() => {
    try { ejecutarPurgaAutomatica() } catch (e) { fallo(e, 'periódico') }
  }, intervaloMs)
  temporizador.unref?.()

  console.log(`  [purga] job de retención activo: cada ${config.purgaIntervaloHoras}h, ventana de ${config.retencionDias} días.`)
}
