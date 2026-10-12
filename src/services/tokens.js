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
