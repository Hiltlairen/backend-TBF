// ============================================================
// admin.routes.js — /api/admin   (solo rol ADMIN)
// ============================================================
import { Router } from 'express'
import bcrypt from 'bcryptjs'
import { listar, buscar, insertar, actualizar } from '../db/store.js'
import { requiereAuth, requiereRol } from '../middleware/auth.js'
import { ROLES } from '../db/seed.js'
import { crearToken } from '../services/tokens.js'
import { enviarVerificacionCuenta } from '../services/email.js'
import { validar } from '../middleware/validar.js'
import { crearUsuarioSchema, editarUsuarioSchema } from '../schemas/admin.schemas.js'
import { respaldarAhora, listarBackups } from '../services/backups.js'

const r = Router()
const soloAdmin = [requiereAuth, requiereRol('admin')]

const publico = (u) => ({
  id: u.id, email: u.email, nombre: u.nombre, rol: u.rol,
  rolNombre: ROLES[u.rol]?.nombre, activo: u.activo,
  avatar: u.avatar ?? null,
  emailVerificado: Boolean(u.email_verificado),
  estado: u.email_verificado ? 'activa' : 'pendiente',
  creado_en: u.creado_en, ultimo_acceso: u.ultimo_acceso ?? null,
})

r.get('/usuarios', ...soloAdmin, (_req, res) => {
  res.json({ usuarios: listar('usuarios').map(publico) })
})

// El admin YA NO pone la contraseña: la cuenta nace pendiente y el
// propio dueño la activa desde el enlace de verificación que le
// mandamos por correo — así el admin nunca conoce la contraseña de
// nadie más.
r.post('/usuarios', ...soloAdmin, validar(crearUsuarioSchema), (req, res) => {
  const { email, nombre, rol } = req.body
  const correo = email.toLowerCase()
  if (buscar('usuarios', (u) => u.email === correo)) {
    return res.status(409).json({ error: 'Ya existe un usuario con ese email.' })
  }
  const u = insertar('usuarios', {
    email: correo, nombre, rol,
    password_hash: null, activo: true, email_verificado: false,
  })
  const token = crearToken(u.id, 'verificacion_cuenta')
  enviarVerificacionCuenta({ email: u.email, nombre: u.nombre, token })
  res.status(201).json({ usuario: publico(u) })
})

// Reenvía el enlace de activación (enlace vencido, correo perdido, etc.)
r.post('/usuarios/:id/reenviar-invitacion', ...soloAdmin, (req, res) => {
  const u = buscar('usuarios', (x) => x.id === req.params.id)
  if (!u) return res.status(404).json({ error: 'Usuario no encontrado.' })
  if (u.email_verificado) return res.status(409).json({ error: 'Esa cuenta ya está activa.' })
  const token = crearToken(u.id, 'verificacion_cuenta')
  enviarVerificacionCuenta({ email: u.email, nombre: u.nombre, token, esReenvio: true })
  res.json({ ok: true })
})

r.patch('/usuarios/:id', ...soloAdmin, validar(editarUsuarioSchema), (req, res) => {
  const u = buscar('usuarios', (x) => x.id === req.params.id)
  if (!u) return res.status(404).json({ error: 'Usuario no encontrado.' })
  const { nombre, rol, activo, password } = req.body
  // Nadie se da de baja ni se quita el rol de admin a sí mismo: se
  // quedaría fuera del panel sin que nadie lo haya decidido.
  if (u.id === req.usuario.id && (activo === false || (rol !== undefined && rol !== u.rol))) {
    return res.status(409).json({ error: 'No puedes darte de baja ni cambiar tu propio rol.' })
  }
  const parche = {}
  if (nombre !== undefined) parche.nombre = nombre
  if (rol !== undefined) parche.rol = rol
  if (activo !== undefined) parche.activo = activo
  if (password !== undefined) parche.password_hash = bcrypt.hashSync(password, 10)
  // No dejar el sistema sin ningún admin activo
  if ((parche.rol && parche.rol !== 'admin') || parche.activo === false) {
    const admins = listar('usuarios', (x) => x.rol === 'admin' && x.activo && x.id !== u.id)
    if (u.rol === 'admin' && admins.length === 0) {
      return res.status(409).json({ error: 'No puedes dejar el sistema sin administradores activos.' })
    }
  }
  res.json({ usuario: publico(actualizar('usuarios', u.id, parche)) })
})

// Baja de cuenta (NO se elimina: solo se desactiva). Se conserva
// el registro para no perder la autoría de actividades ni el
// historial. Reactivable desde el mismo panel.
r.post('/usuarios/:id/baja', ...soloAdmin, (req, res) => {
  const u = buscar('usuarios', (x) => x.id === req.params.id)
  if (!u) return res.status(404).json({ error: 'Usuario no encontrado.' })
  if (u.id === req.usuario.id) return res.status(409).json({ error: 'No puedes darte de baja a ti mismo.' })
  if (u.rol === 'admin') {
    const admins = listar('usuarios', (x) => x.rol === 'admin' && x.activo && x.id !== u.id)
    if (!admins.length) return res.status(409).json({ error: 'No puedes dejar el sistema sin administradores activos.' })
  }
  res.json({ usuario: publico(actualizar('usuarios', u.id, { activo: false })) })
})

// Panorama general del sistema
r.get('/panorama', ...soloAdmin, (_req, res) => {
  res.json({
    usuarios: listar('usuarios').length,
    porRol: ['admin', 'curador', 'docente'].reduce((acc, rol) => {
      acc[rol] = listar('usuarios', (u) => u.rol === rol).length
      return acc
    }, {}),
    actividades: listar('actividades').length,
    rutas: listar('rutas').length,
    salasActivas: listar('salas', (s) => s.activa).length,
    partidas: listar('partidas').length,
    resultados: listar('resultados').length,
    revisionesPendientes: listar('revisiones', (x) => x.estado === 'pendiente').length,
  })
})

r.get('/auditoria', ...soloAdmin, (_req, res) => {
  res.json({ eventos: listar('auditoria', (a) => a.tipo !== 'vocab').slice(-200).reverse() })
})

// ── Backups (punto 6) ────────────────────────────────────────
// Solo API por ahora, sin pantalla propia en el dashboard — mismo
// criterio que /auditoria arriba. El job automático (ver
// services/backups.js) ya corre solo; esto es para viveza operativa:
// ver qué hay respaldado, o forzar uno antes de un cambio riesgoso.
r.get('/backups', ...soloAdmin, (_req, res) => {
  res.json({ backups: listarBackups() })
})

r.post('/backups', ...soloAdmin, (req, res) => {
  try {
    const { nombre, manifest, podados } = respaldarAhora({ motivo: 'manual' })
    insertar('auditoria', {
      tipo: 'backup', accion: 'manual', nombre,
      por: req.usuario.id, por_nombre: req.usuario.nombre,
    })
    res.status(201).json({ nombre, manifest, podados })
  } catch (e) {
    res.status(500).json({ error: `No se pudo crear el backup: ${e.message}` })
  }
})

export default r
