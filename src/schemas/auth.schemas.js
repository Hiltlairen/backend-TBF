import { z } from 'zod'
import { email as emailSchema, passwordNueva } from './comunes.js'

// `captcha`: token de Cloudflare Turnstile (se valida en services/captcha.js).
const captcha = z.string().max(4096).optional()

export const loginSchema = z.object({
  email: z.string().trim().min(1, 'El correo es obligatorio.'),
  password: z.string().min(1, 'La contraseña es obligatoria.'),
  captcha,
})

export const codigoLoginSchema = z.object({
  desafio: z.string().min(1, 'Falta el desafío.').max(200),
  codigo: z.string().trim().regex(/^\d{6}$/, 'El código tiene 6 dígitos.'),
})

export const reenviarCodigoSchema = z.object({
  desafio: z.string().min(1, 'Falta el desafío.').max(200),
})

// codigoMatricula/nombre: cuál de los dos hace falta depende de si la
// sala está vinculada a una clase (se sabe recién adentro de la ruta,
// consultando la BD) — eso sigue siendo un chequeo de negocio ahí.
export const invitadoSchema = z.object({
  codigo: z.string().trim().min(1, 'Falta el código de sala.'),
  nombre: z.string().trim().min(1).max(120).optional(),
  codigoMatricula: z.string().trim().min(1).max(20).optional(),
})

// Todo opcional (es un PATCH parcial): lo que SÍ venga tiene que
// tener el tipo correcto — antes, mandar un tipo equivocado se
// ignoraba en silencio; ahora se avisa con 400.
export const actualizarPerfilSchema = z.object({
  nombre: z.string().trim().min(1, 'El nombre no puede quedar vacío.').max(120).optional(),
  email: emailSchema.optional(),
  // El tamaño máximo (700kb) se sigue revisando a mano en la ruta,
  // que responde 413 — un esquema no distingue "mal formado" (400)
  // de "demasiado grande" (413).
  avatar: z.string().startsWith('data:image/', 'La foto debe ser una imagen.').nullable().optional(),
  passwordActual: z.string().optional(),
  passwordNueva: passwordNueva.optional(),
})

export const cambiarPasswordSchema = z.object({
  actual: z.string().min(1, 'Falta tu contraseña actual.'),
  nueva: passwordNueva,
})

// password: solo hace falta la primera vez (cuenta pendiente); ese
// "solo si..." depende del usuario en BD, sigue siendo negocio.
export const verificarCuentaSchema = z.object({
  token: z.string().min(1, 'Falta el token.'),
  password: passwordNueva.optional(),
  captcha,
})

export const emailOpcionalSchema = z.object({
  email: z.string().trim().email('Correo inválido.').optional(),
})

export const resetPasswordSchema = z.object({
  token: z.string().min(1, 'Falta el token.'),
  password: passwordNueva,
})

export const tokenSchema = z.object({
  token: z.string().min(1, 'Falta el token.'),
})
