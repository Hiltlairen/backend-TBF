// ============================================================
// panel-progreso.test.js — sección 7: analítica pedagógica longitudinal
// ============================================================
// Cubre el endpoint nuevo GET /api/clases/:id/progreso: sigue a UN
// estudiante A TRAVÉS de varias actividades de la misma clase (no solo
// el promedio de una entrega puntual, que ya cubre panel-docente.test.js
// para /:id/actividades).
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import request from 'supertest'
import { crearAppDePrueba, loginComo } from '../helpers/appTest.mjs'
import { instalarGeminiMock, respuestasEmparejar } from '../helpers/geminiMock.mjs'

let ctx, app, tokDoc, claseId, codigoMatricula

async function lanzarYEntregar(actividadId, claseId, tokDoc, codigoMatricula, fallos) {
  const sala = await request(app).post('/api/rooms')
    .set('Authorization', `Bearer ${tokDoc}`)
    .send({ modo: 'simple', actividadId, claseId })
  expect(sala.status).toBe(201)

  const invitado = await request(app).post('/api/auth/invitado')
    .send({ codigo: sala.body.sala.codigo, codigoMatricula })
  expect(invitado.status).toBe(200)

  const inicio = await request(app).post('/api/game/iniciar')
    .set('Authorization', `Bearer ${invitado.body.token}`)
    .send({ codigo: sala.body.sala.codigo })

  const entrega = await request(app).post('/api/game/entregar-simple')
    .set('Authorization', `Bearer ${inicio.body.token}`)
    .send({ partidaId: inicio.body.partidaId, respuestas: respuestasEmparejar(fallos) })
  expect(entrega.status).toBe(200)
  return sala.body.sala.id
}

beforeAll(async () => {
  ctx = await crearAppDePrueba()
  app = ctx.app
  tokDoc = await loginComo(app, 'docente')

  const mock = instalarGeminiMock()
  try {
    const tokAdm = await loginComo(app, 'admin')
    const docentes = await request(app).get('/api/admin/usuarios').set('Authorization', `Bearer ${tokAdm}`)
    const idDocente = docentes.body.usuarios.find((u) => u.email === 'docente@englishlessons.edu').id

    const clase = await request(app).post('/api/clases')
      .set('Authorization', `Bearer ${tokAdm}`)
      .send({ nombre: '5° B - Progreso', docenteId: idDocente })
    claseId = clase.body.clase.id

    const importados = await request(app).post(`/api/clases/${claseId}/estudiantes`)
      .set('Authorization', `Bearer ${tokAdm}`)
      .send({ filas: [{ nombre: 'Estudiante Progreso' }] })
    expect(importados.status).toBe(201)
    codigoMatricula = importados.body.estudiantes[0].codigo_matricula

    // Dos actividades distintas, lanzadas y entregadas en orden, con
    // puntajes que suben claramente (60 → 90) para que la tendencia
    // computada sea 'subiendo' de forma inequívoca. La nota la calcula
    // el servidor: 4 fallos → 60, 1 fallo → 90.
    const gen1 = await request(app).post('/api/activities/generar')
      .set('Authorization', `Bearer ${tokDoc}`)
      .send({ codigo: '01-emparejar', lecciones: [1], claseId })
    expect(gen1.status).toBe(201)
    await lanzarYEntregar(gen1.body.actividad.id, claseId, tokDoc, codigoMatricula, 4)

    const gen2 = await request(app).post('/api/activities/generar')
      .set('Authorization', `Bearer ${tokDoc}`)
      .send({ codigo: '01-emparejar', lecciones: [1], claseId })
    expect(gen2.status).toBe(201)
    await lanzarYEntregar(gen2.body.actividad.id, claseId, tokDoc, codigoMatricula, 1)
  } finally {
    mock.restaurar()
  }
})
afterAll(() => ctx.limpiar())

