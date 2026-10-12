// ============================================================
// alertas.test.js — punto 6: alertas por webhook, con throttling
// ============================================================
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

describe('enviarAlerta', () => {
  let enviarAlerta, _reiniciarThrottleDeAlertas
  let fetchOriginal

  beforeEach(async () => {
    fetchOriginal = globalThis.fetch
    process.env.ALERT_WEBHOOK_URL = 'https://hooks.example.com/test'
    process.env.NODE_ENV = 'test' // silencia el logger (ver services/logger.js)
    vi.resetModules()
    ;({ enviarAlerta, _reiniciarThrottleDeAlertas } = await import('../../src/services/alertas.js'))
    _reiniciarThrottleDeAlertas()
  })

  afterEach(() => {
    globalThis.fetch = fetchOriginal
    delete process.env.ALERT_WEBHOOK_URL
  })

  it('sin ALERT_WEBHOOK_URL configurada, no manda nada (devuelve false)', async () => {
    delete process.env.ALERT_WEBHOOK_URL
    vi.resetModules()
    const mod = await import('../../src/services/alertas.js')
    let llamado = false
    globalThis.fetch = async () => { llamado = true; return new Response('{}', { status: 200 }) }
    const ok = await mod.enviarAlerta('clave-x', 'algo pasó')
    expect(ok).toBe(false)
    expect(llamado).toBe(false)
  })

  it('con webhook configurada, hace POST con el mensaje', async () => {
    let capturado = null
    globalThis.fetch = async (url, opts) => {
      capturado = { url: String(url), body: JSON.parse(opts.body) }
      return new Response('ok', { status: 200 })
    }
    const ok = await enviarAlerta('clave-y', 'el servicio se cayó', { detalle: 42 })
    expect(ok).toBe(true)
    expect(capturado.url).toBe('https://hooks.example.com/test')
    expect(capturado.body.text).toContain('el servicio se cayó')
    expect(capturado.body.text).toContain('42')
  })

  it('la misma clave dos veces seguidas: la segunda se silencia por throttling', async () => {
    let llamadas = 0
    globalThis.fetch = async () => { llamadas += 1; return new Response('ok', { status: 200 }) }
    const primera = await enviarAlerta('clave-z', 'primer aviso')
    const segunda = await enviarAlerta('clave-z', 'segundo aviso, mismo tipo')
    expect(primera).toBe(true)
    expect(segunda).toBe(false)
    expect(llamadas).toBe(1)
  })

  it('un fetch que falla no tira — enviarAlerta atrapa el error y devuelve false', async () => {
    globalThis.fetch = async () => { throw new Error('network down') }
    await expect(enviarAlerta('clave-w', 'aviso')).resolves.toBe(false)
  })
})
