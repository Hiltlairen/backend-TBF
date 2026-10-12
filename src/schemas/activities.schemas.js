import { z } from 'zod'
import { id } from './comunes.js'

// El id de una lección es numérico en content.json, pero puede llegar
// como string desde un <select> del cliente.
const leccionId = z.union([z.string(), z.number()])
const configLibre = z.record(z.string(), z.unknown())

export const vistaPreviaRutaSchema = z.object({
  actividades: z.array(z.string().min(1)).min(1, 'Manda al menos una actividad.'),
  etapas: z.number().int().positive().optional(),
  umbrales: configLibre.optional(),
})

// La clase es obligatoria: el docente solo genera para los cursos que
// le asignaron, y el curso de la actividad es el nombre de esa clase
// (ya no se manda un `curso` escrito a mano; si llega, zod lo descarta).
const claseId = id.describe('Clase asignada al docente')

// `codigo` se valida contra el catálogo real (ACTIVITY_SCENES) dentro
// de la ruta — es un catálogo vivo, no tiene sentido duplicarlo acá.
export const generarActividadSchema = z.object({
  codigo: z.string().trim().min(1, 'Falta el código de la actividad.'),
  lecciones: z.array(leccionId).min(1, 'Elige al menos una lección.'),
  cantidad: z.number().int().positive().optional(),
  config: configLibre.optional(),
  claseId,
})

export const generarRutaSchema = z.object({
  actividades: z.array(z.string().min(1)).min(1, 'Manda al menos una actividad.'),
  lecciones: z.array(leccionId).min(1, 'Elige al menos una lección.'),
  etapas: z.number().int().positive().optional(),
  umbrales: configLibre.optional(),
  configs: z.record(z.string(), configLibre).optional(),
  claseId,
})

// Mismo cuerpo que /generar o /generar-ruta, más el modo: estima el
// costo de esa generación SIN llamar a Gemini.
export const estimarSchema = z.object({
  modo: z.enum(['simple', 'aventura'], { message: "modo debe ser 'simple' o 'aventura'." }),
  codigo: z.string().trim().min(1).optional(),
  actividades: z.array(z.string().min(1)).optional(),
  lecciones: z.array(leccionId).min(1, 'Elige al menos una lección.'),
  cantidad: z.number().int().positive().optional(),
  config: configLibre.optional(),
  configs: z.record(z.string(), configLibre).optional(),
  etapas: z.number().int().positive().optional(),
  umbrales: configLibre.optional(),
  claseId,
})
