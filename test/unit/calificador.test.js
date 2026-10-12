// ============================================================
// calificador.test.js — la nota que pone el servidor por tipo de
// actividad, y el repaso que se arma con los intentos
// ============================================================
import { describe, it, expect } from 'vitest'
import { calificar } from '../../src/domain/calificador.js'
import { armarRepaso } from '../../src/services/repaso.js'

const meta = (penalizacion = 10) => ({ actividad: { penalizacion_por_error: penalizacion } })

describe('quiz (conversación, canción, anuncios…)', () => {
  const llamada = {
    ...meta(10),
    turnos: [
      { id: 'C1', hablante: 'caller', texto: 'Are you free today?' },
      { id: 'C2', tipo: 'opciones', opciones: [{ id: 'a', texto: 'Yes, I am.', correcta: true }, { id: 'b', texto: 'Table.', correcta: false }] },
      { id: 'C3', hablante: 'caller', texto: 'Where do we meet?' },
      { id: 'C4', tipo: 'opciones', opciones: [{ id: 'c', texto: 'At my house.', correcta: true }, { id: 'd', texto: 'Water.', correcta: false }] },
    ],
  }

  it('aplica la misma penalización que el navegador: 50% − 1 error × 10/10 = 49', () => {
    const r = calificar('12-llamada', llamada, { items: [{ i: 0, opcion: 'Yes, I am.' }, { i: 1, opcion: 'Water.' }] })
    expect(r.puntaje).toBe(49)
  })

  it('usa la última línea del interlocutor como pregunta del resumen', () => {
    const r = calificar('12-llamada', llamada, { items: [{ i: 0, opcion: 'Table.' }] })
    expect(r.intentos[0]).toMatchObject({ pregunta: 'Are you free today?', esperado: 'Yes, I am.', respondio: 'Table.', ok: false })
    expect(r.intentos[1]).toMatchObject({ respondio: null, ok: false }) // sin responder
  })

  it('canciones: las opciones son strings y la correcta es respuesta_correcta', () => {
    const cancion = { ...meta(0), lineas: [{ id: 'S1', texto: 'I {blank} you', respuesta_correcta: 'love', opciones: ['love', 'eat'] }] }
    expect(calificar('10-canciones', cancion, { items: [{ i: 0, opcion: 'love' }] }).puntaje).toBe(100)
  })
})

describe('escribir', () => {
  const dicc = {
    entradas: [
      { contenido: 'libro', respuesta_correcta: 'book', alternativas_aceptadas: [] },
      { contenido: 'carro', respuesta_correcta: 'car', alternativas_aceptadas: ['automobile'] },
    ],
  }
  it('acepta alternativas e ignora mayúsculas y espacios', () => {
    const r = calificar('06-diccionario', dicc, { items: [{ i: 0, texto: '  BOOK ' }, { i: 1, texto: 'automobile' }] })
    expect(r.puntaje).toBe(100)
  })
})

describe('sopa de letras', () => {
  const sopa = { palabras: ['BOOK', 'TABLE', 'CHAIR', 'WATER'].map((w) => ({ palabra: w, pista: w.toLowerCase() })) }

  it('califica solo sobre las palabras que entraron en la cuadrícula', () => {
    const r = calificar('04-sopa-letras', sopa, { colocadas: ['BOOK', 'TABLE'], encontradas: ['BOOK', 'TABLE'] })
    expect(r.puntaje).toBe(100)
  })

  it('ignora palabras inventadas o no colocadas', () => {
    const r = calificar('04-sopa-letras', sopa, {
      colocadas: ['BOOK', 'TABLE', 'CHAIR', 'WATER', 'HACK'], encontradas: ['BOOK', 'HACK'],
    })
    expect(r.puntaje).toBe(25)
  })
})

