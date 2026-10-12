import { z } from 'zod'
import { id } from './comunes.js'

const bookId = z.union([z.string(), z.number()])

export const crearClaseSchema = z.object({
  nombre: z.string().trim().min(1, 'El nombre de la clase es obligatorio.').max(80),
  periodo: z.string().trim().max(40).optional(),
  bookId: bookId.optional(),
  docenteId: id.optional(),
})

export const editarClaseSchema = z.object({
  nombre: z.string().trim().min(1).max(80).optional(),
  periodo: z.string().trim().max(40).optional(),
  bookId: bookId.nullable().optional(),
  docenteId: id.nullable().optional(),
  activa: z.boolean().optional(),
})

// Importación masiva (punto 3): una fila por estudiante. `nombre`
// llega tal cual lo pegó el usuario (normalizarFila() en
// classes.routes.js recorta espacios y longitud); acá solo se exige
// que sea texto y que el lote tenga un tamaño razonable.
const filaImport = z.object({
  nombre: z.string().max(200).optional().default(''),
  codigoExterno: z.string().max(100).optional().nullable(),
})

export const importarEstudiantesSchema = z.object({
  filas: z.array(filaImport)
    .min(1, 'Manda al menos una fila.')
    .max(300, 'Máximo 300 filas por lote.'),
})
