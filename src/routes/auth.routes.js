// ============================================================
// auth.routes.js — /api/auth
// ============================================================
import { Router } from 'express'
import bcrypt from 'bcryptjs'
import rateLimit from 'express-rate-limit'
import { buscar, listar, insertar, actualizar } from '../db/store.js'
import { firmarToken, firmarTokenInvitado, requiereAuth, requiereRol } from '../middleware/auth.js'
import { registrarSesion } from '../db/pg.js'
import { ROLES } from '../db/seed.js'
import { descifrar } from '../services/crypto.js'
import { VERSION_ACTUAL, TEXTO_ACTUAL, avisoPendiente } from '../domain/avisoPrivacidad.js'
import {
  crearToken, consumirToken, crearCodigoLogin, verificarCodigoLogin, reenviarCodigoLogin, CODIGO_TTL_MIN,
} from '../services/tokens.js'
import {
  enviarVerificacionCuenta, enviarResetPassword, enviarAvisoCambioPassword,
  enviarConfirmacionCambioEmail, enviarAvisoCambioEmail, enviarCodigoLogin,
} from '../services/email.js'
import { config } from '../config.js'
import { exigirCaptcha } from '../services/captcha.js'
import { validar } from '../middleware/validar.js'
import {
  loginSchema, invitadoSchema, actualizarPerfilSchema, cambiarPasswordSchema,
  verificarCuentaSchema, emailOpcionalSchema, resetPasswordSchema, tokenSchema,
  codigoLoginSchema, reenviarCodigoSchema,
} from '../schemas/auth.schemas.js'

const r = Router()

// Límite propio (más estricto que el general de /api/auth) para las
// dos acciones que un atacante podría usar para bombardear el correo
// de alguien más o para tantear qué emails existen en el sistema.
const limiteSensible = rateLimit({
  windowMs: 15 * 60_000, max: 5,
  message: { error: 'Demasiados intentos. Espera unos minutos y vuelve a intentar.' },
  standardHeaders: true, legacyHeaders: false,
})

const RESPUESTA_GENERICA = {
  ok: true,
  mensaje: 'Si ese correo existe en el sistema, te mandamos instrucciones.',
}

/** Sesión iniciada: token + datos públicos del usuario. */
function abrirSesion(res, u) {
  actualizar('usuarios', u.id, { ultimo_acceso: new Date().toISOString() })
  registrarSesion({ usuario_id: u.id, email: u.email })   // bitácora de login en Postgres (si hay BD)
  res.json({
    token: firmarToken(u),
    usuario: { id: u.id, email: u.email, nombre: u.nombre, rol: u.rol, rolNombre: ROLES[u.rol]?.nombre, avatar: u.avatar ?? null },
  })
}

/** "juan.perez@gmail.com" → "ju•••••••@gmail.com", para decir a dónde se mandó el código. */
function enmascarar(email) {
  const [usuario, dominio] = String(email).split('@')
  return `${usuario.slice(0, 2)}${'•'.repeat(Math.max(3, usuario.length - 2))}@${dominio}`
}

// ── POST /api/auth/login  (admin | curador | docente) ──────
// 1) Captcha ("No soy un robot") y contraseña.
// 2) Si LOGIN_CODIGO_EMAIL está activo (por defecto), NO se entrega la
//    sesión todavía: se manda un código de 6 dígitos al correo y se
//    responde { requiereCodigo, desafio }. La sesión sale de
//    POST /login/verificar con ese desafío + el código.
// Todo /login/* pasa por el límite de intentos FALLIDOS (index.js).
r.post('/login', validar(loginSchema), exigirCaptcha(), async (req, res) => {
  const { email, password } = req.body
  const u = buscar('usuarios', (x) => x.email === String(email).toLowerCase())
  // Mensaje genérico a propósito: no revelamos si el email existe, si
  // la cuenta todavía está pendiente de verificar, ni si está de baja.
  if (!u || !u.activo || !u.password_hash || !u.email_verificado) {
    return res.status(401).json({ error: 'Credenciales incorrectas.' })
  }
  if (!bcrypt.compareSync(password, u.password_hash)) {
    return res.status(401).json({ error: 'Credenciales incorrectas.' })
  }

  if (!config.loginCodigoEmail) return abrirSesion(res, u)

  const { desafio, codigo } = crearCodigoLogin(u.id)
  enviarCodigoLogin({ email: u.email, nombre: u.nombre, codigo, minutos: CODIGO_TTL_MIN })
  res.json({ requiereCodigo: true, desafio, enviadoA: enmascarar(u.email), minutos: CODIGO_TTL_MIN })
})

