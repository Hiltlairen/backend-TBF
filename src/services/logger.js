// ============================================================
// logger.js — Logging estructurado (punto 6: observabilidad)
// ============================================================
// Antes: console.log/console.error sueltos, sin forma fija, difíciles
// de indexar o buscar en cualquier herramienta real de logs.
// Ahora: JSON por línea (lo que espera cualquier colector de logs —
// CloudWatch, Datadog, Loki, o simplemente `| jq` a mano), con un
// nivel configurable (LOG_LEVEL) y un campo fijo `servicio` para
// distinguir esto de otros procesos si los logs se centralizan.
//
// Qué NO reemplaza: `morgan` (abajo, en index.js) sigue dando el log
// de acceso HTTP legible en la consola durante desarrollo — este
// logger es para EVENTOS DE NEGOCIO (errores, auditoría operativa,
// jobs) con contexto estructurado, no para el ruido de cada request.
// ============================================================
import pino from 'pino'
import { config } from '../config.js'

export const logger = pino({
  level: config.logLevel,
  base: { servicio: 'english-lessons-api' },
  timestamp: pino.stdTimeFunctions.isoTime,
  // En test, generalmente conviene silencio salvo que se esté
  // depurando algo puntual — LOG_LEVEL=debug lo reactiva a mano.
  enabled: config.entorno !== 'test' || Boolean(process.env.LOG_LEVEL),
})
