// ============================================================
// admin-backups.test.js — sección 6: endpoints de backup para admin
// ============================================================
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import request from 'supertest'
import { crearAppDePrueba, loginComo } from '../helpers/appTest.mjs'

let ctx, app, tokAdm, tokDoc

beforeAll(async () => {
  ctx = await crearAppDePrueba()
  app = ctx.app
  tokAdm = await loginComo(app, 'admin')
  tokDoc = await loginComo(app, 'docente')
})
afterAll(() => ctx.limpiar())

describe('GET /api/admin/backups', () => {
  it('un docente no puede ver la lista de backups (403)', async () => {
    const res = await request(app).get('/api/admin/backups').set('Authorization', `Bearer ${tokDoc}`)
    expect(res.status).toBe(403)
  })

  it('el admin ve la lista (vacía al principio, antes de correr ninguno)', async () => {
    const res = await request(app).get('/api/admin/backups').set('Authorization', `Bearer ${tokAdm}`)
    expect(res.status).toBe(200)
    expect(Array.isArray(res.body.backups)).toBe(true)
  })
})

describe('POST /api/admin/backups', () => {
  it('crea un backup manual y queda listado después', async () => {
    const crear = await request(app).post('/api/admin/backups').set('Authorization', `Bearer ${tokAdm}`)
    expect(crear.status).toBe(201)
    expect(crear.body.nombre).toBeTruthy()
    expect(crear.body.manifest.colecciones_json.length).toBeGreaterThan(0)

    const lista = await request(app).get('/api/admin/backups').set('Authorization', `Bearer ${tokAdm}`)
    expect(lista.body.backups.some((b) => b.nombre === crear.body.nombre)).toBe(true)
  })

  it('un docente no puede disparar un backup manual (403)', async () => {
    const res = await request(app).post('/api/admin/backups').set('Authorization', `Bearer ${tokDoc}`)
    expect(res.status).toBe(403)
  })
})
