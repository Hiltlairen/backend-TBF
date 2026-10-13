// ============================================================
// vocabulario-categorias.test.js — la categoría de una palabra nueva
// tiene que ser una de las que ya tiene la lección
// ============================================================
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import request from 'supertest'
import { crearAppDePrueba, loginComo } from '../helpers/appTest.mjs'

let ctx, app, tok
beforeAll(async () => {
  ctx = await crearAppDePrueba()
  app = ctx.app
  tok = await loginComo(app, 'curador')
})
afterAll(() => ctx.limpiar())

const agregar = (cuerpo) => request(app).post('/api/library/vocabulario')
  .set('Authorization', `Bearer ${tok}`).send({ lesson_id: 1, ingles: 'Ruler', espanol: 'Regla', ...cuerpo })

describe('categoría al agregar vocabulario', () => {
  it('una categoría que la lección no tiene → 400, con la lista de las válidas', async () => {
    const r = await agregar({ categoria: 'Cualquier cosa' })
    expect(r.status).toBe(400)
    expect(r.body.categorias).toContain('Útiles escolares (School stuff)')
  })

  it('una categoría existente se acepta y se guarda con su escritura exacta', async () => {
    const r = await agregar({ categoria: '  útiles escolares (school stuff) ' })
    expect(r.status).toBe(201)
    expect(r.body.vocabulario.categoria).toBe('Útiles escolares (School stuff)')
  })
})
