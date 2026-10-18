// ============================================================
// redaccion-cancion.test.js — actividades 05 y 10
// ============================================================
//   05 Redacción: la consigna se adapta al ambiente y al tipo de texto,
//      y la IA la evalúa (solo contexto + escritura correcta) con una
//      nota provisional que el docente confirma en curaduría.
//   10 Canción: letra REAL (LRCLIB, simulado aquí) con huecos armados
//      en código — 0 tokens, una variante por estudiante, se califica sola.
// ============================================================
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import request from 'supertest'
import { crearAppDePrueba, loginComo, crearClase } from '../helpers/appTest.mjs'
import { instalarGeminiMock, actividadEmparejar } from '../helpers/geminiMock.mjs'
// OJO: nada de src/ se importa arriba. services/canciones.js carga
// config.js, y config.js lee el .env al importarse: tiene que ser DESPUÉS
// de crearAppDePrueba() (si no, el test usa la carpeta data/ real).
let generarHuecos, detectarEstribillo, normalizarAudio, parsearLrc, parsearTextoPlano

const LRC = [
  '[00:10.00]Look at the stars, look how they shine for you',
  '[00:15.50]And everything you do, yeah, they were all yellow',
  '[00:21.00]I came along, I wrote a song for you',
  '[00:26.00]And all the things you do, and it was called yellow',
  '[00:31.00]Your skin, oh yeah, your skin and bones',
  '[00:36.00]Turn into something beautiful',
  '[00:41.00]Look at the stars, look how they shine for you',
  '[00:46.00]And everything you do, yeah, they were all yellow',
].join('\n')
const PISTA = { id: 123, trackName: 'Yellow', artistName: 'Coldplay', albumName: 'Parachutes', duration: 266, instrumental: false, plainLyrics: 'x', syncedLyrics: LRC }
const EVALUACION = {
  contexto: { puntaje: 80, comentario: 'Respondes a la consigna.' },
  escritura: { puntaje: 60, comentario: 'Revisa los verbos.' },
  errores: [{ original: 'I goed', correccion: 'I went', explicacion: 'Pasado irregular de go.' }],
  resumen: '¡Buen trabajo!',
}
const REDACCION = (codigo) => ({
  actividad: { ...actividadEmparejar(codigo).actividad },
  contexto: 'Estás en la cafetería y Tom te pidió que le escribas.',
  tipo_texto: 'email', destinatario: 'Tom',
  consigna: 'Write an email to Tom about your day.', minimo_palabras: 20,
})

let ctx, app, tokDoc, mock, clase, llamadasLrclib = 0
const auth = () => ({ Authorization: `Bearer ${tokDoc}` })
const prompts = () => mock.llamadas.prompts
const cancionCfg = { fuente: 'lrclib', id: '123', audio: { tipo: 'youtube', ref: 'https://www.youtube.com/watch?v=yKNxeF4KMsY' } }

async function entrar(codigoSala) {
  const inv = await request(app).post('/api/auth/invitado').send({ codigo: codigoSala, codigoMatricula: clase.codigos.shift() })
  const inicio = await request(app).post('/api/game/iniciar').set('Authorization', `Bearer ${inv.body.token}`).send({ codigo: codigoSala })
  expect(inicio.status).toBe(200)
  return inicio.body
}
const lanzar = async (actividadId) =>
  (await request(app).post('/api/rooms').set(auth()).send({ modo: 'simple', actividadId })).body.sala.codigo

