// ============================================================
// ia-no-disponible.test.js — si se acaba la cuota de Gemini, solo
// quedan habilitadas las actividades de vocabulario (sin IA)
// ============================================================
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { readFileSync } from 'node:fs'
import request from 'supertest'
import { crearAppDePrueba, loginComo, crearClase } from '../helpers/appTest.mjs'
import { instalarGeminiMock } from '../helpers/geminiMock.mjs'

const CONTENIDO = JSON.parse(readFileSync(new URL('../../src/db/content.json', import.meta.url), 'utf8'))
const VOCABULARIO_VOCAB = ['01-emparejar', '04-sopa-letras', '06-diccionario', '17-emparejar-imagenes', '19-impostor', '20-basquetbol']

// Respuesta real de Google cuando se agota la cuota (recortada).
const CUERPO_429 = JSON.stringify({ error: {
  code: 429, status: 'RESOURCE_EXHAUSTED',
  message: 'You exceeded your current quota, please check your plan and billing details.',
  details: [{ '@type': 'type.googleapis.com/google.rpc.RetryInfo', retryDelay: '120s' }],
} })

let ctx, app, tokDoc, mock, claseId
let modo = 'ok'
let llamadas429 = 0

const generar = (cuerpo) => request(app).post('/api/activities/generar')
  .set('Authorization', `Bearer ${tokDoc}`).send({ claseId, lecciones: [1], ...cuerpo })
const generarRuta = (actividades) => request(app).post('/api/activities/generar-ruta')
  .set('Authorization', `Bearer ${tokDoc}`).send({ claseId, lecciones: [1], actividades })
const get = (ruta) => request(app).get(ruta).set('Authorization', `Bearer ${tokDoc}`)

beforeAll(async () => {
  ctx = await crearAppDePrueba()
  app = ctx.app
  tokDoc = await loginComo(app, 'docente')
  // Clase sin estudiantes: 1 sola variante (los conteos de abajo son de una).
  ;({ claseId } = await crearClase(app, { nombre: 'Sin IA' }))
  mock = instalarGeminiMock()
  const conMock = globalThis.fetch
  globalThis.fetch = async (url, opciones) => {
    if (modo === '429' && String(url).includes('generativelanguage')) {
      llamadas429 += 1
      return new Response(CUERPO_429, { status: 429, headers: { 'Content-Type': 'application/json' } })
    }
    return conMock(url, opciones)
  }
})
afterAll(() => { mock?.restaurar(); ctx.limpiar() })

