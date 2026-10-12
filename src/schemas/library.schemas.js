import { z } from 'zod'

// lesson_id llega como id numérico de la lección (ver db/content.json);
// se acepta string o number porque el formulario del cliente a veces
// manda el value de un <select> como texto.
export const agregarVocabularioSchema = z.object({
  lesson_id: z.union([z.string(), z.number()]).refine((v) => String(v).trim().length > 0, 'Falta la lección.'),
  categoria: z.string().trim().min(1, 'Falta la categoría.').max(60),
  ingles: z.string().trim().min(1, 'Falta la palabra en inglés.').max(200),
  espanol: z.string().trim().min(1, 'Falta la palabra en español.').max(200),
})
