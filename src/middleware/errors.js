// ============================================================
// errors.js — Manejo central de errores (punto 6: observabilidad)
// ============================================================
// Qué cambió respecto a antes: el log de un error 5xx pasó de un
// `console.error` suelto a un log ESTRUCTURADO con contexto (quién,
// qué ruta, con qué id de request) — y ese mismo id de request viaja
// también en la respuesta al cliente, así que un reporte de "me tiró
// error" se puede buscar directo en los logs por ese id. Además, un
// 5xx ahora dispara una alerta (best-effort, con throttling — ver
// services/alertas.js): antes nada avisaba si el servicio empezaba a
// tirar errores salvo que alguien mirara la consola a mano.
import { config } from '../config.js'
import { logger } from '../services/logger.js'
import { enviarAlerta } from '../services/alertas.js'

export function noEncontrado(req, res) {
  res.status(404).json({ error: `Ruta no encontrada: ${req.method} ${req.originalUrl}`, requestId: req.id })
}

export function manejadorErrores(err, req, res, _next) {
  const status = err.status ?? 500
  const contexto = {
    requestId: req.id,
    metodo: req.method,
    ruta: req.originalUrl,
    // Solo id + rol — nunca nombre/email en un log (privacidad, punto 1).
    usuario: req.usuario ? { id: req.usuario.id, rol: req.usuario.rol } : null,
  }

  if (status >= 500) {
    logger.error({ ...contexto, err: { message: err.message, stack: err.stack } }, 'Error interno del servidor')
    // Fire-and-forget a propósito: nunca hay que esperar la alerta
    // para responderle al cliente. enviarAlerta() ya no tira sola,
    // pero el catch es una red de seguridad extra.
    enviarAlerta('error-5xx', `${req.method} ${req.originalUrl} → HTTP ${status}`, { ...contexto, mensaje: err.message }).catch(() => {})
  } else {
    logger.info({ ...contexto, status }, err.message ?? 'Error de cliente')
  }

  res.status(status).json({
    error: err.message ?? 'Error interno del servidor.',
    requestId: req.id,
    ...(config.entorno === 'development' && status >= 500 ? { stack: err.stack } : {}),
  })
}
