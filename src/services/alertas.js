// ============================================================
// alertas.js — Alertas si el servicio cae (punto 6: observabilidad)
// ============================================================
// Manda un POST a config.alertWebhookUrl (formato "incoming webhook"
// de Slack/Discord/Mattermost: { text }) cuando pasa algo que
// alguien debería mirar. Sin ALERT_WEBHOOK_URL configurada, no se
// manda nada por red — solo queda el log (nunca se pierde el aviso,
// solo el canal de notificación en vivo).
//
// Dónde se usa:
//   · index.js — uncaughtException / unhandledRejection (el proceso
//     se cae de verdad).
//   · middleware/errors.js — cualquier error 5xx (el servicio sigue
//     vivo, pero algo se está rompiendo en producción).
//
// Throttling: si el mismo tipo de problema (misma `clave`) ya mandó
// una alerta hace menos de 5 minutos, se silencia — sin esto, un bug
// que dispara 500 en cada request inundaría el webhook (y a quien
// esté del otro lado) en segundos.
// ============================================================
import { config } from '../config.js'
import { logger } from './logger.js'

const VENTANA_THROTTLE_MS = 5 * 60 * 1000
const ultimoEnvioPorClave = new Map()

/**
 * Nunca tira (es best-effort a propósito: una alerta que falla no
 * puede sumarse al problema que la disparó). Devuelve si efectivamente
 * mandó el webhook o no (útil para tests).
 */
export async function enviarAlerta(clave, mensaje, contexto = {}) {
  if (!config.alertWebhookUrl) {
    logger.warn({ clave, contexto }, `[alerta sin webhook configurado] ${mensaje}`)
    return false
  }

  const ahora = Date.now()
  const ultimo = ultimoEnvioPorClave.get(clave) ?? 0
  if (ahora - ultimo < VENTANA_THROTTLE_MS) {
    logger.debug({ clave }, '[alerta] silenciada por throttling (misma clave hace menos de 5 min)')
    return false
  }
  ultimoEnvioPorClave.set(clave, ahora)

  try {
    const controlador = new AbortController()
    const corte = setTimeout(() => controlador.abort(), 5000)
    const res = await fetch(config.alertWebhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: `🚨 English Lessons API — ${mensaje}\n\`\`\`${JSON.stringify(contexto, null, 2)}\`\`\`` }),
      signal: controlador.signal,
    })
    clearTimeout(corte)
    if (!res.ok) throw new Error(`webhook respondió HTTP ${res.status}`)
    return true
  } catch (e) {
    logger.error({ clave, err: e.message }, '[alerta] no se pudo mandar el webhook')
    return false
  }
}

/** Solo para tests: limpia el throttling entre corridas. */
export function _reiniciarThrottleDeAlertas() {
  ultimoEnvioPorClave.clear()
}
