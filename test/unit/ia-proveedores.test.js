// ============================================================
// ia-proveedores.test.js — DeepSeek primero, Gemini como última opción
// ============================================================
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { config } from '../../src/config.js'
import { callGemini, estadoIA, medirTokens, reiniciarTurnos } from '../../src/services/gemini.js'

const CLAVES = ['deepseekApiKey', 'geminiApiKey', 'geminiModelFallback', 'geminiEsperaMinMs', 'geminiEsperaMaxMs', 'deepseekModel']
const original = { fetch: globalThis.fetch, ...Object.fromEntries(CLAVES.map((k) => [k, config[k]])) }
let pedidos

const json = (cuerpo, status = 200) =>
  new Response(JSON.stringify(cuerpo), { status, headers: { 'Content-Type': 'application/json' } })
const respuestaDeepSeek = (contenido, uso = { prompt_tokens: 120, completion_tokens: 80 }) =>
  json({ choices: [{ message: { content: contenido }, finish_reason: 'stop' }], usage: uso })
const respuestaGemini = (texto) =>
  json({ candidates: [{ content: { parts: [{ text: texto }] } }], usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5 } })

/** fetch falso: `deepseek` y `gemini` deciden la respuesta de cada proveedor. */
function simular({ deepseek, gemini }) {
  globalThis.fetch = async (url, opciones) => {
    const cuerpo = JSON.parse(opciones.body)
    if (String(url).includes('deepseek')) { pedidos.push({ a: 'deepseek', url, cuerpo, headers: opciones.headers }); return deepseek(cuerpo) }
    pedidos.push({ a: 'gemini', url, cuerpo }); return gemini(cuerpo)
  }
}

beforeEach(() => {
  pedidos = []
  reiniciarTurnos()
  Object.assign(config, {
    deepseekApiKey: 'ds-prueba', geminiApiKey: 'gm-prueba', geminiModelFallback: [],
    geminiEsperaMinMs: 0, geminiEsperaMaxMs: 0, deepseekModel: 'deepseek-flash',
  })
})
afterEach(() => {
  globalThis.fetch = original.fetch
  for (const k of CLAVES) config[k] = original[k]
})

describe('DeepSeek como proveedor principal', () => {
  it('pide JSON, sin modo de razonamiento, y cuenta los tokens', async () => {
    simular({ deepseek: () => respuestaDeepSeek('{"hola":"mundo"}'), gemini: () => { throw new Error('no debía llamarse') } })
    const { resultado, tokens } = await medirTokens(() => callGemini('Devuelve JSON', { temperature: 0.9, maxOutputTokens: 1500 }))

    expect(resultado.json).toEqual({ hola: 'mundo' })
    expect(resultado.modelo).toBe('deepseek-flash')
    expect(tokens).toMatchObject({ entrada: 120, salida: 80, llamadas: 1 })
    expect(tokens.porProveedor).toEqual({ deepseek: { llamadas: 1, entrada: 120, salida: 80 } })

    const [p] = pedidos
    expect(p.url).toBe('https://api.deepseek.com/chat/completions')
    expect(p.headers.Authorization).toBe('Bearer ds-prueba')
    expect(p.cuerpo).toMatchObject({
      model: 'deepseek-flash', temperature: 0.9, max_tokens: 1500,
      response_format: { type: 'json_object' }, thinking: { type: 'disabled' },
    })
  })

  it('si DeepSeek devuelve contenido vacío, reintenta', async () => {
    let n = 0
    simular({ deepseek: () => respuestaDeepSeek(n++ === 0 ? '' : '{"ok":true}'), gemini: () => { throw new Error('no') } })
    const r = await callGemini('JSON')
    expect(r.json).toEqual({ ok: true })
    expect(pedidos.filter((x) => x.a === 'deepseek')).toHaveLength(2)
  })
})

describe('desglose por proveedor', () => {
  it('cuando responden los dos, el medidor separa cuánto gastó cada uno', async () => {
    let n = 0
    simular({
      deepseek: () => (n++ === 0 ? respuestaDeepSeek('{"a":1}') : json({}, 402)),
      gemini: () => respuestaGemini('{"b":2}'),
    })
    const { tokens } = await medirTokens(async () => { await callGemini('JSON'); await callGemini('JSON') })
    expect(tokens.porProveedor).toEqual({
      deepseek: { llamadas: 1, entrada: 120, salida: 80 },
      gemini: { llamadas: 1, entrada: 10, salida: 5 },
    })
    expect(tokens).toMatchObject({ llamadas: 2, entrada: 130, salida: 85 })
  })

  it('DeepSeek tiene su propio tiempo de espera, más largo que el de Gemini', () => {
    expect(config.deepseekTimeoutMs).toBeGreaterThanOrEqual(60_000)
  })
})

describe('Gemini como última opción', () => {
  it('sin saldo en DeepSeek (402) pasa a Gemini al instante, sin reintentar DeepSeek', async () => {
    simular({ deepseek: () => json({ error: { message: 'Insufficient Balance' } }, 402), gemini: () => respuestaGemini('{"de":"gemini"}') })
    const r = await callGemini('JSON')
    expect(r.json).toEqual({ de: 'gemini' })
    expect(pedidos.map((x) => x.a)).toEqual(['deepseek', 'gemini'])
    expect(estadoIA().disponible).toBe(true)
  })

  it('DeepSeek saturado (503) agota sus reintentos y luego responde Gemini', async () => {
    simular({ deepseek: () => json({}, 503), gemini: () => respuestaGemini('{"de":"gemini"}') })
    const r = await callGemini('JSON', { reintentos: 1 })
    expect(r.json).toEqual({ de: 'gemini' })
    expect(pedidos.filter((x) => x.a === 'deepseek')).toHaveLength(2)
  }, 10_000)

  it('sin key de DeepSeek se usa solo Gemini', async () => {
    config.deepseekApiKey = ''
    simular({ deepseek: () => { throw new Error('no') }, gemini: () => respuestaGemini('{"solo":"gemini"}') })
    expect((await callGemini('JSON')).json).toEqual({ solo: 'gemini' })
    expect(pedidos.map((x) => x.a)).toEqual(['gemini'])
  })

  it('si fallan los dos por cuota, la IA se pausa con un mensaje sin nombres de proveedor', async () => {
    simular({
      deepseek: () => json({}, 402),
      gemini: () => json({ error: { status: 'RESOURCE_EXHAUSTED', message: 'quota' } }, 429),
    })
    await expect(callGemini('JSON')).rejects.toMatchObject({ tipo: 'cuota' })
    const ia = estadoIA()
    expect(ia).toMatchObject({ disponible: false, motivo: 'cuota' })
    expect(ia.mensaje).not.toMatch(/gemini|deepseek/i)
    // "Comprobar ahora" (forzar) vuelve a probar y, si responde, la rehabilita.
    simular({ deepseek: () => respuestaDeepSeek('{"ok":1}'), gemini: () => { throw new Error('no') } })
    await callGemini('JSON', { forzar: true })
    expect(estadoIA().disponible).toBe(true)
  })
})
