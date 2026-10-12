import { z } from 'zod'
import { email as emailSchema } from './comunes.js'

const ROLES_CREABLES = ['admin', 'curador', 'docente']

export const crearUsuarioSchema = z.object({
  email: emailSchema,
  nombre: z.string().trim().min(1, 'El nombre es obligatorio.').max(120),
  rol: z.enum(ROLES_CREABLES, { message: `El rol debe ser uno de: ${ROLES_CREABLES.join(', ')}.` }),
})

// Antes, un `rol` fuera de catálogo o un `activo` que no fuera booleano
// se ignoraban en silencio (el resto del parche sí se aplicaba). Ahora
// se rechaza el request completo con 400 — más claro para quien integra
// contra esta API, aunque sea un cambio de comportamiento respecto a
// antes (documentado en el README).
export const editarUsuarioSchema = z.object({
  nombre: z.string().trim().min(1).max(120).optional(),
  rol: z.enum(ROLES_CREABLES).optional(),
  activo: z.boolean().optional(),
  password: z.string().min(8, 'La contraseña debe tener al menos 8 caracteres.').optional(),
})
