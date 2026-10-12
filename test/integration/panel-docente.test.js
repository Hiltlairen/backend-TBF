// ============================================================
// panel-docente.test.js — sección 4: clases → actividades → resultados
// ============================================================
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import request from 'supertest'
import { crearAppDePrueba, loginComo } from '../helpers/appTest.mjs'
import { instalarGeminiMock, respuestasEmparejar } from '../helpers/geminiMock.mjs'

let ctx, app, tokDoc, claseId, salaCodigo, salaId, codigoMatricula

beforeAll(async () => {
  ctx = await crearAppDePrueba()
  app = ctx.app
  tokDoc = await loginComo(app, 'docente')

  const mock = instalarGeminiMock()
  try {
    const tokAdm = await loginComo(app, 'admin')
    const docentes = await request(app).get('/api/admin/usuarios').set('Authorization', `Bearer ${tokAdm}`)
    const idDocente = docentes.body.usuarios.find((u) => u.email === 'docente@englishlessons.edu').id

    // Asignada explícitamente a este docente: puedeVer()/resolverClase()
    // exigen esa asignación para cualquier rol que no sea admin/curador.
    const clase = await request(app).post('/api/clases')
      .set('Authorization', `Bearer ${tokAdm}`)
      .send({ nombre: '4° A - Tarde', docenteId: idDocente })
    claseId = clase.body.clase.id

    // La sala queda vinculada a la clase (para que aparezca en el
    // panel), así que el estudiante entra con código de matrícula, no
    // con nombre libre — hace falta un estudiante real importado.
    const importados = await request(app).post(`/api/clases/${claseId}/estudiantes`)
      .set('Authorization', `Bearer ${tokAdm}`)
      .send({ filas: [{ nombre: 'Estudiante Panel' }] })
    expect(importados.status).toBe(201)
    codigoMatricula = importados.body.estudiantes[0].codigo_matricula

    const generada = await request(app).post('/api/activities/generar')
      .set('Authorization', `Bearer ${tokDoc}`)
      .send({ codigo: '01-emparejar', lecciones: [1], claseId })
    expect(generada.status).toBe(201)

    const sala = await request(app).post('/api/rooms')
      .set('Authorization', `Bearer ${tokDoc}`)
      .send({ modo: 'simple', actividadId: generada.body.actividad.id, claseId })
    expect(sala.status).toBe(201)
    salaCodigo = sala.body.sala.codigo
    salaId = sala.body.sala.id
  } finally {
    mock.restaurar()
  }

  // Un estudiante entrega una actividad para que el panel tenga algo que mostrar.
  const invitado = await request(app).post('/api/auth/invitado').send({ codigo: salaCodigo, codigoMatricula })
  expect(invitado.status).toBe(200)
  const inicio = await request(app).post('/api/game/iniciar')
    .set('Authorization', `Bearer ${invitado.body.token}`)
    .send({ codigo: salaCodigo })
  const entrega = await request(app).post('/api/game/entregar-simple')
    .set('Authorization', `Bearer ${inicio.body.token}`)
    .send({ partidaId: inicio.body.partidaId, respuestas: respuestasEmparejar(1) })
  expect(entrega.status).toBe(200)
  expect(entrega.body.puntaje).toBe(90) // 1 fallo × penalización 10
})
afterAll(() => ctx.limpiar())

describe('bandeja de actividades de una clase', () => {
  it('agrupa por día y trae el resumen de la sala con su entrega', async () => {
    const res = await request(app).get(`/api/clases/${claseId}/actividades`)
      .set('Authorization', `Bearer ${tokDoc}`)
    expect(res.status).toBe(200)
    expect(res.body.dias.length).toBeGreaterThan(0)
    const actividades = res.body.dias.flatMap((d) => d.actividades)
    const resumen = actividades.find((a) => a.id === salaId)
    expect(resumen).toBeDefined()
    expect(resumen.totalResultados).toBe(1)
    expect(resumen.promedio).toBe(90)
  })
})

describe('resultados de una actividad', () => {
  it('trae el puntaje entregado por el estudiante, ordenable/filtrable en el cliente', async () => {
    const res = await request(app).get(`/api/clases/${claseId}/actividades/${salaId}/resultados`)
      .set('Authorization', `Bearer ${tokDoc}`)
    expect(res.status).toBe(200)
    expect(res.body.resultados.some((r) => r.puntaje === 90)).toBe(true)
    expect(res.body.resumen.total).toBe(1)
    expect(res.body.resumen.promedio).toBe(90)
    expect(res.body.resumen.histograma.find((h) => h.etiqueta === '81–100').cantidad).toBe(1)
  })

  it('un docente sin esa clase asignada no puede ver el panel (403)', async () => {
    const otroDocente = await request(app).post('/api/auth/login')
      .send({ email: 'docente2@englishlessons.edu', password: 'Docente*2026' })
    const res = await request(app).get(`/api/clases/${claseId}/actividades/${salaId}/resultados`)
      .set('Authorization', `Bearer ${otroDocente.body.token}`)
    expect(res.status).toBe(403)
  })
})

describe('exportación', () => {
  it('CSV: status 200 y content-type de csv', async () => {
    const res = await request(app).get(`/api/clases/${claseId}/actividades/${salaId}/exportar.csv`)
      .set('Authorization', `Bearer ${tokDoc}`)
    expect(res.status).toBe(200)
    expect(res.headers['content-type']).toMatch(/text\/csv/)
    expect(res.text).toContain('90')
  })

  it('PDF: status 200, content-type de PDF y arranca con la firma %PDF', async () => {
    const res = await request(app).get(`/api/clases/${claseId}/actividades/${salaId}/exportar.pdf`)
      .set('Authorization', `Bearer ${tokDoc}`)
      .buffer(true).parse((response, cb) => {
        const chunks = []
        response.on('data', (c) => chunks.push(c))
        response.on('end', () => cb(null, Buffer.concat(chunks)))
      })
    expect(res.status).toBe(200)
    expect(res.headers['content-type']).toMatch(/application\/pdf/)
    expect(res.body.slice(0, 4).toString('utf8')).toBe('%PDF')
  })
})
