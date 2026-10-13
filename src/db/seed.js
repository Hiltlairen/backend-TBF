// ============================================================
// seed.js — Usuarios iniciales (se ejecuta al arrancar)
// ============================================================
// Las contraseñas se guardan HASHEADAS con bcrypt.
// Están en texto plano SOLO aquí porque es un entorno de
// desarrollo/demo. En producción: borrar este archivo y crear
// los usuarios desde el panel de admin.
// ============================================================
import bcrypt from 'bcryptjs'
import { listar, insertar } from './store.js'

export const ROLES = {
  admin:      { nombre: 'Administrador',        nivel: 4 },
  curador:    { nombre: 'Curaduría de contenido', nivel: 3 },
  docente:    { nombre: 'Docente',              nivel: 2 },
  estudiante: { nombre: 'Estudiante',           nivel: 1 },
}

// ── CREDENCIALES DEMO ──────────────────────────────────────
export const USUARIOS_SEMILLA = [
  {
    email: 'admin@englishlessons.edu',
    password: 'Admin*2026',
    nombre: 'Dirección Académica',
    rol: 'admin',
  },
  {
    email: 'curaduria@englishlessons.edu',
    password: 'Curador*2026',
    nombre: 'Mesa de Curaduría',
    rol: 'curador',
  },
  {
    email: 'revision2@englishlessons.edu',
    password: 'Curador*2026',
    nombre: 'Ana Quispe (revisora)',
    rol: 'curador',
  },
  {
    email: 'docente@englishlessons.edu',
    password: 'Docente*2026',
    nombre: 'Prof. Laura Mamani',
    rol: 'docente',
  },
  {
    email: 'docente2@englishlessons.edu',
    password: 'Docente*2026',
    nombre: 'Prof. Diego Rojas',
    rol: 'docente',
  },
]

/**
 * Usuarios iniciales, solo si la colección está vacía:
 *   · demo=true  → las 5 cuentas demo de arriba (desarrollo).
 *   · demo=false → un único admin con `admin` ({email, password, nombre},
 *     de ADMIN_EMAIL / ADMIN_PASSWORD en producción). Sin esos datos no
 *     se crea nadie y se avisa.
 */
export function sembrar({ demo = true, admin = null } = {}) {
  const existentes = listar('usuarios')
  if (existentes.length > 0) return { creados: 0, total: existentes.length }

  if (!demo) {
    if (!admin?.email || !admin?.password) {
      console.warn('  ⚠️  No hay usuarios y no se definieron ADMIN_EMAIL / ADMIN_PASSWORD: nadie podrá entrar al panel.')
      return { creados: 0, total: 0 }
    }
    insertar('usuarios', {
      email: admin.email.trim().toLowerCase(),
      nombre: admin.nombre || 'Administración',
      rol: 'admin',
      password_hash: bcrypt.hashSync(admin.password, 10),
      activo: true,
      email_verificado: true,
    })
    return { creados: 1, total: 1, admin: true }
  }

  let creados = 0
  for (const u of USUARIOS_SEMILLA) {
    insertar('usuarios', {
      email: u.email.toLowerCase(),
      nombre: u.nombre,
      rol: u.rol,
      password_hash: bcrypt.hashSync(u.password, 10),
      activo: true,
      // Cuentas demo: ya "verificadas" para poder entrar de inmediato,
      // sin pasar por el flujo de activación por correo.
      email_verificado: true,
    })
    creados++
  }
  return { creados, total: creados }
}
