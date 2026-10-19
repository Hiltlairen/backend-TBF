// ============================================================
// direcciones.test.js — actividad 07 "Find the way" (mapa de La Paz)
// ============================================================
// La ruta es REAL (data/rutasLaPaz.json) y la elige el código según el
// nivel del libro; la IA solo escribe las indicaciones y sus 3 opciones.
// Se valida que la opción correcta haga lo que hace la ruta, y la nota
// la calcula el servidor como un quiz.
// ============================================================
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import request from 'supertest'
import { crearAppDePrueba, loginComo, crearClase } from '../helpers/appTest.mjs'
import { instalarGeminiMock, actividadEmparejar } from '../helpers/geminiMock.mjs'

// src/ se importa DESPUÉS de crearAppDePrueba() (config.js lee el .env al cargarse).
let rutas, validarActividad
let ctx, app, tokDoc, mock, clase

const ACCION = { LEFT: 'izquierda', RIGHT: 'derecha' }
/** Lo que respondería la IA: un paso por renglón "Pn:" de la ruta del prompt. */
function direccionesDesdePrompt(prompt, { romper = false } = {}) {
  const pasos = [...prompt.matchAll(/P(\d+): drive along .*?then (?:turn (LEFT|RIGHT)|(ARRIVE))/g)].map((m, i) => {
    const accion = m[3] ? 'llegar' : ACCION[m[2]]
    const otra = accion === 'izquierda' ? 'derecha' : 'izquierda'
    return {
      id: `P${i + 1}`, instruccion: `Step ${i + 1} in English.`,
      opciones: [
        { texto: `Correcta ${i + 1}`, accion: romper && i === 0 ? otra : accion, correcta: true },
        { texto: `Mal A ${i + 1}`, accion: otra, correcta: false },
        { texto: `Mal B ${i + 1}`, accion: 'recto', correcta: false },
      ],
    }
  })
  return {
    actividad: { ...actividadEmparejar('07-direcciones').actividad },
    modo: 'seguir', destino: { nombre: "Grandma's house", motivo: 'Visitamos a la abuela.' },
    guia: 'Mom', intro: 'Let me guide you.', pasos, llegada: 'You arrived!',
  }
}

beforeAll(async () => {
  ctx = await crearAppDePrueba()
  app = ctx.app
  rutas = await import('../../src/domain/rutasMapa.js')
  ;({ validarActividad } = await import('../../src/services/validators.js'))
  tokDoc = await loginComo(app, 'docente')
  clase = await crearClase(app, { nombre: 'Mapa', estudiantes: 3 })
  let primeraVez = true
  mock = instalarGeminiMock({
    respuestaPorCodigo: (codigo, prompt) => {
      if (codigo !== '07-direcciones') return actividadEmparejar(codigo)
      // La primera respuesta llega mal (correcta que no coincide con la ruta): se repara.
      const a = direccionesDesdePrompt(prompt, { romper: primeraVez })
      primeraVez = false
      return a
    },
  })
  // El mock genérico no contesta reparaciones: para la 07, sí (con la ruta del prompt).
  const conMock = globalThis.fetch
  globalThis.fetch = async (url, opciones) => {
    const texto = String(url).includes('generativelanguage') ? JSON.parse(opciones.body).contents[0].parts[0].text : ''
    if (!texto.includes('"07-direcciones" you generated was rejected')) return conMock(url, opciones)
    mock.llamadas.prompts.push(texto)
    return Response.json({
      candidates: [{ content: { parts: [{ text: JSON.stringify({ '07-direcciones': direccionesDesdePrompt(texto) }) }] } }],
      usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 10 },
    })
  }
})
afterAll(() => { mock?.restaurar(); ctx.limpiar() })

