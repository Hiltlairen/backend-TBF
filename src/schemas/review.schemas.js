import { z } from 'zod'

// `correcciones` varía según `item.tipo` (para una entrega trae
// `puntaje`, para otras cosas puede traer otros campos) — se valida
// como objeto libre acá; la ruta ya sabe qué hacer con cada forma.
export const decidirRevisionSchema = z.object({
  decision: z.enum(['aprobar', 'rechazar'], { message: "decision debe ser 'aprobar' o 'rechazar'." }),
  comentario: z.string().trim().max(2000).optional().default(''),
  correcciones: z.record(z.string(), z.unknown()).nullable().optional().default(null),
})

// Antes `texto` no se validaba en absoluto (podía quedar una nota
// vacía guardada). Ahora se exige contenido real.
export const notaRevisionSchema = z.object({
  texto: z.string().trim().min(1, 'Escribe algo en la nota.').max(2000),
})
