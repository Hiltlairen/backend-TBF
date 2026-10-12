// ============================================================
// index.js — Servidor Express
// ============================================================
import express from 'express'
import helmet from 'helmet'
import cors from 'cors'
import morgan from 'morgan'
import rateLimit from 'express-rate-limit'
import { pathToFileURL } from 'node:url'
import { config, tieneGemini, tieneDB } from './config.js'
import { sembrar, USUARIOS_SEMILLA } from './db/seed.js'
import { iniciarPool, pingDB, hidratar } from './db/pg.js'
import { aplicarContenidoDB, aplicarColeccionesDB } from './db/store.js'
import { noEncontrado, manejadorErrores } from './middleware/errors.js'
import { asignarRequestId } from './middleware/requestId.js'
import { iniciarProgramadorPurga } from './services/purga.js'
import { iniciarProgramadorBackups } from './services/backups.js'
import { logger } from './services/logger.js'
import { enviarAlerta } from './services/alertas.js'

import authRoutes     from './routes/auth.routes.js'
import libraryRoutes  from './routes/library.routes.js'
import activityRoutes from './routes/activities.routes.js'
import reviewRoutes   from './routes/review.routes.js'
import resultsRoutes  from './routes/results.routes.js'
import adminRoutes    from './routes/admin.routes.js'
import classesRoutes  from './routes/classes.routes.js'
import { salas, juego } from './routes/rooms.routes.js'

const app = express()

// Cabeceras de seguridad (punto 5). Este servidor es una API pura
// (JSON + descargas CSV/PDF), nunca sirve HTML propio: el CSP por
// defecto de helmet está pensado para páginas y no aporta acá, así
// que se desactiva explícitamente en vez de dejarlo puesto sin
// sentido. `crossOriginResourcePolicy` se abre a otros orígenes
// porque el frontend (Vite, otro puerto/origen) SÍ necesita poder
// hacer fetch() de las descargas (CSV de roster, PDF de resultados);
// el resto de cabeceras de helmet (nosniff, sin X-Powered-By,
// frameguard, referrer-policy, etc.) quedan con sus valores por
// defecto.
app.use(helmet({
  contentSecurityPolicy: false,
  crossOriginResourcePolicy: { policy: 'cross-origin' },
}))
app.use(cors({ origin: config.origenes, credentials: true }))
app.use(express.json({ limit: '2mb' }))
// Id de correlación (punto 6) — ANTES que morgan, para que quede
// disponible para el resto de la cadena (incluido el log de acceso,
// si más adelante se quiere agregar ahí también).
app.use(asignarRequestId)
if (config.entorno === 'development') app.use(morgan('dev'))

// Freno para los endpoints que gastan tokens
const limiteGeneracion = rateLimit({
  windowMs: 60_000, max: 12,
  message: { error: 'Demasiadas generaciones seguidas. Espera un minuto.' },
})
// Freno para el login (fuerza bruta)
const limiteLogin = rateLimit({ windowMs: 60_000, max: 20 })

app.get('/api/salud', (_req, res) => res.json({
  ok: true, entorno: config.entorno, gemini: tieneGemini(), modelo: config.geminiModel,
}))

app.use('/api/auth', limiteLogin, authRoutes)
app.use('/api/library', libraryRoutes)
app.use('/api/activities', (req, res, next) =>
  req.method === 'POST' && req.path.startsWith('/generar') ? limiteGeneracion(req, res, next) : next(),
  activityRoutes)
app.use('/api/rooms', salas)
app.use('/api/game', juego)
app.use('/api/review', reviewRoutes)
app.use('/api/results', resultsRoutes)
app.use('/api/admin', adminRoutes)
app.use('/api/clases', classesRoutes)

app.use(noEncontrado)
app.use(manejadorErrores)

export { app }

// ── Arranque ───────────────────────────────────────────────
// `escuchar: false` deja la app lista (usuarios sembrados, job de
// purga activo) pero SIN abrir un puerto real — es lo que usan los
// tests automatizados (server/test/), que hablan con `app` en
// memoria vía supertest en vez de por la red.
export async function arrancar({ escuchar = true } = {}) {
  let dbOk = false
  if (tieneDB()) {
    iniciarPool()
    dbOk = await pingDB()
    if (dbOk) {
      // Traer contenido y estado desde Postgres al store en memoria
      const { colecciones, contenido } = await hidratar()
      aplicarContenidoDB(contenido ?? {})
      aplicarColeccionesDB(colecciones ?? {})
    } else {
      console.warn('  [db] DATABASE_URL definida pero sin conexión: se usa el espejo JSON.')
    }
  }

  // Siembra de usuarios demo (solo si no hay ninguno). Con BD conectada,
  // el write-through los sube también a la tabla usuarios.
  const { creados } = sembrar()

  // Job de retención: anonimiza identidades de estudiantes cuya
  // ventana venció (fin de curso / retiro + DATA_RETENTION_DAYS).
  iniciarProgramadorPurga()

  // Job de backups automáticos de los datos (punto 6).
  iniciarProgramadorBackups()

  if (escuchar) {
    app.listen(config.puerto, () => {
      console.log(`\n  API lista en http://localhost:${config.puerto}`)
      console.log(`  Gemini: ${tieneGemini() ? `configurada (${config.geminiModel})` : 'SIN API KEY — revisa el .env'}`)
      console.log(`  Base de datos: ${tieneDB() ? (dbOk ? 'Postgres/Supabase conectado' : 'configurada pero sin conexión (fallback JSON)') : 'JSON local (sin DATABASE_URL)'}`)
      console.log(`  Retención de identidad: ${config.retencionDias} días tras baja/fin de curso`)
      if (creados) {
        console.log(`\n  Se crearon ${creados} usuarios de demo:`)
        for (const u of USUARIOS_SEMILLA) console.log(`    · ${u.rol.padEnd(10)} ${u.email}  ${u.password}`)
      }
      console.log('')
    })
  }

  return { dbOk, creados }
}

// Solo arranca solo si este archivo se ejecuta directamente
// (`node src/index.js`), nunca cuando algo lo importa — así los
// tests automatizados pueden traer `app` sin abrir un puerto real
// ni imprimir el banner de arranque.
const esPrincipal = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href
if (esPrincipal) {
  // Alertas si el servicio cae (punto 6) — a propósito SOLO acá, no
  // en el módulo en general: registrar esto también cuando un test
  // importa la app pisaría el manejo de errores propio del test
  // runner. Node dice que el proceso queda en estado indefinido tras
  // un uncaughtException — se loguea/alerta y se sale con código de
  // error para que quien administre el proceso (systemd, PM2, Docker)
  // lo reinicie; no se intenta "seguir como si nada".
  process.on('unhandledRejection', (razon) => {
    const mensaje = razon instanceof Error ? razon.message : String(razon)
    logger.fatal({ err: mensaje }, 'unhandledRejection — promesa rechazada sin capturar')
    enviarAlerta('unhandled-rejection', 'Promesa rechazada sin capturar', { mensaje }).catch(() => {})
  })
  process.on('uncaughtException', (err) => {
    logger.fatal({ err: err.message, stack: err.stack }, 'uncaughtException — el proceso va a salir')
    enviarAlerta('uncaught-exception', 'Excepción no capturada — el servidor se está reiniciando', { mensaje: err.message })
      .catch(() => {})
      .finally(() => process.exit(1))
  })

  arrancar().catch((e) => {
    logger.fatal({ err: e.message, stack: e.stack }, 'Fallo al arrancar')
    console.error('  Fallo al arrancar:', e.message)
    process.exit(1)
  })
}
