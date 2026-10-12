// ============================================================
// comunes.js — Piezas de esquema reutilizadas por varios dominios
// ============================================================
import { z } from 'zod'

// Los ids del store son crypto.randomUUID() en casi todos los casos,
// pero se deja como string no-vacío (no .uuid()) para no rechazar de
// más si algún día conviven ids con otro formato (ej. migraciones).
export const id = z.string().trim().min(1, 'Falta el identificador.')

export const email = z.string().trim().min(1, 'El correo es obligatorio.').email('Correo inválido.')

export const passwordNueva = z.string().min(8, 'La contraseña debe tener al menos 8 caracteres.')

export const textoCorto = (max = 200) => z.string().trim().min(1).max(max)
