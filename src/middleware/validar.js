// ============================================================
// validar.js — Validación de esquemas de entrada (punto 5)
// ============================================================
// Antes de esto, cada ruta revisaba el body a mano, caso por caso
// ("if (!campo) return 400..."), con huecos reales: por ejemplo
// /api/game/entregar-simple nunca comprobaba que `puntaje` fuera un
// número (podía terminar guardando NaN), y varias rutas PATCH
// ignoraban EN SILENCIO un campo con el tipo equivocado en vez de
// avisar (mandabas `activo: "true"` como texto y no pasaba nada).
//
// `validar(schema)` reemplaza esos chequeos sueltos por un esquema
// de zod: si el body no calza, responde 400 con el mismo formato de
// siempre (`{ error: '...' }`, ver middleware/errors.js) más un
// array `detalles` — aditivo, no rompe a quien solo lee `data.error`.
// Si calza, `req.body` se REEMPLAZA por el resultado ya parseado
// (recortado a los campos del esquema, con los valores por defecto
// que declare), así el handler no repite la validación.
//
// Lo que NO valida un esquema — porque no puede — sigue viviendo en
// cada ruta: ¿existe ese email?, ¿ese docente existe?, ¿esa clase es
// tuya?, ¿la contraseña actual es correcta? Esos son chequeos de
// NEGOCIO (consultan la base de datos o comparan contra el usuario
// autenticado) y casi siempre responden con un código que no es 400
// (403/404/409/413/503) — mezclarlos en el esquema perdería esa
// distinción y esos códigos de estado específicos.
// ============================================================

function formatearIssue(issue) {
  return { campo: issue.path.join('.') || '(raíz)', mensaje: issue.message }
}

/** Valida req.body contra `schema`. En éxito, reemplaza req.body por
 *  el valor ya parseado/con defaults; en error, corta con 400. */
export function validar(schema) {
  return (req, res, next) => {
    const resultado = schema.safeParse(req.body ?? {})
    if (!resultado.success) {
      const detalles = resultado.error.issues.map(formatearIssue)
      return res.status(400).json({
        error: `Datos inválidos — ${detalles[0].campo}: ${detalles[0].mensaje}`,
        detalles,
      })
    }
    req.body = resultado.data
    next()
  }
}

/** Igual que `validar`, pero sobre req.query (parámetros de la URL). */
export function validarQuery(schema) {
  return (req, res, next) => {
    const resultado = schema.safeParse(req.query ?? {})
    if (!resultado.success) {
      const detalles = resultado.error.issues.map(formatearIssue)
      return res.status(400).json({
        error: `Parámetros inválidos — ${detalles[0].campo}: ${detalles[0].mensaje}`,
        detalles,
      })
    }
    req.query = resultado.data
    next()
  }
}