// ── POST /api/auth/login/verificar — Body: { desafio, codigo } ──
r.post('/login/verificar', validar(codigoLoginSchema), (req, res) => {
  const r_ = verificarCodigoLogin(req.body.desafio, req.body.codigo)
  if (!r_.ok) {
    const mensajes = {
      invalido: 'El código venció o ya se usó. Vuelve a iniciar sesión.',
      agotado: 'Demasiados intentos con ese código. Vuelve a iniciar sesión para recibir otro.',
      incorrecto: `Código incorrecto. Te quedan ${r_.restantes} intento(s).`,
    }
    return res.status(401).json({ error: mensajes[r_.motivo], motivo: r_.motivo })
  }
  const u = buscar('usuarios', (x) => x.id === r_.usuarioId)
  // La cuenta pudo darse de baja entre la contraseña y el código.
  if (!u || !u.activo) return res.status(401).json({ error: 'Credenciales incorrectas.' })
  abrirSesion(res, u)
})

// ── POST /api/auth/login/reenviar — Body: { desafio } ───────
r.post('/login/reenviar', limiteSensible, validar(reenviarCodigoSchema), (req, res) => {
  const nuevo = reenviarCodigoLogin(req.body.desafio)
  if (!nuevo) {
    return res.status(400).json({ error: 'No se puede reenviar el código. Vuelve a iniciar sesión.' })
  }
  const u = buscar('usuarios', (x) => x.id === nuevo.usuarioId)
  if (u) enviarCodigoLogin({ email: u.email, nombre: u.nombre, codigo: nuevo.codigo, minutos: CODIGO_TTL_MIN })
  res.json({ ok: true, minutos: CODIGO_TTL_MIN })
})

// ── POST /api/auth/invitado  (estudiante SIN cuenta) ───────
// Body: { codigo, nombre }                    → sala ad-hoc (sin clase)
// Body: { codigo, codigoMatricula }            → sala vinculada a una clase
// Si la sala tiene clase_id, el estudiante YA fue registrado por
// admin/curador a inicio de semestre y entra con su código de
// matrícula (nunca con nombre libre); si no, se mantiene el flujo
// de siempre (nombre libre) para salas sueltas.
r.post('/invitado', validar(invitadoSchema), (req, res) => {
  const { codigo, nombre, codigoMatricula } = req.body
  const sala = buscar('salas', (s) => s.codigo === String(codigo).trim() && s.activa)
  if (!sala) return res.status(404).json({ error: 'Código incorrecto o sala cerrada.' })
  if (sala.expira_en && Date.now() > new Date(sala.expira_en).getTime()) {
    return res.status(410).json({ error: 'Esa sala ya expiró. Pide un código nuevo.' })
  }

  if (sala.clase_id) {
    if (!codigoMatricula?.trim()) {
      return res.status(400).json({ error: 'Se necesita tu código de estudiante.' })
    }
    const est = buscar('estudiantes', (e) =>
      e.codigo_matricula === codigoMatricula.trim().toUpperCase() && e.clase_id === sala.clase_id)
    if (!est || !est.activo) return res.status(404).json({ error: 'Código de estudiante inválido.' })
    if (est.purgado_en) {
      return res.status(410).json({ error: 'Este código ya no está activo (el registro fue purgado tras el retiro).' })
    }
    const nombreReal = descifrar(est.nombre)

    const token = firmarTokenInvitado({
      salaId: sala.id, codigo: sala.codigo, nombre: nombreReal, estudianteId: est.id,
    })
    return res.json({
      token,
      usuario: { nombre: nombreReal, rol: 'estudiante', tipo: 'invitado', codigo: sala.codigo, estudianteId: est.id },
      sala: { id: sala.id, codigo: sala.codigo, modo: sala.modo, titulo: sala.titulo },
    })
  }

  if (!nombre?.trim()) {
    return res.status(400).json({ error: 'Se necesitan el código de sala y tu nombre.' })
  }
  const token = firmarTokenInvitado({
    salaId: sala.id, codigo: sala.codigo, nombre: nombre.trim(),
  })
  res.json({
    token,
    usuario: { nombre: nombre.trim(), rol: 'estudiante', tipo: 'invitado', codigo: sala.codigo },
    sala: { id: sala.id, codigo: sala.codigo, modo: sala.modo, titulo: sala.titulo },
  })
})