describe('progreso longitudinal de un estudiante en su clase', () => {
  it('junta las entregas de las DOS actividades para el mismo estudiante, en orden', async () => {
    const res = await request(app).get(`/api/clases/${claseId}/progreso`)
      .set('Authorization', `Bearer ${tokDoc}`)
    expect(res.status).toBe(200)
    expect(res.body.estudiantes.length).toBe(1)

    const [e] = res.body.estudiantes
    expect(e.totalActividades).toBe(2)
    expect(e.promedio).toBe(75)
    expect(e.puntos.map((p) => p.puntaje)).toEqual([60, 90])
    // El docente asignado ve el nombre real (no un pseudónimo del curador).
    expect(e.estudiante).toBe('Estudiante Progreso')
    expect(e.estudiantePseudonimo).toBe(false)
  })

  it('detecta la tendencia de mejora entre una entrega y la siguiente', async () => {
    const res = await request(app).get(`/api/clases/${claseId}/progreso`)
      .set('Authorization', `Bearer ${tokDoc}`)
    expect(res.body.estudiantes[0].tendencia).toBe('subiendo')
  })

  it('con una sola entrega la tendencia es "insuficiente", no un falso positivo', async () => {
    const tokAdm = await loginComo(app, 'admin')
    const clase2 = await request(app).post('/api/clases')
      .set('Authorization', `Bearer ${tokAdm}`)
      .send({ nombre: '6° C - Una sola entrega' })
    const clase2Id = clase2.body.clase.id

    const importados = await request(app).post(`/api/clases/${clase2Id}/estudiantes`)
      .set('Authorization', `Bearer ${tokAdm}`)
      .send({ filas: [{ nombre: 'Solo Una Entrega' }] })
    const codigo2 = importados.body.estudiantes[0].codigo_matricula

    const mock = instalarGeminiMock()
    let actId
    try {
      const gen = await request(app).post('/api/activities/generar')
        .set('Authorization', `Bearer ${tokAdm}`)
        .send({ codigo: '01-emparejar', lecciones: [1], claseId: clase2Id })
      actId = gen.body.actividad.id
    } finally {
      mock.restaurar()
    }
    await lanzarYEntregar(actId, clase2Id, tokAdm, codigo2, 70)

    const res = await request(app).get(`/api/clases/${clase2Id}/progreso`)
      .set('Authorization', `Bearer ${tokAdm}`)
    expect(res.status).toBe(200)
    expect(res.body.estudiantes[0].totalActividades).toBe(1)
    expect(res.body.estudiantes[0].tendencia).toBe('insuficiente')
  })

  it('un docente sin esa clase asignada no puede ver el progreso (403)', async () => {
    const otroDocente = await request(app).post('/api/auth/login')
      .send({ email: 'docente2@englishlessons.edu', password: 'Docente*2026' })
    const res = await request(app).get(`/api/clases/${claseId}/progreso`)
      .set('Authorization', `Bearer ${otroDocente.body.token}`)
    expect(res.status).toBe(403)
  })

  it('el curador no tiene acceso a este panel (igual que el resto del panel del docente)', async () => {
    const tokCur = await loginComo(app, 'curador')
    const res = await request(app).get(`/api/clases/${claseId}/progreso`)
      .set('Authorization', `Bearer ${tokCur}`)
    // Mismo criterio que /:id/actividades/:salaId/resultados: el
    // curador revisa CONTENIDO, no necesita el panel de un docente.
    expect(res.status).toBe(403)
  })
})

describe('gestión de cursos: planilla de notas de la clase', () => {
  it('estudiantes × actividades en orden cronológico, con la nota final', async () => {
    const res = await request(app).get(`/api/clases/${claseId}/notas`).set('Authorization', `Bearer ${tokDoc}`)
    expect(res.status).toBe(200)
    expect(res.body.actividades).toHaveLength(2)
    const [est] = res.body.estudiantes
    expect(est.nombre).toBe('Estudiante Progreso')
    expect(res.body.actividades.map((a) => est.notas[a.salaId])).toEqual([60, 90])
    expect(est).toMatchObject({ entregadas: 2, notaFinal: 75 })
  })

  it('el CSV trae una columna por actividad y la nota final', async () => {
    const res = await request(app).get(`/api/clases/${claseId}/notas.csv`).set('Authorization', `Bearer ${tokDoc}`)
    expect(res.status).toBe(200)
    expect(res.headers['content-type']).toMatch(/text\/csv/)
    const [cabecera, fila] = res.text.replace(/^\ufeff/, '').split('\r\n')
    expect(cabecera.split(',')).toHaveLength(2 + 2 + 2) // nombre, código, 2 actividades, entregadas, final
    expect(cabecera).toMatch(/Nota final$/)
    expect(fila).toMatch(/^Estudiante Progreso,\d{4}-0001,60,90,2\/2,75$/)
  })

  it('un docente sin la clase asignada no la ve (403)', async () => {
    const otro = await request(app).post('/api/auth/login').send({ email: 'docente2@englishlessons.edu', password: 'Docente*2026' })
    const res = await request(app).get(`/api/clases/${claseId}/notas`).set('Authorization', `Bearer ${otro.body.token}`)
    expect(res.status).toBe(403)
  })
})
