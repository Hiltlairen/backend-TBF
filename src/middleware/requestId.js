// ============================================================
// requestId.js — id de correlación por request (punto 6)
// ============================================================
// Sin esto, "tuve un error" de un usuario no se puede atar a una
// línea de log concreta. Con esto: el id va en la respuesta (para
// que quien reporte el error lo pueda copiar) y en cada log
// estructurado de esa request (services/logger.js).
// ============================================================
import crypto from 'node:crypto'

export function asignarRequestId(req, res, next) {
  const entrante = req.headers['x-request-id']
  req.id = (typeof entrante === 'string' && entrante.trim()) || crypto.randomUUID()
  res.setHeader('X-Request-Id', req.id)
  next()
}
