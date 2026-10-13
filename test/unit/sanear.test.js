// ============================================================
// sanear.test.js — arreglos automáticos que evitan pedir reparaciones
// ============================================================
import { describe, it, expect } from 'vitest'
import { sanear, validarActividad } from '../../src/services/validators.js'

const meta = { id: '15-laberinto-palabras', titulo: 'Word Maze', instrucciones: 'Recorre la oración', tiempo_limite: 120 }
const nivel = (id, palabras, distractores = []) => ({
  id, oracion: palabras.join(' ') + '.', traduccion: 'traducción', palabras_en_orden: palabras, distractores,
})
const ok4 = ['I', 'go', 'to', 'school']

describe('laberinto: se corrige en vez de descartar', () => {
  it('recorta distractores de más y quita los que repiten una palabra de la oración', () => {
    const a = { actividad: meta, niveles: [nivel('N1', ok4, ['run', 'go', 'sit', 'eat', 'fly', 'cry']), nivel('N2', ok4), nivel('N3', ok4)] }
    const s = sanear('15-laberinto-palabras', a)
    expect(s.niveles[0].distractores).toEqual(['run', 'sit', 'eat', 'fly'])
    expect(validarActividad('15-laberinto-palabras', s)).toBeNull()
  })

  it('quita SOLO el nivel con una oración demasiado larga si quedan 3 buenos', () => {
    const larga = ['I', 'really', 'like', 'to', 'go', 'to', 'my', 'school', 'early']
    const a = { actividad: meta, niveles: [nivel('N1', ok4), nivel('N2', larga), nivel('N3', ok4), nivel('N4', ok4)] }
    expect(validarActividad('15-laberinto-palabras', a)).toMatch(/demasiadas palabras/)
    const s = sanear('15-laberinto-palabras', a)
    expect(s.niveles.map((n) => n.id)).toEqual(['N1', 'N3', 'N4'])
    expect(validarActividad('15-laberinto-palabras', s)).toBeNull()
  })

  it('si no quedan 3 niveles buenos, sigue siendo inválida (no inventa contenido)', () => {
    const a = { actividad: meta, niveles: [nivel('N1', ok4), nivel('N2', ['too', 'short'])] }
    expect(validarActividad('15-laberinto-palabras', sanear('15-laberinto-palabras', a))).not.toBeNull()
  })

  it('ids repetidos se renumeran', () => {
    const a = { actividad: meta, niveles: [nivel('N1', ok4), nivel('N1', ok4), nivel('N1', ok4)] }
    expect(new Set(sanear('15-laberinto-palabras', a).niveles.map((n) => n.id)).size).toBe(3)
  })
})
