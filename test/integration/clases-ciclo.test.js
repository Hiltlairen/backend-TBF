// ============================================================
// clases-ciclo.test.js — periodo y código externo automáticos,
// y reactivar una clase finalizada dentro de la ventana de retención
// ============================================================
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import request from 'supertest'
import { crearAppDePrueba, loginComo } from '../helpers/appTest.mjs'

let ctx, app, tokAdm
const anio = new Date().getFullYear()
const comoAdmin = (req) => req.set('Authorization', `Bearer ${tokAdm}`)

beforeAll(async () => {
  ctx = await crearAppDePrueba()
  app = ctx.app
  tokAdm = await loginComo(app, 'admin')
})
afterAll(() => ctx.limpiar())

const crearClase = async (nombre) =>
  (await comoAdmin(request(app).post('/api/clases')).send({ nombre })).body.clase

describe('datos automáticos', () => {
  it('el periodo es el año en curso si no se manda', async () => {
    const clase = await crearClase('Periodo automático')
    expect(clase.periodo).toBe(String(anio))
  })

  it('el código externo se genera solo, correlativo dentro de la clase, aunque el navegador mande otro', async () => {
    const clase = await crearClase('Códigos automáticos')
    const url = `/api/clases/${clase.id}/estudiantes`

    const previa = await comoAdmin(request(app).post(`${url}/previsualizar`))
      .send({ filas: [{ nombre: 'Ana' }, { nombre: '' }, { nombre: 'Beto', codigoExterno: 'INVENTADO' }] })
    expect(previa.body.filas.map((f) => f.codigoExterno)).toEqual([`${anio}-0001`, null, `${anio}-0002`])

    const primero = await comoAdmin(request(app).post(url)).send({ filas: [{ nombre: 'Ana' }, { nombre: 'Beto' }] })
    expect(primero.body.estudiantes.map((e) => e.codigo_externo)).toEqual([`${anio}-0001`, `${anio}-0002`])

    // Un segundo lote sigue la numeración (y no reutiliza números aunque se dé de baja a alguien).
    await comoAdmin(request(app).post(`/api/clases/estudiantes/${primero.body.estudiantes[0].id}/baja`))
    const segundo = await comoAdmin(request(app).post(url)).send({ filas: [{ nombre: 'Caro' }] })
    expect(segundo.body.estudiantes[0].codigo_externo).toBe(`${anio}-0003`)
  })
})

describe('reactivar una clase finalizada', () => {
  it('dentro del plazo: vuelve a estar activa con los estudiantes que cerró, no con los dados de baja antes', async () => {
    const clase = await crearClase('Reactivable')
    const alta = await comoAdmin(request(app).post(`/api/clases/${clase.id}/estudiantes`))
      .send({ filas: [{ nombre: 'Dana' }, { nombre: 'Eli' }] })
    const [dana] = alta.body.estudiantes
    await comoAdmin(request(app).post(`/api/clases/estudiantes/${dana.id}/baja`))

    const fin = await comoAdmin(request(app).post(`/api/clases/${clase.id}/finalizar`))
    expect(fin.body.clase.diasParaReactivar).toBe(30)

    const re = await comoAdmin(request(app).post(`/api/clases/${clase.id}/reactivar`))
    expect(re.status).toBe(200)
    expect(re.body.clase).toMatchObject({ activa: true, finalizada_en: null, totalEstudiantes: 1 })

    const lista = (await comoAdmin(request(app).get(`/api/clases/${clase.id}/estudiantes`))).body.estudiantes
    expect(lista.find((e) => e.nombre === 'Eli').activo).toBe(true)
    expect(lista.find((e) => e.nombre === 'Dana').activo).toBe(false)
  })

  it('pasado el plazo de retención ya no se puede (409)', async () => {
    const clase = await crearClase('Vencida')
    await comoAdmin(request(app).post(`/api/clases/${clase.id}/finalizar`))
    // Se simula que se finalizó hace 31 días.
    const { actualizar } = await import('../../src/db/store.js')
    actualizar('clases', clase.id, { finalizada_en: new Date(Date.now() - 31 * 86_400_000).toISOString() })

    const re = await comoAdmin(request(app).post(`/api/clases/${clase.id}/reactivar`))
    expect(re.status).toBe(409)
    expect(re.body.error).toMatch(/31 días/)
  })

  it('una clase que no está finalizada no se "reactiva" (409)', async () => {
    const clase = await crearClase('Nunca finalizada')
    expect((await comoAdmin(request(app).post(`/api/clases/${clase.id}/reactivar`))).status).toBe(409)
  })
})
