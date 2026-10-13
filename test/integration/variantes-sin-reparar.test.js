// ============================================================
// variantes-sin-reparar.test.js — una variante de más que sale mal se
// descarta en vez de pedirle a la IA que la repare (ahorra tokens)
// ============================================================
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import request from 'supertest'
import { crearAppDePrueba, loginComo, crearClase } from '../helpers/appTest.mjs'
import { instalarGeminiMock, actividadEmparejar } from '../helpers/geminiMock.mjs'

let ctx, app, tok, mock, gen
const varianteDe = (prompt) => Number(prompt.match(/VARIANT #(\d+)/)?.[1] ?? 1)

beforeAll(async () => {
  ctx = await crearAppDePrueba()
  app = ctx.app
  tok = await loginComo(app, 'docente')
  const { claseId } = await crearClase(app, { nombre: 'Ahorro', estudiantes: 3 })
  // La variante 2 sale rota (sin pares); la 1 y la 3, bien.
  mock = instalarGeminiMock({
    respuestaPorCodigo: (codigo, prompt) => {
      const a = actividadEmparejar(codigo)
      if (varianteDe(prompt) === 2) a.pares_correctos = []
      return a
    },
  })
  gen = await request(app).post('/api/activities/generar').set('Authorization', `Bearer ${tok}`)
    .send({ codigo: '01-emparejar', lecciones: [1], claseId })
})
afterAll(() => { mock?.restaurar(); ctx.limpiar() })

describe('variantes de más', () => {
  it('la variante rota no se repara: 1 historia + 3 variantes = 4 llamadas, y quedan 2', () => {
    expect(gen.status).toBe(201)
    expect(mock.llamadas.llamadas).toBe(4)
    expect(gen.body.telemetria.llamadasGemini).toBe(4)
    expect(gen.body.actividad.variantes).toHaveLength(2)
    expect(gen.body.telemetria.variantes).toMatchObject({ pedidas: 3, generadas: 2 })
  })

  it('la respuesta al navegador no trae el desglose por proveedor', () => {
    expect(gen.body.telemetria.porProveedor).toBeUndefined()
  })
})