// ── GET /api/auth/yo ───────────────────────────────────────
r.get('/yo', requiereAuth, (req, res) => {
  const u = buscar('usuarios', (x) => x.id === req.usuario.id)
  res.json({ usuario: {
    ...req.usuario,
    rolNombre: ROLES[req.usuario.rol]?.nombre,
    avatar: u?.avatar ?? null,
    avisoPrivacidadPendiente: u ? avisoPendiente(u) : false,
    emailPendiente: u?.email_pendiente ?? null,
  } })
})

// ── GET /api/auth/aviso-privacidad ─────────────────────────
// Texto del aviso para el staff + si a ESTA cuenta le falta aceptarlo.
r.get('/aviso-privacidad', requiereAuth, requiereRol('admin', 'curador', 'docente'), (req, res) => {
  const u = buscar('usuarios', (x) => x.id === req.usuario.id)
  res.json({
    version: VERSION_ACTUAL,
    texto: TEXTO_ACTUAL,
    pendiente: u ? avisoPendiente(u) : true,
  })
})

// ── POST /api/auth/aviso-privacidad/aceptar ────────────────
// Aceptación ACTIVA: guarda versión + momento exacto.
r.post('/aviso-privacidad/aceptar', requiereAuth, requiereRol('admin', 'curador', 'docente'), (req, res) => {
  const act = actualizar('usuarios', req.usuario.id, {
    aviso_privacidad_version: VERSION_ACTUAL,
    aviso_privacidad_en: new Date().toISOString(),
  })
  res.json({ ok: true, version: act.aviso_privacidad_version, en: act.aviso_privacidad_en })
})

// ── PATCH /api/auth/perfil ─────────────────────────────────
// Cada cuenta edita SU PROPIO perfil: nombre, email, avatar y
// (opcionalmente) contraseña. NO puede cambiar su rol ni darse
// de baja: eso es exclusivo del admin sobre terceros.
//
// El EMAIL nunca se cambia al toque: queda "pendiente" y solo toma
// efecto cuando se confirma desde un enlace mandado al correo NUEVO
// — si alguien más pusiera su propio correo aquí (cuenta secuestrada
// o error), no podría tomar la cuenta sin además tener acceso a esa
// bandeja de entrada.
r.patch('/perfil', requiereAuth, requiereRol('admin', 'curador', 'docente'), validar(actualizarPerfilSchema), (req, res) => {
  const u = buscar('usuarios', (x) => x.id === req.usuario.id)
  if (!u) return res.status(404).json({ error: 'Cuenta no encontrada.' })
  const { nombre, email, avatar, passwordActual, passwordNueva } = req.body
  const parche = {}
  let cambioEmailSolicitado = false

  if (nombre !== undefined) parche.nombre = nombre

  if (email !== undefined && email.toLowerCase() !== u.email) {
    const correo = email.toLowerCase()
    if (buscar('usuarios', (x) => x.email === correo && x.id !== u.id)) {
      return res.status(409).json({ error: 'Ya existe otra cuenta con ese email.' })
    }
    parche.email_pendiente = correo
    parche.email_pendiente_en = new Date().toISOString()
    cambioEmailSolicitado = true
  }

  // avatar: se acepta null (quitar) o un data URL de imagen (la forma
  // ya la garantiza el esquema; el tamaño se sigue revisando acá
  // porque es un 413, no un 400 de "forma inválida").
  if (avatar === null) parche.avatar = null
  else if (avatar !== undefined) {
    if (avatar.length > 700_000) {
      return res.status(413).json({ error: 'La imagen es muy pesada. Usa una de menos de ~500 KB.' })
    }
    parche.avatar = avatar
  }

  let cambioPassword = false
  if (passwordNueva !== undefined) {
    if (!bcrypt.compareSync(passwordActual ?? '', u.password_hash)) {
      return res.status(401).json({ error: 'La contraseña actual no coincide.' })
    }
    parche.password_hash = bcrypt.hashSync(passwordNueva, 10)
    cambioPassword = true
  }

  const act = actualizar('usuarios', u.id, parche)

  if (cambioEmailSolicitado) {
    const token = crearToken(u.id, 'cambio_email', { email_nuevo: parche.email_pendiente })
    enviarConfirmacionCambioEmail({ emailNuevo: parche.email_pendiente, nombre: act.nombre, token })
  }
  if (cambioPassword) enviarAvisoCambioPassword({ email: act.email, nombre: act.nombre })

  res.json({ usuario: {
    id: act.id, email: act.email, nombre: act.nombre, rol: act.rol,
    rolNombre: ROLES[act.rol]?.nombre, avatar: act.avatar ?? null,
    emailPendiente: act.email_pendiente ?? null,
  }, cambioEmailPendiente: cambioEmailSolicitado })
})

