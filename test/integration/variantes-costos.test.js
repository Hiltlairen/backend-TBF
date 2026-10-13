// ============================================================
// variantes-costos.test.js — cada actividad se genera en VARIAS
// variantes (juegos de preguntas) que se reparten al azar entre los
// estudiantes de la clase, y el docente sabe cuántos tokens cuestan
// ============================================================
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import request from 'supertest'
import { crearAppDePrueba, loginComo, crearClase } from '../helpers/appTest.mjs'
import { instalarGeminiMock, actividadEmparejar } from '../helpers/geminiMock.mjs'

let ctx, app, tokDoc, tokDoc2, mock
let clase30, clase4

/** Número de variante que pide el prompt ("VARIANT #k"); la 1 no lo lleva. */
const varianteDe = (prompt) => Number(prompt.match(/VARIANT #(\d+)/)?.[1] ?? 1)

const generar = (cuerpo, tok = tokDoc) => request(app).post('/api/activities/generar')
  .set('Authorization', `Bearer ${tok}`).send({ codigo: '01-emparejar', lecciones: [1], ...cuerpo })
const estimar = (cuerpo) => request(app).post('/api/activities/estimar')
  .set('Authorization', `Bearer ${tokDoc}`).send({ modo: 'simple', codigo: '01-emparejar', lecciones: [1], ...cuerpo })

beforeAll(async () => {
  // config.js lee el .env al importarse: estos valores tienen que
  // existir ANTES de crearAppDePrueba().
  process.env.GEMINI_PRECIO_ENTRADA_1M = '1'
  process.env.GEMINI_PRECIO_SALIDA_1M = '2'
  ctx = await crearAppDePrueba()
  app = ctx.app
  tokDoc = await loginComo(app, 'docente')
  const otro = await request(app).post('/api/auth/login')
    .send({ email: 'docente2@englishlessons.edu', password: 'Docente*2026' })
  tokDoc2 = otro.body.token
  clase30 = await crearClase(app, { nombre: '3° B - Mañana', estudiantes: 30 })
  clase4 = await crearClase(app, { nombre: '3° C - Tarde', estudiantes: 4 })
  // Cada llamada reporta 100 de entrada, 200 de salida y 50 de "pensamiento".
  // Cada variante trae otras pistas ("clue 1 · v3"), para poder distinguirlas.
  mock = instalarGeminiMock({
    uso: { promptTokenCount: 100, candidatesTokenCount: 200, thoughtsTokenCount: 50 },
    respuestaPorCodigo: (codigo, prompt) => {
      const a = actividadEmparejar(codigo)
      const v = varianteDe(prompt)
      for (const it of a.columna_izquierda.items) it.contenido = `${it.contenido} · v${v}`
      return a
    },
  })
})
afterAll(() => {
  mock?.restaurar(); ctx.limpiar()
  delete process.env.GEMINI_PRECIO_ENTRADA_1M
  delete process.env.GEMINI_PRECIO_SALIDA_1M
})

describe('cuántas variantes', () => {
  it('la clase es obligatoria: sin ella no se genera ni se estima (400)', async () => {
    expect((await generar({})).status).toBe(400)
    expect((await estimar({})).status).toBe(400)
  })

  it('otro docente no puede generar para una clase que no le asignaron (403)', async () => {
    expect((await generar({ claseId: clase30.claseId }, tokDoc2)).status).toBe(403)
  })

  it('con IA: 10 variantes para una clase de 30 (tope VARIANTES_IA), y la estimación lo sabe sin llamar a Gemini', async () => {
    const antes = mock.llamadas.llamadas
    const grande = await estimar({ claseId: clase30.claseId })
    const chica = await estimar({ claseId: clase4.claseId })
    expect(grande.status).toBe(200)
    expect(grande.body).toMatchObject({ variantes: 10, estudiantes: 30 })
    expect(chica.body).toMatchObject({ variantes: 4, estudiantes: 4 })
    expect(grande.body.estimacion.total).toBeGreaterThan(chica.body.estimacion.total)
    expect(grande.body.estimacion.costoUSD).toBeGreaterThan(0)
    expect(mock.llamadas.llamadas).toBe(antes)
  })
})

describe('generar una actividad en variantes', () => {
  let gen, promptsAntes
  beforeAll(async () => {
    promptsAntes = mock.llamadas.prompts.length
    gen = await generar({ claseId: clase30.claseId })
  })

  it('guarda 10 variantes distintas, con el curso = nombre de la clase', () => {
    expect(gen.status).toBe(201)
    const { actividad } = gen.body
    expect(actividad.curso).toBe('3° B - Mañana')
    expect(actividad.variantes).toHaveLength(10)
    const primeras = actividad.variantes.map((v) => v.columna_izquierda.items[0].contenido)
    expect(new Set(primeras).size).toBe(10)
    expect(actividad.contenido).toEqual(actividad.variantes[0])
    expect(gen.body.telemetria.variantes).toMatchObject({ pedidas: 10, generadas: 10 })
  })

  it('el bible se pide UNA vez: 1 + 10 llamadas, y cuenta los tokens reales (pensamiento incluido)', () => {
    const prompts = mock.llamadas.prompts.slice(promptsAntes)
    expect(prompts.filter((p) => p.includes('story bible'))).toHaveLength(1)
    expect(prompts).toHaveLength(11)
    for (let k = 2; k <= 10; k++) expect(prompts.filter((p) => p.includes(`VARIANT #${k}`))).toHaveLength(1)
    // 11 llamadas × (100 entrada, 200 + 50 salida)
    expect(gen.body.telemetria).toMatchObject({ llamadasGemini: 11, tokensEntrada: 1100, tokensSalida: 2750, tokensTotal: 3850 })
    // 1100/1M × $1 + 2750/1M × $2
    expect(gen.body.telemetria.costoUSD).toBeCloseTo(0.0066, 6)
    expect(gen.body.telemetria.estimado.total).toBeGreaterThan(0)
  })

  it('repetir la misma combinación sale gratis de la caché, y la estimación lo sabe', async () => {
    const est = await estimar({ claseId: clase30.claseId })
    expect(est.body.estimacion).toMatchObject({ total: 0, desdeCache: true })
    const otraVez = await generar({ claseId: clase30.claseId })
    expect(otraVez.body.telemetria).toMatchObject({ desdeCache: true, tokensTotal: 0 })
    expect(otraVez.body.actividad.variantes).toHaveLength(10)
  })

  it('la estimación se calibra con lo que costaron las generaciones anteriores', async () => {
    const est = await estimar({ claseId: clase30.claseId, lecciones: [4] })
    expect(est.body.estimacion.muestrasCalibracion).toBeGreaterThanOrEqual(1)
  })
})

describe('reparto en la sala: a cada estudiante le toca una variante al azar', () => {
  let codigoSala, actividad
  const entrar = async (codigoMatricula) => {
    const inv = await request(app).post('/api/auth/invitado').send({ codigo: codigoSala, codigoMatricula })
    const inicio = await request(app).post('/api/game/iniciar')
      .set('Authorization', `Bearer ${inv.body.token}`).send({ codigo: codigoSala })
    return inicio.body
  }
  const pista = (inicio) => inicio.actividad.contenido.columna_izquierda.items[0].contenido

  beforeAll(async () => {
    actividad = (await generar({ claseId: clase4.claseId, lecciones: [2] })).body.actividad
    // La sala hereda la clase de la actividad: se entra con sala + matrícula.
    const sala = await request(app).post('/api/rooms').set('Authorization', `Bearer ${tokDoc}`)
      .send({ modo: 'simple', actividadId: actividad.id })
    expect(sala.body.sala.clase_id).toBe(clase4.claseId)
    codigoSala = sala.body.sala.codigo
  })

  it('el curso de la sala es la clase asignada: no se escribe a mano ni se cambia de clase', async () => {
    const lanzar = (cuerpo) => request(app).post('/api/rooms').set('Authorization', `Bearer ${tokDoc}`)
      .send({ modo: 'simple', actividadId: actividad.id, ...cuerpo })
    const conCurso = await lanzar({ curso: 'Un curso inventado' })
    expect(conCurso.status).toBe(201)
    expect(conCurso.body.sala.curso).toBe('3° C - Tarde')
    expect(conCurso.body.sala.limite_estudiantes).toBe(4)
    await request(app).post(`/api/rooms/${conCurso.body.sala.codigo}/cerrar`).set('Authorization', `Bearer ${tokDoc}`)
    expect((await lanzar({ claseId: clase30.claseId })).status).toBe(400)
  })

  it('si un estudiante vuelve a entrar, conserva su variante; 4 estudiantes con 4 variantes no repiten ninguna', async () => {
    // Reconexión ANTES de llenar el cupo (con la sala llena, se cierra).
    const primera = pista(await entrar(clase4.codigos[0]))
    expect(pista(await entrar(clase4.codigos[0]))).toBe(primera)

    const vistas = [primera]
    for (const c of clase4.codigos.slice(1)) vistas.push(pista(await entrar(c)))
    // Al azar, pero entre las menos repartidas: con 4 y 4, una para cada uno.
    expect(new Set(vistas).size).toBe(4)
    for (const v of vistas) {
      expect(actividad.variantes.map((x) => x.columna_izquierda.items[0].contenido)).toContain(v)
    }
  })
})

describe('si Gemini falla a mitad de camino (cae al generador local)', () => {
  let gen
  beforeAll(async () => {
    const clase = await crearClase(app, { nombre: 'Falla', estudiantes: 6 })
    // 1ª llamada (bible) responde bien; desde ahí Gemini devuelve texto
    // que no es JSON — como cuando el modelo se corta o se agota la cuota.
    const conMock = globalThis.fetch
    let n = 0
    globalThis.fetch = async (url, opciones) => {
      if (!String(url).includes('generativelanguage')) return conMock(url, opciones)
      n += 1
      if (n === 1) return conMock(url, opciones)
      return new Response(JSON.stringify({
        candidates: [{ content: { parts: [{ text: 'esto no es JSON' }] } }],
        usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5 },
      }), { status: 200, headers: { 'Content-Type': 'application/json' } })
    }
    try {
      gen = await generar({ codigo: '06-diccionario', lecciones: [3], claseId: clase.claseId })
    } finally {
      globalThis.fetch = conMock
    }
  })

  it('cuenta los tokens que Google ya cobró antes de fallar, y no reintenta la IA en cada variante', () => {
    expect(gen.status).toBe(201)
    expect(gen.body.telemetria.modoLocal).toBe(true)
    // bible (100 + 250) + 3 intentos del lote con JSON inválido (15 c/u)
    expect(gen.body.telemetria.tokensTotal).toBe(395)
    expect(gen.body.telemetria.llamadasGemini).toBe(4)
  })

  it('las 6 variantes se arman igual (sin IA) y con distintas combinaciones de palabras', () => {
    const palabras = gen.body.actividad.variantes.map((v) => v.entradas.map((e) => e.respuesta_correcta).join())
    expect(palabras).toHaveLength(6)
    expect(new Set(palabras).size).toBe(6)
  })
})

describe('hoja de respuestas de cada variante, para revisar antes de lanzar', () => {
  let actividadId
  beforeAll(async () => {
    actividadId = (await generar({ claseId: clase4.claseId, lecciones: [5] })).body.actividad.id
  })

  it('muestra cada ítem con su respuesta correcta, por variante', async () => {
    const hoja = (v) => request(app).get(`/api/activities/${actividadId}/hoja${v ? `?variante=${v}` : ''}`)
      .set('Authorization', `Bearer ${tokDoc}`)
    const uno = await hoja()
    expect(uno.status).toBe(200)
    expect(uno.body).toMatchObject({ tipo: 'simple', variante: 1, totalVariantes: 4 })
    const [seccion] = uno.body.actividades
    expect(seccion.items).toHaveLength(4)
    expect(seccion.items[0]).toEqual({ pregunta: 'clue 1 · v1', esperado: 'word 3' })
    expect(seccion.contenido).toBeTruthy() // para "probar como estudiante"

    const tres = await hoja(3)
    expect(tres.body.variante).toBe(3)
    expect(tres.body.actividades[0].items[0].pregunta).toBe('clue 1 · v3')
  })

  it('otro docente no la puede ver (403)', async () => {
    const res = await request(app).get(`/api/activities/${actividadId}/hoja`)
      .set('Authorization', `Bearer ${tokDoc2}`)
    expect(res.status).toBe(403)
  })
})
