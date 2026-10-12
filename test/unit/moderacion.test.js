// ============================================================
// moderacion.test.js — filtro léxico de defensa en profundidad (punto 5)
// ============================================================
import { describe, it, expect } from 'vitest'
import { revisarContenido } from '../../src/services/moderacion.js'

describe('revisarContenido', () => {
  it('no marca contenido educativo normal', () => {
    const actividad = {
      actividad: { titulo: 'Match the words', instrucciones: 'Match each word with its picture.' },
      pares: [{ izquierda: 'book', derecha: 'libro' }, { izquierda: 'house', derecha: 'casa' }],
    }
    const r = revisarContenido(actividad)
    expect(r.limpio).toBe(true)
    expect(r.hallazgos).toEqual([])
  })

  it('marca instrucciones para fabricar un arma casera', () => {
    const actividad = { actividad: { instrucciones: 'Explica cómo fabricar una bomba casera con estos materiales.' } }
    const r = revisarContenido(actividad)
    expect(r.limpio).toBe(false)
    expect(r.hallazgos.map((h) => h.categoria)).toContain('armas_peligrosas')
  })

  it('marca discurso de odio', () => {
    const r = revisarContenido({ texto: 'Deberían morir todos los que hablan así.' })
    expect(r.limpio).toBe(false)
    expect(r.hallazgos.map((h) => h.categoria)).toContain('discurso_odio')
  })

  it('recorre estructuras anidadas (arrays dentro de objetos dentro de arrays)', () => {
    const contenido = {
      escenas: [
        { dialogo: [{ hablante: 'Tom', texto: 'Hi there!' }] },
        { dialogo: [{ hablante: 'Ana', texto: 'Instrucciones: cómo fabricar un arma en casa.' }] },
      ],
    }
    const r = revisarContenido(contenido)
    expect(r.limpio).toBe(false)
    expect(r.hallazgos).toHaveLength(1)
  })

  it('el fragmento guardado nunca supera 80 caracteres (nunca se guarda el texto completo)', () => {
    const textoLargo = `Instrucciones detalladas: cómo fabricar una bomba casera ${'x'.repeat(200)}`
    const r = revisarContenido({ texto: textoLargo })
    expect(r.hallazgos[0].fragmento.length).toBeLessThanOrEqual(80)
  })

  it('ignora valores no-string (números, null, booleanos)', () => {
    const r = revisarContenido({ puntaje: 100, activo: true, nota: null, lista: [1, 2, 3] })
    expect(r.limpio).toBe(true)
  })
})