// ── POST /api/auth/perfil/reenviar-cambio-email ─────────────
// Por si el correo de confirmación no llegó o venció.
r.post('/perfil/reenviar-cambio-email', requiereAuth, requiereRol('admin', 'curador', 'docente'), limiteSensible, (req, res) => {
  const u = buscar('usuarios', (x) => x.id === req.usuario.id)
  if (!u?.email_pendiente) return res.status(400).json({ error: 'No tienes un cambio de correo pendiente.' })
  const token = crearToken(u.id, 'cambio_email', { email_nuevo: u.email_pendiente })
  enviarConfirmacionCambioEmail({ emailNuevo: u.email_pendiente, nombre: u.nombre, token })
  res.json({ ok: true })
})

// ── POST /api/auth/perfil/cancelar-cambio-email ─────────────
r.post('/perfil/cancelar-cambio-email', requiereAuth, requiereRol('admin', 'curador', 'docente'), (req, res) => {
  actualizar('usuarios', req.usuario.id, { email_pendiente: null, email_pendiente_en: null })
  res.json({ ok: true })
})

// ── POST /api/auth/cambiar-password ────────────────────────
r.post('/cambiar-password', requiereAuth, requiereRol('admin', 'curador', 'docente'), validar(cambiarPasswordSchema), (req, res) => {
  const { actual, nueva } = req.body
  const u = buscar('usuarios', (x) => x.id === req.usuario.id)
  if (!bcrypt.compareSync(actual ?? '', u.password_hash)) {
    return res.status(401).json({ error: 'La contraseña actual no coincide.' })
  }
  actualizar('usuarios', u.id, { password_hash: bcrypt.hashSync(nueva, 10) })
  enviarAvisoCambioPassword({ email: u.email, nombre: u.nombre })
  res.json({ ok: true })
})

// ── GET /api/auth/roles ────────────────────────────────────
r.get('/roles', (_req, res) => res.json({ roles: ROLES }))

// ════════════════════════════════════════════════════════════
//  Verificación de cuenta (momento 1: primer login)
// ════════════════════════════════════════════════════════════

// ── POST /api/auth/verificar-cuenta — Body: { token, password? } ──
// Confirma el correo Y fija la contraseña por primera vez (un solo
// paso). Si el admin ya le había puesto una contraseña a mano desde
// el panel, `password` es opcional — el enlace solo confirma el correo.
r.post('/verificar-cuenta', validar(verificarCuentaSchema), exigirCaptcha(), (req, res) => {
  const { token, password } = req.body
  const t = consumirToken(token, 'verificacion_cuenta')
  if (!t) return res.status(400).json({ error: 'Ese enlace ya no es válido. Pide que te reenvíen la invitación.' })

  const u = buscar('usuarios', (x) => x.id === t.usuario_id)
  if (!u) return res.status(404).json({ error: 'Cuenta no encontrada.' })

  const parche = { email_verificado: true }
  if (!u.password_hash) {
    if (password === undefined) {
      return res.status(400).json({ error: 'Elige una contraseña de al menos 8 caracteres.' })
    }
    parche.password_hash = bcrypt.hashSync(password, 10)
  }
  const act = actualizar('usuarios', u.id, parche)
  res.json({
    token: firmarToken(act),
    usuario: { id: act.id, email: act.email, nombre: act.nombre, rol: act.rol, rolNombre: ROLES[act.rol]?.nombre, avatar: act.avatar ?? null },
  })
})

