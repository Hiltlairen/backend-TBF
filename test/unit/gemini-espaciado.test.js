// ============================================================
// gemini-espaciado.test.js — pausa entre solicitudes a Gemini
// ============================================================
// Para no saturar el límite por minuto del plan gratuito, entre el
// inicio de una solicitud y el de la siguiente debe pasar al menos
// GEMINI_ESPERA_MIN_MS — también cuando salen en paralelo.
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { config } from '../../src/config.js'
import { callGemini, reiniciarTurnos } from '../../src/services/gemini.js'

const original = { fetch: globalThis.fetch, ...config }
let llegadas

beforeEach(() => {
  llegadas = []
  reiniciarTurnos()
  Object.assign(config, { deepseekApiKey: '', geminiApiKey: 'clave-de-prueba', geminiModelFallback: [], geminiEsperaMinMs: 150, geminiEsperaMaxMs: 150 })
  globalThis.fetch = async () => {
    llegadas.push(Date.now())
    return new Response(JSON.stringify({
      candidates: [{ content: { parts: [{ text: '{"ok":true}' }] } }],
      usageMetadata: { promptTokenCount: 1, candidatesTokenCount: 1 },
    }), { status: 200, headers: { 'Content-Type': 'application/json' } })
  }
})
afterEach(() => {
  globalThis.fetch = original.fetch
  Object.assign(config, {
    geminiApiKey: original.geminiApiKey, geminiModelFallback: original.geminiModelFallback,
    geminiEsperaMinMs: original.geminiEsperaMinMs, geminiEsperaMaxMs: original.geminiEsperaMaxMs,
  })
})

describe('espaciado entre solicitudes a Gemini', () => {
  it('tres llamadas en paralelo llegan separadas al menos por la pausa mínima', async () => {
    await Promise.all([callGemini('a'), callGemini('b'), callGemini('c')])
    expect(llegadas).toHaveLength(3)
    const separaciones = llegadas.slice(1).map((t, i) => t - llegadas[i])
    for (const s of separaciones) expect(s).toBeGreaterThanOrEqual(140) // margen del reloj
  })

  it('la primera llamada (sin otra reciente) sale sin esperar', async () => {
    const inicio = Date.now()
    await callGemini('sola')
    expect(llegadas[0] - inicio).toBeLessThan(100)
  })

  it('con la pausa en 0 no hay espera', async () => {
    Object.assign(config, { geminiEsperaMinMs: 0, geminiEsperaMaxMs: 0 })
    const inicio = Date.now()
    await Promise.all([callGemini('a'), callGemini('b'), callGemini('c')])
    expect(Date.now() - inicio).toBeLessThan(100)
  })
})
