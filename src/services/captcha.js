// ============================================================
// captcha.js — "No soy un robot" con Cloudflare Turnstile
// ============================================================
// El navegador resuelve el captcha y manda el token que le da
// Turnstile; AQUÍ se valida contra Cloudflare con la clave secreta
// (nunca en el navegador: si no, bastaría con llamar a la API directo
// para saltárselo). Se usa en el inicio de sesión y al activar una
// cuenta nueva.
//
// Sin TURNSTILE_SECRET_KEY el captcha queda desactivado (desarrollo y
// tests); en producción el servidor avisa al arrancar si falta.
// Claves de prueba oficiales de Cloudflare (siempre aprueban):
//   sitio 1x00000000000000000000AA · secreta 1x0000000000000000000000000000000AA
// ============================================================
import { config } from '../config.js'
import { logger } from './logger.js'

const VERIFICAR = 'https://challenges.cloudflare.com/turnstile/v0/siteverify'

export const captchaActivo = () => Boolean(config.turnstileSecret)

/** ¿El token del captcha es válido? Si Cloudflare no responde, NO se deja pasar. */
export async function verificarCaptcha(token, ip) {
  if (!captchaActivo()) return true
  if (!token) return false
  const controlador = new AbortController()
  const t = setTimeout(() => controlador.abort(), 8000)
  try {
    const res = await fetch(VERIFICAR, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ secret: config.turnstileSecret, response: token, ...(ip ? { remoteip: ip } : {}) }),
      signal: controlador.signal,
    })
    const data = await res.json().catch(() => ({}))
    if (!data.success) logger.info({ errores: data['error-codes'] }, '[captcha] rechazado')
    return Boolean(data.success)
  } catch (e) {
    logger.warn({ err: e.message }, '[captcha] no se pudo verificar con Cloudflare')
    return false
  } finally {
    clearTimeout(t)
  }
}

/** Middleware: exige un captcha válido en `req.body.captcha`. */
export function exigirCaptcha() {
  return async (req, res, next) => {
    if (await verificarCaptcha(req.body?.captcha, req.ip)) return next()
    res.status(400).json({ error: 'Completa la verificación "No soy un robot" e inténtalo de nuevo.', captcha: true })
  }
}