describe('cuando se agota la cuota', () => {
  let conCache, cayo
  beforeAll(async () => {
    // Con IA: se genera (y queda en caché) un emparejar de la lección 1.
    conCache = await generar({ codigo: '01-emparejar' })
    modo = '429'
    cayo = await generar({ codigo: '02-conversacion-completar' })
  })

  it('una actividad que necesita IA falla con un mensaje claro (503), sin reintentar el mismo modelo', () => {
    expect(conCache.body.telemetria.modoLocal).toBe(false)
    expect(cayo.status).toBe(503)
    expect(cayo.body).toMatchObject({ sinIA: true, requierenIA: ['02-conversacion-completar'] })
    expect(cayo.body.ia).toMatchObject({ disponible: false, motivo: 'cuota' })
    expect(cayo.body.error).toMatch(/cuota/)
    expect(llamadas429).toBe(1) // sin cuota, reintentar no sirve
  })

  it('el catálogo avisa que la IA está en pausa y marca qué actividades la necesitan', async () => {
    const res = await get('/api/activities/catalogo')
    expect(res.body.ia.disponible).toBe(false)
    expect(new Date(res.body.ia.reintentarEn).getTime()).toBeGreaterThan(Date.now() + 100_000) // retryDelay 120s
    const porCodigo = Object.fromEntries(res.body.catalogo.map((a) => [a.codigo, a.requiereIA]))
    expect(Object.keys(porCodigo).filter((c) => !porCodigo[c]).sort()).toEqual(VOCABULARIO_VOCAB)
  })

  it('las de vocabulario se arman sin IA, sin llamar a Gemini y respetando la cantidad', async () => {
    const antes = llamadas429
    const res = await generar({ codigo: '06-diccionario', cantidad: 4 })
    expect(res.status).toBe(201)
    expect(res.body.telemetria).toMatchObject({ modoLocal: true, tokensTotal: 0 })
    expect(res.body.actividad.contenido.entradas).toHaveLength(4)
    expect(llamadas429).toBe(antes)
  })

  it('sin IA se arma UNA variante por estudiante (gratis): 30 para una clase de 30', async () => {
    const clase30 = await crearClase(app, { nombre: 'Sin IA 30', estudiantes: 30 })
    const est = await request(app).post('/api/activities/estimar').set('Authorization', `Bearer ${tokDoc}`)
      .send({ modo: 'simple', codigo: '20-basquetbol', lecciones: [1], claseId: clase30.claseId })
    expect(est.body).toMatchObject({ variantes: 30, estimacion: { total: 0, sinIA: true } })

    const antes = llamadas429
    const res = await generar({ codigo: '20-basquetbol', claseId: clase30.claseId })
    expect(res.status).toBe(201)
    expect(res.body.telemetria).toMatchObject({ modoLocal: true, tokensTotal: 0 })
    expect(res.body.actividad.variantes).toHaveLength(30)
    // Distintas combinaciones de palabras (no 30 copias de la misma)
    const combinaciones = res.body.actividad.variantes.map((v) => v.tiros.map((t) => t.palabra).sort().join())
    expect(new Set(combinaciones).size).toBeGreaterThanOrEqual(25)
    expect(llamadas429).toBe(antes)
  })

  it('no deforma palabras compuestas ("Paper clip" no se vuelve "Paperclip")', async () => {
    // Lección con vocabulario de varias palabras y con "/"
    const leccion = CONTENIDO.vocabulary.find((v) => v.ingles === 'Paper clip').lesson_id
    const validas = new Set(CONTENIDO.vocabulary.filter((v) => v.lesson_id === leccion)
      .flatMap((v) => v.ingles.split('/').map((x) => x.trim())))
    const res = await generar({ codigo: '06-diccionario', lecciones: [leccion], cantidad: 10 })
    // Cada respuesta es una palabra REAL de la lección, tal cual (con sus espacios)
    for (const e of res.body.actividad.contenido.entradas) {
      expect(validas.has(e.respuesta_correcta)).toBe(true)
    }
  })

  it('si esa combinación ya se generó con IA, se sirve desde la caché (mejor que la local)', async () => {
    const res = await generar({ codigo: '01-emparejar' })
    expect(res.status).toBe(201)
    expect(res.body.telemetria).toMatchObject({ desdeCache: true, modoLocal: false })
  })

  it('una aventura solo con actividades de vocabulario se puede generar sin IA', async () => {
    const res = await generarRuta(VOCABULARIO_VOCAB)
    expect(res.status).toBe(201)
    expect(res.body.telemetria.modoLocal).toBe(true)
  })

  it('una aventura con alguna actividad de IA se rechaza diciendo cuáles', async () => {
    const res = await generarRuta([...VOCABULARIO_VOCAB.slice(0, 5), '12-llamada'])
    expect(res.status).toBe(503)
    expect(res.body.requierenIA).toEqual(['12-llamada'])
  })

  it('la estimación dice 0 tokens y qué actividades quedan bloqueadas', async () => {
    const res = await request(app).post('/api/activities/estimar').set('Authorization', `Bearer ${tokDoc}`)
      .send({ modo: 'simple', codigo: '12-llamada', lecciones: [1], claseId })
    expect(res.body.estimacion).toMatchObject({ total: 0, sinIA: true })
    expect(res.body.requierenIA).toEqual(['12-llamada'])
  })
})

describe('cuando vuelve la IA', () => {
  it('"Comprobar ahora" la vuelve a habilitar y se puede generar con IA otra vez', async () => {
    modo = 'ok'
    const comprobar = await request(app).post('/api/activities/estado-ia/comprobar')
      .set('Authorization', `Bearer ${tokDoc}`)
    expect(comprobar.body.ia.disponible).toBe(true)

    const res = await generar({ codigo: '01-emparejar', lecciones: [2] })
    expect(res.status).toBe(201)
    expect(res.body.telemetria.modoLocal).toBe(false)
    expect(res.body.telemetria.llamadasGemini).toBeGreaterThan(0)
  })
})