describe('07 · rutas reales', () => {
  it('la biblioteca tiene rutas de La Paz con giros, cuadras, geometría y lugares', () => {
    expect(rutas.RUTAS.length).toBeGreaterThanOrEqual(20)
    for (const r of rutas.RUTAS) {
      expect(r.pasos.at(-1).accion).toBe('llegar')
      for (const p of r.pasos) {
        expect(['izquierda', 'derecha', 'llegar']).toContain(p.accion)
        expect(p.geometria.length).toBeGreaterThanOrEqual(2)
        expect(p.punto[0]).toBeGreaterThan(-16.6); expect(p.punto[0]).toBeLessThan(-16.4)   // La Paz
      }
      expect(r.pasos.some((p) => p.referencia)).toBe(true)
    }
  })

  it('el largo de la ruta depende del nivel, es determinista y cada variante va por otra', () => {
    const a1 = rutas.elegirRuta({ nivel: 'A1', variante: 1, semilla: '1' })
    const b2 = rutas.elegirRuta({ nivel: 'B2', variante: 1, semilla: '1' })
    expect(a1.pasos.length).toBeLessThanOrEqual(3)
    expect(b2.pasos.length).toBeGreaterThanOrEqual(5)
    expect(rutas.elegirRuta({ nivel: 'A2', variante: 2, semilla: '1' }).id).toBe(rutas.elegirRuta({ nivel: 'A2', variante: 2, semilla: '1' }).id)
    expect(rutas.elegirRuta({ nivel: 'A2', variante: 1, semilla: '1' }).id).not.toBe(rutas.elegirRuta({ nivel: 'A2', variante: 2, semilla: '1' }).id)
  })

  it('la validación exige un paso por tramo, 3 opciones y que la correcta haga lo que hace la ruta', () => {
    const ruta = rutas.elegirRuta({ nivel: 'A2' })
    const base = { actividad: actividadEmparejar('07-direcciones').actividad, modo: 'seguir', destino: { nombre: 'X' }, mapa: rutas.mapaDeRuta(ruta) }
    const pasos = ruta.pasos.map((p) => ({ instruccion: 'x', opciones: [
      { texto: 'a', accion: p.accion, correcta: true }, { texto: 'b', accion: 'recto', correcta: false }, { texto: 'c', accion: 'recto', correcta: false }] }))
    expect(validarActividad('07-direcciones', { ...base, pasos })).toBeNull()
    expect(validarActividad('07-direcciones', { ...base, pasos: pasos.slice(1) })).toMatch(/pasos/)
    const malGiro = structuredClone(pasos)
    malGiro[0].opciones[0].accion = 'recto'
    expect(validarActividad('07-direcciones', { ...base, pasos: malGiro })).toMatch(/correcta debe ser/)
  })
})

describe('07 · generar y jugar', () => {
  let gen
  beforeAll(async () => {
    gen = await request(app).post('/api/activities/generar').set('Authorization', `Bearer ${tokDoc}`)
      .send({ codigo: '07-direcciones', lecciones: [1], claseId: clase.claseId })
  }, 60_000)

  it('el prompt lleva la ruta real y el estilo del nivel; la actividad trae el mapa', () => {
    expect(gen.status).toBe(201)
    const lote = mock.llamadas.prompts.find((p) => p.includes('- 07-direcciones →'))
    expect(lote).toMatch(/city "La Paz, Bolivia"/)
    expect(lote).toMatch(/P1: drive along .* block/)
    expect(lote).toMatch(/DIRECTIONS STYLE \((A1|A2|B1|B2)\)/)
    const c = gen.body.actividad.contenido
    expect(c.mapa.pasos.length).toBe(c.pasos.length)
    expect(c.mapa.fuente).toMatch(/OpenStreetMap/)
    expect(gen.body.actividad.estado).toBe('aprobada')
  })

  it('una respuesta que no coincide con la ruta se repara (no llega rota al estudiante)', () => {
    const reparacion = mock.llamadas.prompts.find((p) => p.includes('"07-direcciones" you generated was rejected'))
    expect(reparacion).toMatch(/correcta debe ser/)
    expect(reparacion).toMatch(/ROUTE \(real streets/)
  })

  it('cada variante recorre otra ruta y el servidor califica las esquinas como un quiz', async () => {
    const vs = gen.body.actividad.variantes
    expect(vs.length).toBe(3)
    expect(new Set(vs.map((v) => v.mapa.id)).size).toBeGreaterThan(1)

    const sala = await request(app).post('/api/rooms').set('Authorization', `Bearer ${tokDoc}`).send({ modo: 'simple', actividadId: gen.body.actividad.id })
    const inv = await request(app).post('/api/auth/invitado').send({ codigo: sala.body.sala.codigo, codigoMatricula: clase.codigos[0] })
    const inicio = await request(app).post('/api/game/iniciar').set('Authorization', `Bearer ${inv.body.token}`).send({ codigo: sala.body.sala.codigo })
    const pasos = inicio.body.actividad.contenido.pasos
    // Todas bien menos la primera esquina
    const items = pasos.map((p, i) => ({ i, opcion: (i === 0 ? p.opciones.find((o) => !o.correcta) : p.opciones.find((o) => o.correcta)).texto }))
    const res = await request(app).post('/api/game/entregar-simple').set('Authorization', `Bearer ${inicio.body.token}`)
      .send({ partidaId: inicio.body.partidaId, respuestas: { items } })
    expect(res.status).toBe(200)
    const n = pasos.length
    expect(res.body.puntaje).toBe(Math.round(((n - 1) / n) * 100) - 1)   // −10 pts por error / 10
    expect(res.body.requiereRevision).toBe(false)
  })
})
