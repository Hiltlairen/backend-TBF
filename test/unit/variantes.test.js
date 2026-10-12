import { describe, it, expect } from 'vitest'
import { elegirVariante, totalVariantes, contenidoDeActividad, contenidosDeRuta } from '../../src/domain/variantes.js'

describe('elegirVariante', () => {
  it('con una sola variante siempre es la 1', () => {
    expect(elegirVariante(1, [1, 1, 1])).toBe(1)
  })

  it('elige al azar, pero solo entre las menos repartidas', () => {
    // 1 y 3 ya salieron; quedan 2 y 4 sin usar
    const azarBajo = () => 0
    const azarAlto = () => 0.99
    expect(elegirVariante(4, [1, 3], azarBajo)).toBe(2)
    expect(elegirVariante(4, [1, 3], azarAlto)).toBe(4)
  })

  it('con 10 variantes y 30 estudiantes, a cada variante le tocan exactamente 3', () => {
    const repartidas = []
    for (let i = 0; i < 30; i++) repartidas.push(elegirVariante(10, repartidas))
    const usos = Array.from({ length: 10 }, (_, k) => repartidas.filter((v) => v === k + 1).length)
    expect(usos).toEqual(Array(10).fill(3))
  })
})

describe('registros anteriores a las variantes', () => {
  it('cuentan como una sola variante y leen su contenido de siempre', () => {
    const act = { contenido: { a: 1 } }
    const ruta = { contenidos: { '01-emparejar': { a: 1 } } }
    expect(totalVariantes(act)).toBe(1)
    expect(contenidoDeActividad(act, 1)).toEqual({ a: 1 })
    expect(contenidosDeRuta(ruta, 1)).toEqual(ruta.contenidos)
  })

  it('con variantes, devuelve la pedida', () => {
    const act = { contenido: { v: 1 }, variantes: [{ v: 1 }, { v: 2 }] }
    expect(totalVariantes(act)).toBe(2)
    expect(contenidoDeActividad(act, 2)).toEqual({ v: 2 })
  })
})
