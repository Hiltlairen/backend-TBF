// ============================================================
// estudiantes-import.test.js — sección 3: importación masiva
// ============================================================
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import request from 'supertest'
import { crearAppDePrueba, loginComo } from '../helpers/appTest.mjs'

let ctx, app, tokAdm, claseId

beforeAll(async () => {
  ctx = await crearAppDePrueba()
  app = ctx.app
  tokAdm = await loginComo(app, 'admin')

  const clase = await request(app).post('/api/clases')
    .set('Authorization', `Bearer ${tokAdm}`)
    .send({ nombre: '3° B - Mañana', periodo: '2026-S2' })
  claseId = clase.body.clase.id
})
afterAll(() => ctx.limpiar())

describe('previsualización (dry-run)', () => {
  it('detecta filas sin nombre y códigos duplicados sin crear nada', async () => {
    const res = await request(app).post(`/api/clases/${claseId}/estudiantes/previsualizar`)
      .set('Authorization', `Bearer ${tokAdm}`)
      .send({ filas: [
        { nombre: 'Ana Torres', codigoExterno: 'EXT-1' },
        { nombre: '', codigoExterno: 'EXT-2' },
        { nombre: 'Ana Torres', codigoExterno: 'EXT-1' }, // duplicado exacto
      ] })
    expect(res.status).toBe(200)
    expect(res.body.resumen.invalidas).toBeGreaterThan(0)
  })

  it('un lote de más de 300 filas se rechaza por el esquema (400)', async () => {
    const filas = Array.from({ length: 301 }, (_, i) => ({ nombre: `Estudiante ${i}` }))
    const res = await request(app).post(`/api/clases/${claseId}/estudiantes/previsualizar`)
      .set('Authorization', `Bearer ${tokAdm}`)
      .send({ filas })
    expect(res.status).toBe(400)
  })
})

describe('importación real', () => {
  it('crea estudiantes con código de matrícula único y rechaza el lote si algo sigue mal', async () => {
    const malo = await request(app).post(`/api/clases/${claseId}/estudiantes`)
      .set('Authorization', `Bearer ${tokAdm}`)
      .send({ filas: [{ nombre: 'Bruno Lima' }, { nombre: '' }] })
    expect(malo.status).toBe(400) // rechaza TODO el lote, no importa parcial

    const bueno = await request(app).post(`/api/clases/${claseId}/estudiantes`)
      .set('Authorization', `Bearer ${tokAdm}`)
      .send({ filas: [{ nombre: 'Bruno Lima', codigoExterno: 'INST-001' }, { nombre: 'Carla Nuñez' }] })
    expect(bueno.status).toBe(201)
    expect(bueno.body.estudiantes).toHaveLength(2)
    const codigos = bueno.body.estudiantes.map((e) => e.codigo_matricula)
    expect(new Set(codigos).size).toBe(2) // únicos
    for (const c of codigos) expect(c).toMatch(/^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6}$/)
  })

  it('el roster no guarda el nombre en texto plano en el archivo (queda cifrado en reposo)', async () => {
    const roster = await request(app).get(`/api/clases/${claseId}/estudiantes`)
      .set('Authorization', `Bearer ${tokAdm}`)
    expect(roster.status).toBe(200)
    // La API sí lo devuelve descifrado a quien tiene permiso...
    expect(roster.body.estudiantes.some((e) => e.nombre === 'Bruno Lima')).toBe(true)
    // ...pero el archivo en disco NO debería tener el nombre en claro.
    const fs = await import('node:fs')
    const path = await import('node:path')
    const crudo = fs.readFileSync(path.join(ctx.dataDir, 'estudiantes.json'), 'utf8')
    expect(crudo).not.toContain('Bruno Lima')
  })

  it('un docente sin acceso de gestión no puede importar (403)', async () => {
    const tokDoc = await loginComo(app, 'docente')
    const res = await request(app).post(`/api/clases/${claseId}/estudiantes`)
      .set('Authorization', `Bearer ${tokDoc}`)
      .send({ filas: [{ nombre: 'Intento no autorizado' }] })
    expect(res.status).toBe(403)
  })
})
