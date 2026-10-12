// ============================================================
// auth.js — JWT + control de acceso por rol
// ============================================================
// Dos tipos de token:
//   1. Token de CUENTA  (admin / curador / docente) — login con
//      email + contraseña.
//   2. Token de INVITADO (estudiante) — NO tiene cuenta: se emite
//      al canjear un código de sala + su nombre. Va atado a esa
//      sala y caduca solo. No puede tocar nada más.
// ============================================================
import jwt from 'jsonwebtoken'
import { config } from '../config.js'
import { buscar } from '../db/store.js'

export const JERARQUIA = { estudiante: 1, docente: 2, curador: 3, admin: 4 }

export function firmarToken(usuario) {
  return jwt.sign(
    { sub: usuario.id, email: usuario.email, rol: usuario.rol, nombre: usuario.nombre, tipo: 'cuenta' },
    config.jwtSecret,
    { expiresIn: config.jwtExpira }
  )
}

export function firmarTokenInvitado({ salaId, codigo, nombre, partidaId = null, estudianteId = null }) {
  return jwt.sign(
    { sub: `guest:${salaId}`, rol: 'estudiante', nombre, salaId, codigo, partidaId, estudianteId, tipo: 'invitado' },
    config.jwtSecret,
    { expiresIn: config.jwtExpiraAlumno }
  )
}

/** Extrae el token del header Authorization: Bearer xxx */
function extraer(req) {
  const h = req.headers.authorization ?? ''
  return h.startsWith('Bearer ') ? h.slice(7) : null
}

/** Autenticación obligatoria. */
export function requiereAuth(req, res, next) {
  const token = extraer(req)
  if (!token) return res.status(401).json({ error: 'Falta el token de acceso.' })
  try {
    const payload = jwt.verify(token, config.jwtSecret)
    if (payload.tipo === 'cuenta') {
      const u = buscar('usuarios', (x) => x.id === payload.sub)
      if (!u || !u.activo) return res.status(401).json({ error: 'Cuenta inexistente o desactivada.' })
      req.usuario = { id: u.id, email: u.email, rol: u.rol, nombre: u.nombre, tipo: 'cuenta' }
    } else {
      req.usuario = {
        id: payload.sub, rol: 'estudiante', nombre: payload.nombre,
        salaId: payload.salaId, codigo: payload.codigo, partidaId: payload.partidaId,
        estudianteId: payload.estudianteId ?? null,
        tipo: 'invitado',
      }
    }
    next()
  } catch {
    return res.status(401).json({ error: 'Token inválido o expirado.' })
  }
}

/** Autenticación opcional: rellena req.usuario si hay token válido. */
export function authOpcional(req, _res, next) {
  const token = extraer(req)
  if (!token) return next()
  try {
    const p = jwt.verify(token, config.jwtSecret)
    req.usuario = p.tipo === 'cuenta'
      ? { id: p.sub, email: p.email, rol: p.rol, nombre: p.nombre, tipo: 'cuenta' }
      : { id: p.sub, rol: 'estudiante', nombre: p.nombre, salaId: p.salaId, codigo: p.codigo, partidaId: p.partidaId, estudianteId: p.estudianteId ?? null, tipo: 'invitado' }
  } catch { /* token basura: se ignora */ }
  next()
}

/** Exige uno de los roles indicados. */
export function requiereRol(...roles) {
  return (req, res, next) => {
    if (!req.usuario) return res.status(401).json({ error: 'No autenticado.' })
    if (!roles.includes(req.usuario.rol)) {
      return res.status(403).json({ error: `Acceso denegado. Requiere: ${roles.join(' o ')}.` })
    }
    next()
  }
}

/** Exige un nivel mínimo en la jerarquía (admin pasa por todo). */
export function requiereNivel(rolMinimo) {
  return (req, res, next) => {
    if (!req.usuario) return res.status(401).json({ error: 'No autenticado.' })
    if ((JERARQUIA[req.usuario.rol] ?? 0) < (JERARQUIA[rolMinimo] ?? 99)) {
      return res.status(403).json({ error: `Acceso denegado. Requiere nivel ${rolMinimo} o superior.` })
    }
    next()
  }
}

/** El invitado solo puede operar sobre SU sala. */
export function mismaSala(paramCodigo = 'codigo') {
  return (req, res, next) => {
    if (req.usuario?.tipo !== 'invitado') return next()
    const codigo = req.params[paramCodigo] ?? req.body?.codigo
    if (codigo && String(codigo) !== String(req.usuario.codigo)) {
      return res.status(403).json({ error: 'Este token no pertenece a esa sala.' })
    }
    next()
  }
}
