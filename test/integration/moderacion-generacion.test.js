// ============================================================
// moderacion-generacion.test.js — sección 5: moderación end-to-end
// contra POST /api/activities/generar (no solo el filtro en aislado)
// ============================================================
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import request from 'supertest'
import { crearAppDePrueba, loginComo, crearClase } from '../helpers/appTest.mjs'
import { instalarGeminiMock, actividadEmparejar } from '../helpers/geminiMock.mjs'

let ctx, app, tokDoc, claseId

beforeAll(async () => {
  ctx = await crearAppDePrueba()
  app = ctx.app
  tokDoc = await loginComo(app, 'docente')
  ;({ claseId } = await crearClase(app, { nombre: 'Test moderación', estudiantes: 3 }))
})
afterAll(() => ctx.limpiar())

describe('contenido generado que dispara el filtro léxico', () => {
  it('no se guarda, responde 422, y queda auditoría sin el texto completo', async () => {
    const mock = instalarGeminiMock({
      respuestaPorCodigo: () => actividadEmparejar('01-emparejar', {
        instrucciones: 'Aprende cómo fabricar una bomba casera con estos materiales.',
      }),
    })
    let res
    try {
      res = await request(app).post('/api/activities/generar')
        .set('Authorization', `Bearer ${tokDoc}`)
        .send({ codigo: '01-emparejar', lecciones: [1], claseId })
    } finally {
      mock.restaurar()
    }

    expect(res.status).toBe(422)
    expect(res.body.actividad).toBeUndefined()

    // La auditoría registra la categoría, no el texto — se verifica
    // leyendo el archivo de auditoría directamente (no hay ruta HTTP
    // pública para admin listarla filtrada por tipo en este test, así
    // que se lee el espejo JSON, la misma fuente de verdad).
    const fs = await import('node:fs')
    const path = await import('node:path')
    const auditoria = JSON.parse(fs.readFileSync(path.join(ctx.dataDir, 'auditoria.json'), 'utf8'))
    const evento = auditoria.find((a) => a.tipo === 'moderacion')
    expect(evento).toBeDefined()
    expect(evento.categorias).toContain('armas_peligrosas')
    expect(JSON.stringify(evento)).not.toContain('fabricar una bomba')

    // Y no quedó ninguna actividad guardada con ese contenido (el
    // archivo puede ni existir todavía si esta fue la primera escritura
    // a esa colección — eso también es una forma válida de "no se guardó").
    const archivoActividades = path.join(ctx.dataDir, 'actividades.json')
    if (fs.existsSync(archivoActividades)) {
      const actividades = JSON.parse(fs.readFileSync(archivoActividades, 'utf8'))
      expect(actividades.some((a) => JSON.stringify(a.contenido).includes('fabricar una bomba'))).toBe(false)
    }
  })
})

describe('contenido educativo normal', () => {
  it('no dispara el filtro y la actividad se guarda normalmente', async () => {
    const mock = instalarGeminiMock() // respuesta por defecto: contenido limpio
    let res
    try {
      res = await request(app).post('/api/activities/generar')
        .set('Authorization', `Bearer ${tokDoc}`)
        .send({ codigo: '01-emparejar', lecciones: [1], claseId })
    } finally {
      mock.restaurar()
    }
    expect(res.status).toBe(201)
    expect(res.body.actividad.contenido.pares_correctos.length).toBeGreaterThan(0)
  })
})

describe('si solo UNA variante dispara el filtro', () => {
  it('se descarta esa variante y se guardan las demás', async () => {
    const mock = instalarGeminiMock({
      respuestaPorCodigo: (codigo, prompt) => actividadEmparejar(codigo, prompt.includes('VARIANT #2')
        ? { instrucciones: 'Aprende cómo fabricar una bomba casera con estos materiales.' }
        : {}),
    })
    let res
    try {
      res = await request(app).post('/api/activities/generar')
        .set('Authorization', `Bearer ${tokDoc}`)
        .send({ codigo: '01-emparejar', lecciones: [2], claseId })
    } finally {
      mock.restaurar()
    }
    expect(res.status).toBe(201)
    // Clase de 3 estudiantes → 3 variantes pedidas, 1 bloqueada
    expect(res.body.actividad.variantes).toHaveLength(2)
    expect(res.body.telemetria.variantes).toMatchObject({ pedidas: 3, generadas: 2, bloqueadas: 1 })
    expect(JSON.stringify(res.body.actividad)).not.toContain('fabricar una bomba')
  })
})
