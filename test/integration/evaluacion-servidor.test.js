// ============================================================
// evaluacion-servidor.test.js — nota calculada en el servidor,
// resumen de errores y tutor IA al terminar
// ============================================================
// Antes, /api/game/entregar-simple creía el `puntaje` que mandaba el
// navegador. Ahora recibe las respuestas y califica contra la clave
// guardada (domain/calificador.js), devuelve el repaso de errores
// (services/repaso.js) y ofrece el comentario del tutor IA
// (services/tutorIA.js) solo sobre partidas terminadas y propias.
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import request from 'supertest'
import { crearAppDePrueba, loginComo, crearClase } from '../helpers/appTest.mjs'
import { instalarGeminiMock, respuestasEmparejar, RETRO_FALSA } from '../helpers/geminiMock.mjs'

let ctx, app, salaCodigo, mock, codigos

/** Un estudiante nuevo de la clase entra a la sala (sala + matrícula) y arranca su partida. */
async function entrarYEmpezar() {
  const codigoMatricula = codigos.shift()
  const invitado = await request(app).post('/api/auth/invitado').send({ codigo: salaCodigo, codigoMatricula })
  expect(invitado.status).toBe(200)
  const inicio = await request(app).post('/api/game/iniciar')
    .set('Authorization', `Bearer ${invitado.body.token}`)
    .send({ codigo: salaCodigo })
  expect(inicio.status).toBe(200)
  return { token: inicio.body.token, partidaId: inicio.body.partidaId }
}

const entregar = (alumno, cuerpo) => request(app).post('/api/game/entregar-simple')
  .set('Authorization', `Bearer ${alumno.token}`)
  .send({ partidaId: alumno.partidaId, ...cuerpo })

const pedirRetro = (alumno, partidaId = alumno.partidaId) => request(app).post('/api/game/retroalimentacion')
  .set('Authorization', `Bearer ${alumno.token}`)
  .send({ partidaId })

beforeAll(async () => {
  ctx = await crearAppDePrueba()
  app = ctx.app
  const tokDoc = await loginComo(app, 'docente')

  // El mock queda instalado todo el archivo: lo usa también el tutor IA.
  mock = instalarGeminiMock()
  // Una clase con un estudiante para cada caso de abajo.
  const clase = await crearClase(app, { nombre: 'Prueba', estudiantes: 12 })
  codigos = [...clase.codigos]
  const generada = await request(app).post('/api/activities/generar')
    .set('Authorization', `Bearer ${tokDoc}`)
    .send({ codigo: '01-emparejar', lecciones: [1], claseId: clase.claseId })
  expect(generada.status).toBe(201)

  const sala = await request(app).post('/api/rooms')
    .set('Authorization', `Bearer ${tokDoc}`)
    .send({ modo: 'simple', actividadId: generada.body.actividad.id })
  expect(sala.status).toBe(201)
  salaCodigo = sala.body.sala.codigo
})
afterAll(() => { mock?.restaurar(); ctx.limpiar() })

describe('la nota la calcula el servidor', () => {
  it('sin respuestas → 400 (ya no basta con mandar un puntaje)', async () => {
    const alumno = await entrarYEmpezar('Sin Respuestas')
    const res = await entregar(alumno, { puntaje: 100, puntajeMaximo: 100 })
    expect(res.status).toBe(400)
  })

  it('un puntaje inventado se ignora: sin resolver nada la nota es 0', async () => {
    const alumno = await entrarYEmpezar('Tramposo')
    const res = await entregar(alumno, { puntaje: 100, respuestas: {} })
    expect(res.status).toBe(200)
    expect(res.body.puntaje).toBe(0)
  })

  it('todas correctas → 100, sin errores en el repaso', async () => {
    const alumno = await entrarYEmpezar('Alumno Perfecto')
    const res = await entregar(alumno, { respuestas: respuestasEmparejar(0) })
    expect(res.body.puntaje).toBe(100)
    expect(res.body.repaso.total).toBe(4)
    expect(res.body.repaso.aciertos).toBe(4)
    expect(res.body.repaso.errores).toEqual([])
    expect(res.body.repaso.dominadas).toHaveLength(4)
  })
})