describe('emparejar', () => {
  const emp = {
    ...meta(10),
    columna_izquierda: { items: [{ id: 'L1', contenido: 'perro' }, { id: 'L2', contenido: 'gato' }] },
    columna_derecha: { items: [{ id: 'R1', contenido: 'dog' }, { id: 'R2', contenido: 'cat' }] },
    pares_correctos: [{ izquierda: 'L1', derecha: 'R1' }, { izquierda: 'L2', derecha: 'R2' }],
  }

  it('si deja pares sin resolver la nota no supera lo que completó', () => {
    expect(calificar('01-emparejar', emp, { intentos: [{ izq: 'L1', der: 'R1' }] }).puntaje).toBe(50)
  })

  it('marca el par como fallado y guarda lo que eligió primero', () => {
    const r = calificar('01-emparejar', emp, { intentos: [{ izq: 'L2', der: 'R1' }, { izq: 'L2', der: 'R2' }, { izq: 'L1', der: 'R1' }] })
    expect(r.puntaje).toBe(90)
    expect(r.intentos[1]).toMatchObject({ pregunta: 'gato', esperado: 'cat', respondio: 'dog', ok: false })
  })
})

describe('otras actividades', () => {
  it('armar escenario: el distractor va al descarte', () => {
    const d = {
      escenario_interior: { zonas: [{ id: 'z1', nombre: 'Cocina' }] },
      objetos: [{ id: 'o1', nombre: 'stove', zona_correcta: 'z1' }, { id: 'o2', nombre: 'car', zona_correcta: null }],
    }
    expect(calificar('18-armar-escenario', d, { colocados: { o1: 'z1', o2: '__descartar__' } }).puntaje).toBe(100)
    expect(calificar('18-armar-escenario', d, { colocados: { o1: 'z1', o2: 'z1' } }).intentos[1])
      .toMatchObject({ esperado: 'No pertenece aquí', respondio: 'Cocina', ok: false })
  })

  it('rompecabezas: solo cuenta la oración armada en el orden exacto', () => {
    const d = { rompecabezas: [{ oracion: 'I like cats', traduccion: 'Me gustan los gatos', piezas_en_orden: ['I', 'like', 'cats'] }] }
    expect(calificar('16-rompecabezas-oracion', d, { items: [{ i: 0, piezas: ['I', 'like', 'cats'] }] }).puntaje).toBe(100)
    expect(calificar('16-rompecabezas-oracion', d, { items: [{ i: 0, piezas: ['like', 'I', 'cats'] }] }).puntaje).toBe(0)
  })

  it('impostor: acierta quien toca la tarjeta incorrecta', () => {
    const d = { rondas: [{ tarjetas: [
      { id: 't1', palabra_en: 'dog', traduccion_mostrada: 'perro', correcta: true },
      { id: 't2', palabra_en: 'cat', traduccion_mostrada: 'mesa', correcta: false },
    ] }] }
    expect(calificar('19-impostor', d, { items: [{ i: 0, tarjeta: 't2' }] }).puntaje).toBe(100)
    expect(calificar('19-impostor', d, { items: [{ i: 0, tarjeta: 't1' }] }).puntaje).toBe(0)
  })

  it('redacción no tiene nota automática y guarda el texto para el docente', () => {
    const r = calificar('05-redaccion', {}, { texto: 'My name is Ana and I live in La Paz.' })
    expect(r.puntaje).toBeNull()
    expect(r.detalle).toMatchObject({ texto: 'My name is Ana and I live in La Paz.', palabras: 10 })
  })

  it('respuestas basura no rompen nada: nota 0', () => {
    expect(calificar('06-diccionario', { entradas: [{ contenido: 'x', respuesta_correcta: 'y' }] }, { items: 'hack' }).puntaje).toBe(0)
  })
})

describe('armarRepaso', () => {
  it('sin intentos (redacción, pronunciación) no hay repaso', () => {
    expect(armarRepaso([{ intentos: [] }])).toBeNull()
  })

  it('separa dominadas de errores y no repite el mismo ítem entre etapas', () => {
    const fallo = { pregunta: 'perro', esperado: 'dog', respondio: 'cat', ok: false }
    const r = armarRepaso([
      { intentos: [fallo, { pregunta: 'gato', esperado: 'cat', respondio: 'cat', ok: true }] },
      { intentos: [fallo] },
    ])
    expect(r.dominadas).toEqual(['cat'])
    expect(r.errores).toHaveLength(1)
    expect(r.ronda[0].opciones.find((o) => o.correcta).texto).toBe('dog')
  })
})