// ── POST /api/auth/reenviar-verificacion — Body: { email } ──
// Mensaje genérico siempre: no delata si el correo existe o si la
// cuenta ya estaba verificada.
r.post('/reenviar-verificacion', limiteSensible, validar(emailOpcionalSchema), (req, res) => {
  const { email } = req.body
  const u = email ? buscar('usuarios', (x) => x.email === String(email).toLowerCase()) : null
  if (u && u.activo && !u.email_verificado) {
    const token = crearToken(u.id, 'verificacion_cuenta')
    enviarVerificacionCuenta({ email: u.email, nombre: u.nombre, token, esReenvio: true })
  }
  res.json(RESPUESTA_GENERICA)
})

// ════════════════════════════════════════════════════════════
//  Restablecimiento de contraseña (momento 2)
// ════════════════════════════════════════════════════════════

// ── POST /api/auth/olvide-password — Body: { email } ────────
r.post('/olvide-password', limiteSensible, validar(emailOpcionalSchema), (req, res) => {
  const { email } = req.body
  const u = email ? buscar('usuarios', (x) => x.email === String(email).toLowerCase()) : null
  // Solo se manda a cuentas activas y ya verificadas — una pendiente
  // no tiene contraseña que "olvidar", usa reenviar-verificacion.
  if (u && u.activo && u.email_verificado) {
    const token = crearToken(u.id, 'reset_password')
    enviarResetPassword({ email: u.email, nombre: u.nombre, token })
  }
  res.json(RESPUESTA_GENERICA)
})

// ── POST /api/auth/reset-password — Body: { token, password } ──
r.post('/reset-password', validar(resetPasswordSchema), (req, res) => {
  const { token, password } = req.body
  const t = consumirToken(token, 'reset_password')
  if (!t) return res.status(400).json({ error: 'Ese enlace venció o ya se usó. Pide uno nuevo.' })

  const u = buscar('usuarios', (x) => x.id === t.usuario_id)
  if (!u) return res.status(404).json({ error: 'Cuenta no encontrada.' })

  actualizar('usuarios', u.id, { password_hash: bcrypt.hashSync(password, 10) })
  enviarAvisoCambioPassword({ email: u.email, nombre: u.nombre })
  res.json({ ok: true })
})

// ════════════════════════════════════════════════════════════
//  Cambio de email (momento 3): confirmación en el correo NUEVO
// ════════════════════════════════════════════════════════════

// ── POST /api/auth/confirmar-cambio-email — Body: { token } ──
r.post('/confirmar-cambio-email', validar(tokenSchema), (req, res) => {
  const { token } = req.body
  const t = consumirToken(token, 'cambio_email')
  if (!t) return res.status(400).json({ error: 'Ese enlace venció o ya se usó. Vuelve a pedir el cambio desde tu perfil.' })

  const u = buscar('usuarios', (x) => x.id === t.usuario_id)
  if (!u) return res.status(404).json({ error: 'Cuenta no encontrada.' })
  if (buscar('usuarios', (x) => x.email === t.email_nuevo && x.id !== u.id)) {
    return res.status(409).json({ error: 'Ya existe otra cuenta con ese email.' })
  }

  const anterior = u.email
  const act = actualizar('usuarios', u.id, { email: t.email_nuevo, email_pendiente: null, email_pendiente_en: null })
  enviarAvisoCambioEmail({ emailAnterior: anterior, emailNuevo: act.email, nombre: act.nombre })
  res.json({ ok: true, email: act.email })
})

export default r