beforeAll(async () => {
  ctx = await crearAppDePrueba()
  app = ctx.app
  ;({ generarHuecos, detectarEstribillo, normalizarAudio } = await import('../../src/domain/cancionHuecos.js'))
  ;({ parsearLrc, parsearTextoPlano } = await import('../../src/services/canciones.js'))
  tokDoc = await loginComo(app, 'docente')
  clase = await crearClase(app, { nombre: 'Canciones', estudiantes: 8 })
  mock = instalarGeminiMock({ respuestaPorCodigo: (codigo) => (codigo === '05-redaccion' ? REDACCION(codigo) : actividadEmparejar(codigo)) })
  // Encima del mock de Gemini: LRCLIB simulado y la evaluación de la redacción.
  const conGemini = globalThis.fetch
  globalThis.fetch = async (url, opciones) => {
    const u = String(url)
    if (u.startsWith('https://lrclib.net/api/search')) { llamadasLrclib++; return Response.json([PISTA]) }
    if (u.startsWith('https://lrclib.net/api/get/123')) { llamadasLrclib++; return Response.json(PISTA) }
    if (u.startsWith('https://lrclib.net/')) return new Response('null', { status: 404 })
    if (u.includes('generativelanguage') && String(opciones?.body).includes('corrige la redacción')) {
      mock.llamadas.prompts.push(JSON.parse(opciones.body).contents[0].parts[0].text)
      return Response.json({
        candidates: [{ content: { parts: [{ text: JSON.stringify(EVALUACION) }] } }],
        usageMetadata: { promptTokenCount: 50, candidatesTokenCount: 80 },
      })
    }
    return conGemini(url, opciones)
  }
})
afterAll(() => { mock?.restaurar(); ctx.limpiar() })

