// ============================================================
// test/helpers/appTest.mjs — arranca la app en memoria para tests
// ============================================================
// vitest aísla el registro de módulos por ARCHIVO de test (pool por
// defecto: 'forks', isolate: true) — así que cada archivo que llama
// crearAppDePrueba() obtiene su propia copia fresca de config.js,
// db/store.js, etc. Por eso las variables de entorno de acá tienen
// que fijarse ANTES del primer `import('../../src/index.js')`: son
// justo las que config.js lee al cargar por primera vez.
//
// IMPORTANTE: no uses import estático de src/index.js en un archivo
// de test — siempre a través de esta función, con `await import(...)`
// dinámico, para que el orden env→import se respete.
// ============================================================
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import request from 'supertest'

export const CREDENCIALES = {
  admin:   { email: 'admin@englishlessons.edu',      password: 'Admin*2026' },
  curador: { email: 'curaduria@englishlessons.edu',   password: 'Curador*2026' },
  docente: { email: 'docente@englishlessons.edu',     password: 'Docente*2026' },
}

/**
 * Arranca la app (usuarios sembrados, jobs de purga/backup activos)
 * SIN abrir un puerto real: supertest habla con `app` directo en
 * memoria. DATA_DIR y BACKUP_DIR son carpetas temporales propias de
 * esta corrida, así que un test nunca pisa datos de otro ni del
 * proyecto real.
 */
export async function crearAppDePrueba({ conGemini = true } = {}) {
  const dataDir = mkdtempSync(path.join(tmpdir(), 'el-test-data-'))
  const backupDir = mkdtempSync(path.join(tmpdir(), 'el-test-backups-'))

  process.env.DATA_DIR = dataDir
  process.env.BACKUP_DIR = backupDir
  process.env.GEMINI_API_KEY = conGemini ? 'fake-test-key' : ''
  // Los conteos de llamadas de los tests asumen un solo modelo: que el
  // .env de quien corre los tests no sume modelos de respaldo.
  process.env.GEMINI_MODEL_FALLBACK = ''
  process.env.JWT_SECRET = 'secreto-de-prueba-no-usar-en-produccion'
  process.env.JWT_EXPIRES_IN = '1h'
  process.env.JWT_STUDENT_EXPIRES_IN = '1h'
  process.env.NODE_ENV = 'test'
  process.env.ENCRYPTION_KEY = 'b'.repeat(64)
  process.env.DATA_RETENTION_DAYS = '30'
  // Intervalos larguísimos: los jobs quedan activos (igual que en
  // producción) pero no disparan durante la corrida de tests. Node
  // no acepta un delay de más de ~24.8 días (2^31-1 ms) en
  // setInterval, así que 500h es "larguísimo" sin desbordar eso.
  process.env.PURGE_INTERVAL_HOURS = '500'
  process.env.BACKUP_INTERVAL_HOURS = '500'
  process.env.CORS_ORIGINS = 'http://localhost:5173'
  process.env.DATABASE_URL = ''

  const { app, arrancar } = await import('../../src/index.js')
  await arrancar({ escuchar: false })

  return {
    app,
    dataDir,
    backupDir,
    limpiar() {
      rmSync(dataDir, { recursive: true, force: true })
      rmSync(backupDir, { recursive: true, force: true })
    },
  }
}

/** Login con una cuenta semilla (admin/curador/docente); devuelve el token. */
export async function loginComo(app, rol) {
  const cred = CREDENCIALES[rol]
  if (!cred) throw new Error(`Rol de prueba desconocido: ${rol}`)
  const res = await request(app).post('/api/auth/login').send(cred)
  if (res.status !== 200) {
    throw new Error(`Login de prueba falló para ${rol}: HTTP ${res.status} — ${JSON.stringify(res.body)}`)
  }
  return res.body.token
}

/**
 * Crea (como admin) una clase asignada a un docente semilla, con
 * `estudiantes` estudiantes importados. Generar actividades exige una
 * clase del docente: el curso es el nombre de la clase, y la cantidad
 * de variantes sale de cuántos estudiantes tiene.
 * Devuelve { claseId, nombre, codigos } (códigos de matrícula, en orden).
 */
export async function crearClase(app, {
  nombre = 'Clase de prueba', estudiantes = 0, docente = 'docente@englishlessons.edu', bookId = 1,
} = {}) {
  const tokAdm = await loginComo(app, 'admin')
  const auth = { Authorization: `Bearer ${tokAdm}` }
  const docentes = await request(app).get('/api/clases/docentes').set(auth)
  const docenteId = docentes.body.docentes.find((d) => d.email === docente)?.id
  if (!docenteId) throw new Error(`Docente de prueba no encontrado: ${docente}`)
  const clase = await request(app).post('/api/clases').set(auth).send({ nombre, docenteId, bookId })
  if (clase.status !== 201) throw new Error(`No se pudo crear la clase: ${JSON.stringify(clase.body)}`)
  const claseId = clase.body.clase.id

  let codigos = []
  if (estudiantes > 0) {
    const filas = Array.from({ length: estudiantes }, (_, i) => ({ nombre: `${nombre} — Estudiante ${i + 1}` }))
    const imp = await request(app).post(`/api/clases/${claseId}/estudiantes`).set(auth).send({ filas })
    if (imp.status !== 201) throw new Error(`No se pudo importar: ${JSON.stringify(imp.body)}`)
    codigos = imp.body.estudiantes.map((e) => e.codigo_matricula)
  }
  return { claseId, nombre, codigos }
}
