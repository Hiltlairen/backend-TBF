// ============================================================
// login-2fa.test.js — captcha + código por correo al iniciar sesión,
// y captcha al activar una cuenta nueva
// ============================================================
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import request from 'supertest'
import { crearAppDePrueba, loginComo, CREDENCIALES } from '../helpers/appTest.mjs'

let ctx, app, config, bandeja
const fetchOriginal = globalThis.fetch

beforeAll(async () => {
  ctx = await crearAppDePrueba()
  app = ctx.app
  ;({ config } = await import('../../src/config.js'))
  ;({ bandejaDePrueba: bandeja } = await import('../../src/services/email.js'))
  config.loginCodigoEmail = true
  config.turnstileSecret = 'secreto-de-prueba'
  // Cloudflare simulado: aprueba solo el token "captcha-ok".
  globalThis.fetch = async (url, opciones) => {
    if (String(url).includes('challenges.cloudflare.com')) {
      const ok = new URLSearchParams(opciones.body).get('response') === 'captcha-ok'
      return new Response(JSON.stringify({ success: ok }), { headers: { 'Content-Type': 'application/json' } })
    }
    return fetchOriginal(url, opciones)
  }
})
afterAll(() => { globalThis.fetch = fetchOriginal; ctx.limpiar() })
beforeEach(() => { bandeja.length = 0 })

const login = (extra = {}) => request(app).post('/api/auth/login').send({ ...CREDENCIALES.docente, captcha: 'captcha-ok', ...extra })
const codigoDelCorreo = () => bandeja.at(-1).html.match(/>(\d{6})</)[1]

describe('captcha en el inicio de sesión', () => {
  it('sin captcha o con uno inválido → 400, y no se manda ningún código', async () => {
    expect((await login({ captcha: undefined })).status).toBe(400)
    const malo = await login({ captcha: 'captcha-falso' })
    expect(malo.status).toBe(400)
    expect(malo.body.captcha).toBe(true)
    expect(bandeja).toHaveLength(0)
  })
})

describe('código por correo', () => {
  it('con la contraseña correcta NO entrega sesión: manda un código al correo', async () => {
    const r = await login()
    expect(r.status).toBe(200)
    expect(r.body.token).toBeUndefined()
    expect(r.body).toMatchObject({ requiereCodigo: true, minutos: 10 })
    expect(r.body.enviadoA).toMatch(/^do•+@englishlessons\.edu$/)
    expect(bandeja).toHaveLength(1)
    expect(bandeja[0].to).toBe(CREDENCIALES.docente.email)
  })

  it('con la contraseña incorrecta no se manda código', async () => {
    expect((await login({ password: 'mala' })).status).toBe(401)
    expect(bandeja).toHaveLength(0)
  })

  it('desafío + código correcto → sesión; el código no se puede reusar', async () => {
    const { desafio } = (await login()).body
    const codigo = codigoDelCorreo()
    const ok = await request(app).post('/api/auth/login/verificar').send({ desafio, codigo })
    expect(ok.status).toBe(200)
    expect(ok.body.usuario.email).toBe(CREDENCIALES.docente.email)
    expect((await request(app).get('/api/auth/yo').set('Authorization', `Bearer ${ok.body.token}`)).status).toBe(200)

    const otraVez = await request(app).post('/api/auth/login/verificar').send({ desafio, codigo })
    expect(otraVez.status).toBe(401)
    expect(otraVez.body.motivo).toBe('invalido')
  })

  it('código incorrecto: avisa los intentos que quedan; al 5º se invalida', async () => {
    const { desafio } = (await login()).body
    const bueno = codigoDelCorreo()
    const malo = bueno === '000000' ? '111111' : '000000'
    const primera = await request(app).post('/api/auth/login/verificar').send({ desafio, codigo: malo })
    expect(primera.body).toMatchObject({ motivo: 'incorrecto' })
    expect(primera.body.error).toMatch(/4 intento/)
    for (let i = 0; i < 3; i++) await request(app).post('/api/auth/login/verificar').send({ desafio, codigo: malo })
    expect((await request(app).post('/api/auth/login/verificar').send({ desafio, codigo: malo })).body.motivo).toBe('agotado')
    // Ni siquiera el código bueno sirve ya.
    expect((await request(app).post('/api/auth/login/verificar').send({ desafio, codigo: bueno })).status).toBe(401)
  })

  it('reenviar manda un código nuevo y el anterior deja de servir', async () => {
    const { desafio } = (await login()).body
    const viejo = codigoDelCorreo()
    expect((await request(app).post('/api/auth/login/reenviar').send({ desafio })).status).toBe(200)
    const nuevo = codigoDelCorreo()
    expect(bandeja).toHaveLength(2)
    if (viejo !== nuevo) {
      expect((await request(app).post('/api/auth/login/verificar').send({ desafio, codigo: viejo })).status).toBe(401)
    }
    expect((await request(app).post('/api/auth/login/verificar').send({ desafio, codigo: nuevo })).status).toBe(200)
  })

  it('con LOGIN_CODIGO_EMAIL=false se entra directo (como antes)', async () => {
    config.loginCodigoEmail = false
    try {
      const r = await login()
      expect(r.body.token).toBeTruthy()
    } finally { config.loginCodigoEmail = true }
  })
})

describe('captcha al activar una cuenta nueva', () => {
  it('sin captcha no se activa y el enlace NO se gasta; con captcha sí', async () => {
    config.loginCodigoEmail = false
    const tokAdm = (await request(app).post('/api/auth/login').send({ ...CREDENCIALES.admin, captcha: 'captcha-ok' })).body.token
    config.loginCodigoEmail = true
    await request(app).post('/api/admin/usuarios').set('Authorization', `Bearer ${tokAdm}`)
      .send({ email: 'nueva@colegio.edu', nombre: 'Docente Nueva', rol: 'docente' })
    const enlace = bandeja.find((c) => c.to === 'nueva@colegio.edu').html.match(/token=([\w-]+)/)[1]

    const sinCaptcha = await request(app).post('/api/auth/verificar-cuenta').send({ token: enlace, password: 'ClaveNueva2026' })
    expect(sinCaptcha.status).toBe(400)

    const conCaptcha = await request(app).post('/api/auth/verificar-cuenta')
      .send({ token: enlace, password: 'ClaveNueva2026', captcha: 'captcha-ok' })
    expect(conCaptcha.status).toBe(200)
    expect(conCaptcha.body.usuario.email).toBe('nueva@colegio.edu')
  })
})

// loginComo() (helper de los demás tests) sigue andando con el login directo.
describe('compatibilidad', () => {
  it('loginComo funciona con el código desactivado', async () => {
    config.loginCodigoEmail = false; config.turnstileSecret = ''
    try { expect(await loginComo(app, 'curador')).toBeTruthy() }
    finally { config.loginCodigoEmail = true; config.turnstileSecret = 'secreto-de-prueba' }
  })
})