describe('resumen de errores (sin IA)', () => {
  let res
  beforeAll(async () => {
    const alumno = await entrarYEmpezar('Alumno Con Un Error')
    res = await entregar(alumno, { respuestas: respuestasEmparejar(1) })
  })

  it('descuenta la penalización del fallo', () => {
    expect(res.body.puntaje).toBe(90)
  })

  it('dice qué falló, cuál era la respuesta y qué eligió', () => {
    expect(res.body.repaso.errores).toEqual([
      expect.objectContaining({ pregunta: 'clue 1', esperado: 'word 3' }),
    ])
  })

  it('arma una ronda de práctica con la respuesta correcta entre las opciones', () => {
    const [item] = res.body.repaso.ronda
    expect(res.body.repaso.ronda).toHaveLength(1)
    expect(item.opciones.length).toBeGreaterThanOrEqual(2)
    expect(item.opciones.filter((o) => o.correcta)).toEqual([expect.objectContaining({ texto: 'word 3' })])
  })
})

describe('tutor IA', () => {
  it('no responde antes de terminar la actividad (409)', async () => {
    const alumno = await entrarYEmpezar('Todavía Jugando')
    expect((await pedirRetro(alumno)).status).toBe(409)
  })

  it('un estudiante no puede pedir la retroalimentación de otro (403)', async () => {
    const duena = await entrarYEmpezar('Dueña Partida')
    await entregar(duena, { respuestas: respuestasEmparejar(2) })
    const intruso = await entrarYEmpezar('Intruso Retro')
    expect((await pedirRetro(intruso, duena.partidaId)).status).toBe(403)
  })

  it('devuelve los consejos y la segunda vez sale de la caché, sin llamar a Gemini', async () => {
    const alumno = await entrarYEmpezar('Pide Consejos')
    await entregar(alumno, { respuestas: respuestasEmparejar(3) })

    const antes = mock.llamadas.llamadas
    const primera = await pedirRetro(alumno)
    expect(primera.status).toBe(200)
    expect(primera.body.retroalimentacion).toMatchObject({ ...RETRO_FALSA, origen: 'ia' })
    expect(mock.llamadas.llamadas).toBe(antes + 1)

    const segunda = await pedirRetro(alumno)
    expect(segunda.body.retroalimentacion.origen).toBe('cache')
    expect(mock.llamadas.llamadas).toBe(antes + 1)
  })

  it('el prompt no incluye el nombre del estudiante', async () => {
    const alumno = await entrarYEmpezar('Nombre Muy Privado')
    await entregar(alumno, { respuestas: respuestasEmparejar(4) })

    const original = globalThis.fetch
    let prompt = ''
    globalThis.fetch = (url, opciones) => {
      if (String(url).includes('generativelanguage')) prompt = JSON.parse(opciones.body).contents[0].parts[0].text
      return original(url, opciones)
    }
    try {
      expect((await pedirRetro(alumno)).status).toBe(200)
    } finally {
      globalThis.fetch = original
    }
    expect(prompt).toContain('tutor de inglés')
    expect(prompt).not.toContain('Nombre Muy Privado')
  })

  it('sin errores no gasta una llamada a Gemini', async () => {
    const alumno = await entrarYEmpezar('Sin Errores Retro')
    await entregar(alumno, { respuestas: respuestasEmparejar(0) })
    const antes = mock.llamadas.llamadas
    const res = await pedirRetro(alumno)
    expect(res.status).toBe(200)
    expect(res.body.retroalimentacion.origen).toBe('sistema')
    expect(mock.llamadas.llamadas).toBe(antes)
  })
})
