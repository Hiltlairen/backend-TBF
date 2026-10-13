// ============================================================
// tokens.js — Tokens de un solo uso (verificación / reset / cambio de email)
// ============================================================
// Nunca se guarda el token en claro: se manda por correo el valor
// crudo y solo su HASH queda en la base. Así, aunque alguien lea el
// archivo/tabla de tokens, no puede canjear ninguno.
//
// Vida corta (AUTH_TOKEN_TTL_MIN, 15–30 min razonable) y de un solo
// uso: al consumirse se marca `usado_en` y no vuelve a servir. Pedir
// uno nuevo del mismo tipo invalida cualquier anterior sin usar —
// evita que queden varios enlaces "vivos" para la misma acción.
// ============================================================
import crypto from 'node:crypto'
import { insertar, listar, actualizar, buscar } from '../db/store.js'
import { config } from '../config.js'

const hash = (raw) => crypto.createHash('sha256').update(String(raw)).digest('hex')

/**
 * Crea un token para `usuarioId` + `tipo` ('verificacion_cuenta' |
 * 'reset_password' | 'cambio_email'). `extra` guarda datos propios
 * del tipo (ej. el correo nuevo, para cambio_email). Devuelve el
 * valor CRUDO — es lo único que viaja al correo del usuario.
 */
export function crearToken(usuarioId, tipo, extra = {}) {
  const previos = listar('tokens_auth', (t) => t.usuario_id === usuarioId && t.tipo === tipo && !t.usado_en)
  const ahora = new Date().toISOString()
  for (const t of previos) actualizar('tokens_auth', t.id, { usado_en: ahora, usado_motivo: 'reemplazado' })

  const raw = crypto.randomBytes(32).toString('base64url')
  insertar('tokens_auth', {
    usuario_id: usuarioId,
    tipo,
    token_hash: hash(raw),
    expira_en: new Date(Date.now() + config.tokenTtlMin * 60 * 1000).toISOString(),
    usado_en: null,
    usado_motivo: null,
    ...extra,
  })
  return raw
}

/**
 * Intenta canjear un token. Válido solo si existe, es del tipo
 * esperado, no venció y no se usó antes. Lo marca usado de inmediato
 * (de un solo uso, así falle lo que venga después). Devuelve el
 * registro del token, o null si no sirve por cualquier motivo.
 */
export function consumirToken(raw, tipo) {
  if (!raw) return null
  const t = buscar('tokens_auth', (x) => x.token_hash === hash(raw) && x.tipo === tipo)
  if (!t || t.usado_en) return null
  if (new Date(t.expira_en).getTime() < Date.now()) return null
  actualizar('tokens_auth', t.id, { usado_en: new Date().toISOString(), usado_motivo: 'consumido' })
  return t
}

// ============================================================
//  Código de inicio de sesión (segundo factor por correo)
// ============================================================
// Tras la contraseña correcta, se manda un código de 6 dígitos al
// correo de la cuenta. El navegador recibe un `desafio` opaco (no un
// token de sesión): para entrar tiene que presentar desafío + código.
//   · Vive CODIGO_TTL_MIN minutos y es de un solo uso.
//   · Máximo CODIGO_INTENTOS intentos: después hay que pedir otro.
//   · Solo se guarda el hash del código (y el del desafío).
//   · Pedir un código nuevo invalida el anterior.
export const CODIGO_TTL_MIN = 10
export const CODIGO_INTENTOS = 5
export const CODIGO_REENVIOS = 3

const hashCodigo = (usuarioId, codigo) => hash(`${usuarioId}:${String(codigo).trim()}`)
const codigoAlAzar = () => String(crypto.randomInt(0, 1_000_000)).padStart(6, '0')
const vence = () => new Date(Date.now() + CODIGO_TTL_MIN * 60 * 1000).toISOString()

/** Crea el desafío y su código. Devuelve { desafio, codigo } en claro (el código va al correo). */
export function crearCodigoLogin(usuarioId) {
  const codigo = codigoAlAzar()
  const desafio = crearToken(usuarioId, 'codigo_login', { codigo_hash: hashCodigo(usuarioId, codigo), intentos: 0, reenvios: 0 })
  actualizar('tokens_auth', buscar('tokens_auth', (t) => t.token_hash === hash(desafio)).id, { expira_en: vence() })
  return { desafio, codigo }
}

function desafioVigente(desafio) {
  if (!desafio) return null
  const t = buscar('tokens_auth', (x) => x.token_hash === hash(desafio) && x.tipo === 'codigo_login')
  if (!t || t.usado_en || new Date(t.expira_en).getTime() < Date.now()) return null
  return t
}

/**
 * Comprueba el código. Devuelve { ok: true, usuarioId } o
 * { ok: false, motivo: 'invalido' | 'incorrecto' | 'agotado', restantes? }.
 */
export function verificarCodigoLogin(desafio, codigo) {
  const t = desafioVigente(desafio)
  if (!t) return { ok: false, motivo: 'invalido' }

  const esperado = Buffer.from(t.codigo_hash, 'hex')
  const recibido = Buffer.from(hashCodigo(t.usuario_id, codigo ?? ''), 'hex')
  if (crypto.timingSafeEqual(esperado, recibido)) {
    actualizar('tokens_auth', t.id, { usado_en: new Date().toISOString(), usado_motivo: 'consumido' })
    return { ok: true, usuarioId: t.usuario_id }
  }

  const intentos = (t.intentos ?? 0) + 1
  if (intentos >= CODIGO_INTENTOS) {
    actualizar('tokens_auth', t.id, { intentos, usado_en: new Date().toISOString(), usado_motivo: 'intentos_agotados' })
    return { ok: false, motivo: 'agotado' }
  }
  actualizar('tokens_auth', t.id, { intentos })
  return { ok: false, motivo: 'incorrecto', restantes: CODIGO_INTENTOS - intentos }
}

/** Código nuevo para el MISMO desafío (el anterior deja de servir). null si no se puede. */
export function reenviarCodigoLogin(desafio) {
  const t = desafioVigente(desafio)
  if (!t || (t.reenvios ?? 0) >= CODIGO_REENVIOS) return null
  const codigo = codigoAlAzar()
  actualizar('tokens_auth', t.id, {
    codigo_hash: hashCodigo(t.usuario_id, codigo), intentos: 0, reenvios: (t.reenvios ?? 0) + 1, expira_en: vence(),
  })
  return { usuarioId: t.usuario_id, codigo }
}