describe('10 · letra con huecos (dominio)', () => {
  let lineas
  beforeAll(() => { lineas = parsearLrc(LRC) })

  it('lee el LRC con sus tiempos y la letra plana sin rótulos', () => {
    expect(lineas).toHaveLength(8)
    expect(lineas[1]).toEqual({ t: 15.5, texto: 'And everything you do, yeah, they were all yellow' })
    expect(parsearTextoPlano('[Chorus]\nHello there\n\nVerse 2:\nGoodbye')).toEqual([{ t: null, texto: 'Hello there' }, { t: null, texto: 'Goodbye' }])
  })

  it('oculta el % pedido, solo palabras del largo mínimo, y cada variante oculta otras', () => {
    const a = generarHuecos({ lineas, porcentaje: 30, minLetras: 4, variante: 1 })
    const b = generarHuecos({ lineas, porcentaje: 30, minLetras: 4, variante: 2 })
    expect(a.huecos.length).toBe(Math.round(0.3 * a.totalPalabras))
    expect(a.huecos.every((h) => h.respuesta.replace(/'/g, '').length >= 4)).toBe(true)
    expect(a.huecos.map((h) => h.respuesta)).not.toEqual(b.huecos.map((h) => h.respuesta))
    // La letra se puede reconstruir: texto + respuestas = verso original.
    const verso = a.lineas[0].partes.map((p) => (p.hueco ? a.huecos.find((h) => h.id === p.hueco).respuesta : p.texto)).join('')
    expect(verso).toBe(lineas[0].texto)
  })

  it('verbos y sustantivos; estribillo y rango de versos', () => {
    const verbos = generarHuecos({ lineas, porcentaje: 50, minLetras: 3, tipo: 'verbos' })
    expect(verbos.huecos.map((h) => h.respuesta.toLowerCase())).toEqual(expect.arrayContaining(['look']))
    expect(verbos.huecos.map((h) => h.respuesta.toLowerCase())).not.toContain('stars')
    expect(detectarEstribillo(lineas)).toEqual({ desde: 0, hasta: 1 })
    const coro = generarHuecos({ lineas, porcentaje: 30, tramo: 'estribillo' })
    expect(coro.lineas).toHaveLength(2)
    expect(generarHuecos({ lineas, porcentaje: 30, tramo: { desde: 2, hasta: 4 } }).lineas).toHaveLength(3)
  })

  it('acepta los enlaces tal como los copia el docente', () => {
    expect(normalizarAudio({ tipo: 'youtube', ref: 'https://youtu.be/yKNxeF4KMsY?t=3' })).toEqual({ tipo: 'youtube', ref: 'yKNxeF4KMsY' })
    expect(normalizarAudio({ tipo: 'spotify', ref: 'https://open.spotify.com/track/3AJwUDP919kvQ9QcozQPxg?si=1' }).ref).toBe('3AJwUDP919kvQ9QcozQPxg')
    expect(() => normalizarAudio({ tipo: 'url', ref: 'http://inseguro.com/a.mp3' })).toThrow(/https/)
  })
})

describe('10 · generar y jugar', () => {
  let gen
  beforeAll(async () => {
    gen = await request(app).post('/api/activities/generar').set(auth())
      .send({ codigo: '10-canciones', lecciones: [1], claseId: clase.claseId, config: { cancion: { ...cancionCfg, opciones: { minLetras: 3 } } } })
  })

  it('el panel busca canciones y ve la vista previa con el % del libro', async () => {
    const busqueda = await request(app).get('/api/canciones/buscar?titulo=Yellow&artista=Coldplay').set(auth())
    expect(busqueda.body.resultados[0]).toMatchObject({ fuente: 'lrclib', id: '123', titulo: 'Yellow', sincronizada: true, duracionTexto: '4:26' })
    const previa = await request(app).post('/api/canciones/vista-previa').set(auth()).send({ cancion: cancionCfg, lecciones: [1] })
    expect(previa.status).toBe(200)
    expect(previa.body.actividad.huecos.length).toBeGreaterThan(0)
    expect(previa.body.porcentaje).toBe(previa.body.actividad.opciones.porcentaje)
  })

  it('sin canción elegida no se genera (400)', async () => {
    const res = await request(app).post('/api/activities/generar').set(auth()).send({ codigo: '10-canciones', lecciones: [1], claseId: clase.claseId })
    expect(res.status).toBe(400)
    expect(res.body.error).toMatch(/canción/)
  })

  it('0 tokens, una variante por estudiante, aprobada directo y la estimación dice 0', async () => {
    expect(gen.status).toBe(201)
    expect(gen.body.telemetria).toMatchObject({ llamadasGemini: 0, tokensTotal: 0 })
    expect(gen.body.actividad.estado).toBe('aprobada')
    expect(gen.body.actividad.variantes).toHaveLength(8)
    expect(gen.body.actividad.contenido.audio).toEqual({ tipo: 'youtube', ref: 'yKNxeF4KMsY' })
    expect(prompts().some((p) => p.includes('10-canciones'))).toBe(false)
    const est = await request(app).post('/api/activities/estimar').set(auth())
      .send({ modo: 'simple', codigo: '10-canciones', lecciones: [1], claseId: clase.claseId })
    expect(est.body.estimacion).toMatchObject({ total: 0, local: true, variantes: 8 })
  })

  it('el estudiante completa los huecos y el servidor califica contra la letra original', async () => {
    const inicio = await entrar(await lanzar(gen.body.actividad.id))
    const contenido = inicio.actividad.contenido
    const huecos = Object.fromEntries(contenido.huecos.map((h, i) => [h.id, i === 0 ? 'zzz' : h.respuesta.toUpperCase()]))
    const res = await request(app).post('/api/game/entregar-simple').set('Authorization', `Bearer ${inicio.token}`)
      .send({ partidaId: inicio.partidaId, respuestas: { huecos } })
    expect(res.status).toBe(200)
    const n = contenido.huecos.length
    expect(res.body.puntaje).toBe(Math.round(((n - 1) / n) * 100))
    expect(res.body.requiereRevision).toBe(false)
    expect(res.body.repaso.errores?.[0] ?? res.body.repaso.items?.[0] ?? res.body.repaso).toBeTruthy()
  })
})

describe('05 · redacción adaptada al contexto y evaluada por la IA', () => {
  let gen, evaluada
  beforeAll(async () => {
    gen = await request(app).post('/api/activities/generar').set(auth())
      .send({ codigo: '05-redaccion', lecciones: [1], claseId: clase.claseId, config: { escenario: 'cafeteria', tipoTexto: 'correo' } })
  }, 120_000)

  it('el pedido lleva el ambiente elegido y el tipo de texto; la rúbrica es la fija', () => {
    expect(gen.status).toBe(201)
    const lote = prompts().find((p) => p.includes('- 05-redaccion →'))
    expect(lote).toMatch(/scene "cafeteria".*scene_name ".+".*text_type "an email"/)
    const c = gen.body.actividad.contenido
    expect(c.contexto).toBeTruthy()
    expect(c.criterios.map((x) => x.nombre)).toEqual(['Contexto', 'Escritura correcta'])
  })

  it('el catálogo ofrece los tipos de texto', async () => {
    const cat = await request(app).get('/api/activities/catalogo').set(auth())
    expect(Object.keys(cat.body.tiposTexto)).toEqual(expect.arrayContaining(['auto', 'mensaje', 'correo']))
  })

  it('al entregar, la IA pone una nota provisional (promedio calculado en el servidor) y queda para el docente', async () => {
    const inicio = await entrar(await lanzar(gen.body.actividad.id))
    const texto = 'Hi Tom, today I goed to the cafe with my friends and we drank coffee. It was a very nice day for all of us.'
    const res = await request(app).post('/api/game/entregar-simple').set('Authorization', `Bearer ${inicio.token}`)
      .send({ partidaId: inicio.partidaId, respuestas: { texto } })
    expect(res.status).toBe(200)
    expect(res.body).toMatchObject({ puntaje: 70, requiereRevision: true })
    expect(res.body.evaluacionIA).toMatchObject({ total: 70, contexto: { puntaje: 80 }, escritura: { puntaje: 60 } })
    const p = prompts().find((x) => x.includes('corrige la redacción'))
    expect(p).toContain('Write an email to Tom')
    expect(p).not.toMatch(/Canciones — Estudiante/)   // nunca viaja el nombre
    evaluada = res.body
  })

  it('el docente aprueba sin cambiar la nota: confirma la de la IA', async () => {
    expect(evaluada).toBeTruthy()
    const tokCur = await loginComo(app, 'admin')
    const cola = await request(app).get('/api/review/cola?tipo=entrega').set('Authorization', `Bearer ${tokCur}`)
    const { items } = cola.body
    const item = items.find((x) => x.tipo === 'entrega' && x.estado === 'pendiente')
    const det = await request(app).get(`/api/review/${item.id}`).set('Authorization', `Bearer ${tokCur}`)
    expect(det.body.contenido).toMatchObject({ puntaje: 70, puntaje_provisional: true })
    expect(det.body.contenido.detalle.evaluacion_ia.errores[0]).toMatchObject({ original: 'I goed', correccion: 'I went' })
    const ok = await request(app).post(`/api/review/${item.id}/decidir`).set('Authorization', `Bearer ${tokCur}`)
      .send({ decision: 'aprobar', comentario: 'Bien' })
    expect(ok.status).toBe(200)
    const despues = await request(app).get(`/api/review/${item.id}`).set('Authorization', `Bearer ${tokCur}`)
    expect(despues.body.contenido).toMatchObject({ puntaje: 70, requiere_revision: false, puntaje_provisional: false })
  })

  it('un texto vacío no gasta IA', async () => {
    const antes = prompts().filter((x) => x.includes('corrige la redacción')).length
    const inicio = await entrar(await lanzar(gen.body.actividad.id))
    const res = await request(app).post('/api/game/entregar-simple').set('Authorization', `Bearer ${inicio.token}`)
      .send({ partidaId: inicio.partidaId, respuestas: { texto: 'hi' } })
    expect(res.body).toMatchObject({ puntaje: 0, evaluacionIA: { origen: 'sistema' } })
    expect(prompts().filter((x) => x.includes('corrige la redacción')).length).toBe(antes)
  })
})
