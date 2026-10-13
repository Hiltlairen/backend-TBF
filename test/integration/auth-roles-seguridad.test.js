// ============================================================
// auth-roles-seguridad.test.js — secciones 1/2/5: auth, roles,
// cabeceras de seguridad y validación de esquemas
// ============================================================
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import request from 'supertest'
import { crearAppDePrueba, loginComo, CREDENCIALES } from '../helpers/appTest.mjs'

let ctx, app

beforeAll(async () => { ctx = await crearAppDePrueba(); app = ctx.app })
afterAll(() => ctx.limpiar())

describe('login y roles', () => {
  it('login correcto devuelve token y datos del usuario', async () => {
    const res = await request(app).post('/api/auth/login').send(CREDENCIALES.docente)
    expect(res.status).toBe(200)
    expect(res.body.usuario.rol).toBe('docente')
    expect(typeof res.body.token).toBe('string')
  })

  it('contraseña incorrecta → 401', async () => {
    const res = await request(app).post('/api/auth/login')
      .send({ email: CREDENCIALES.docente.email, password: 'no-es-esta' })
    expect(res.status).toBe(401)
  })

  it('sin token → 401 en una ruta protegida', async () => {
    const res = await request(app).get('/api/library/libros')
    expect(res.status).toBe(401)
  })

  it('un curador no puede generar actividades (403)', async () => {
    const tokCur = await loginComo(app, 'curador')
    const res = await request(app).post('/api/activities/generar')
      .set('Authorization', `Bearer ${tokCur}`)
      .send({ codigo: '01-emparejar', lecciones: [1], curso: 'Test' })
    expect(res.status).toBe(403)
  })

  it('un docente no entra al panel de admin (403), el admin sí (200)', async () => {
    const tokDoc = await loginComo(app, 'docente')
    const tokAdm = await loginComo(app, 'admin')
    const negado = await request(app).get('/api/admin/usuarios').set('Authorization', `Bearer ${tokDoc}`)
    const permitido = await request(app).get('/api/admin/usuarios').set('Authorization', `Bearer ${tokAdm}`)
    expect(negado.status).toBe(403)
    expect(permitido.status).toBe(200)
  })
})

describe('id de correlación (punto 6: observabilidad)', () => {
  it('toda respuesta trae X-Request-Id, y un error 404 lo repite en el body', async () => {
    const res = await request(app).get('/api/no-existe-esta-ruta')
    expect(res.status).toBe(404)
    expect(res.headers['x-request-id']).toBeTruthy()
    expect(res.body.requestId).toBe(res.headers['x-request-id'])
  })

  it('si el cliente manda X-Request-Id, el servidor lo respeta en vez de generar uno nuevo', async () => {
    const res = await request(app).get('/api/salud').set('X-Request-Id', 'mi-id-de-prueba-123')
    expect(res.headers['x-request-id']).toBe('mi-id-de-prueba-123')
  })
})

describe('cabeceras de seguridad (helmet)', () => {
  it('llegan en cualquier respuesta, incluso un 401', async () => {
    const res = await request(app).get('/api/library/libros')
    expect(res.headers['x-content-type-options']).toBe('nosniff')
    expect(res.headers['x-powered-by']).toBeUndefined()
    expect(res.headers['x-dns-prefetch-control']).toBeDefined()
  })

  it('CSP queda desactivado a propósito (API JSON pura) y CORP es cross-origin', async () => {
    const res = await request(app).get('/api/salud')
    expect(res.headers['content-security-policy']).toBeUndefined()
    expect(res.headers['cross-origin-resource-policy']).toBe('cross-origin')
  })
})

