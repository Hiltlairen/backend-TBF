import { z } from 'zod'
import { id } from './comunes.js'

// Cuál de actividadId/rutaId hace falta depende de `modo` (regla
// cruzada) — eso sigue viviendo en la ruta, que además valida que
// esa actividad/ruta exista de verdad.
export const crearSalaSchema = z.object({
  modo: z.enum(['simple', 'juego'], { message: "modo debe ser 'simple' o 'juego'." }),
  actividadId: id.optional(),
  rutaId: id.optional(),
  curso: z.string().trim().max(120).optional(),
  limiteEstudiantes: z.number().optional(),
  claseId: id.optional(),
})

export const iniciarPartidaSchema = z.object({
  codigo: z.string().trim().min(1).optional(),
})

// El navegador ya NO manda el puntaje: manda las respuestas del
// estudiante y el servidor calcula la nota (domain/calificador.js).
// Su forma depende del tipo de actividad, así que aquí solo se exige
// que sea un objeto; cada calificador lee lo suyo y descarta el resto.
// Un `puntaje` que llegue igual se descarta (zod quita las claves
// que no están en el esquema).
const respuestas = z.record(z.string(), z.unknown(), { message: 'Faltan las respuestas de la actividad.' })

export const avanzarPartidaSchema = z.object({
  partidaId: id,
  respuestas,
})

export const entregarSimpleSchema = z.object({
  partidaId: id,
  respuestas,
})

export const retroalimentacionSchema = z.object({
  partidaId: id,
})