describe('validación de esquemas (zod) — punto 5', () => {
  it('body con un campo del tipo equivocado en login → 400 con detalle por campo', async () => {
    // loginSchema no exige forma de email (eso lo decide bcrypt al
    // comparar), pero SÍ exige que sea un string — mandar un número
    // es lo que dispara el 400 acá.
    const res = await request(app).post('/api/auth/login').send({ email: 12345, password: 'abc' })
    expect(res.status).toBe(400)
    expect(res.body.error).toMatch(/Datos inválidos/)
    expect(Array.isArray(res.body.detalles)).toBe(true)
    expect(res.body.detalles.length).toBeGreaterThan(0)
  })

  it('falta un campo requerido → 400, nunca 500', async () => {
    const res = await request(app).post('/api/auth/login').send({ email: 'x@y.com' })
    expect(res.status).toBe(400)
  })

  it('PATCH /admin/usuarios/:id con un tipo de dato incorrecto → 400 (antes se ignoraba en silencio)', async () => {
    const tokAdm = await loginComo(app, 'admin')
    const lista = await request(app).get('/api/admin/usuarios').set('Authorization', `Bearer ${tokAdm}`)
    const alguien = lista.body.usuarios.find((u) => u.rol === 'docente')
    const res = await request(app).patch(`/api/admin/usuarios/${alguien.id}`)
      .set('Authorization', `Bearer ${tokAdm}`)
      .send({ activo: 'sí' }) // debería ser boolean
    expect(res.status).toBe(400)
  })

  it('POST /review/:id/nota exige texto no vacío (antes aceptaba nota vacía en silencio)', async () => {
    const tokCur = await loginComo(app, 'curador')
    // No hace falta un item real: el 400 de validación corre ANTES
    // de buscar el item en la base, así que sirve cualquier id.
    const res = await request(app).post('/api/review/no-existe/nota')
      .set('Authorization', `Bearer ${tokCur}`)
      .send({ texto: '' })
    expect(res.status).toBe(400)
  })
})

describe('el admin no puede dejarse afuera a sí mismo', () => {
  it('ni darse de baja ni cambiarse el rol (409); a otro sí lo puede dar de baja y reactivar', async () => {
    const tokAdm = await loginComo(app, 'admin')
    const A = { Authorization: `Bearer ${tokAdm}` }
    const { usuarios } = (await request(app).get('/api/admin/usuarios').set(A)).body
    const yo = usuarios.find((u) => u.email === 'admin@englishlessons.edu')
    const otro = usuarios.find((u) => u.email === 'docente2@englishlessons.edu')

    expect((await request(app).post(`/api/admin/usuarios/${yo.id}/baja`).set(A)).status).toBe(409)
    expect((await request(app).patch(`/api/admin/usuarios/${yo.id}`).set(A).send({ activo: false })).status).toBe(409)
    expect((await request(app).patch(`/api/admin/usuarios/${yo.id}`).set(A).send({ rol: 'docente' })).status).toBe(409)

    expect((await request(app).post(`/api/admin/usuarios/${otro.id}/baja`).set(A)).body.usuario.activo).toBe(false)
    expect((await request(app).patch(`/api/admin/usuarios/${otro.id}`).set(A).send({ activo: true })).body.usuario.activo).toBe(true)
  })
})

describe('límites de peticiones en /api/auth', () => {
  it('navegar no desloguea: muchas llamadas a /yo y logins correctos no se frenan', async () => {
    const tok = await loginComo(app, 'docente')
    for (let i = 0; i < 30; i++) {
      expect((await request(app).get('/api/auth/yo').set('Authorization', `Bearer ${tok}`)).status).toBe(200)
    }
    for (let i = 0; i < 25; i++) {
      expect((await request(app).post('/api/auth/login').send(CREDENCIALES.curador)).status).toBe(200)
    }
  })

  it('los intentos fallidos sí se frenan (429 tras 20)', async () => {
    const malos = []
    for (let i = 0; i < 22; i++) {
      malos.push((await request(app).post('/api/auth/login').send({ email: 'nadie@x.edu', password: 'mala-clave' })).status)
    }
    // (otros tests de este archivo ya sumaron algún intento fallido)
    expect(malos[0]).toBe(401)
    expect(malos.at(-1)).toBe(429)
  })
})
