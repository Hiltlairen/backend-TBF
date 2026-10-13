// ============================================================
// config.js — Toda la configuración viene del .env
// ============================================================
import 'dotenv/config'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const raiz = path.resolve(__dirname, '..')

/** Número de una variable de entorno, o null si falta o no es un número válido. */
function numeroOpcional(valor) {
  if (valor == null || String(valor).trim() === '') return null
  const n = Number(valor)
  return Number.isFinite(n) && n >= 0 ? n : null
}

export const config = {
  puerto:      Number(process.env.PORT ?? 4000),
  entorno:     process.env.NODE_ENV ?? 'development',

  // ── Gemini: la key vive SOLO aquí, jamás llega al navegador ──
  geminiApiKey: process.env.GEMINI_API_KEY ?? '',
  // 'gemini-flash-latest' es un ALIAS que Google mantiene apuntando
  // siempre a la versión Flash estable más reciente (hoy sería
  // 3.8-flash; mañana lo que sea que la reemplace). A propósito NO se
  // fija un modelo puntual acá: pinnearlo (como estaba antes, en
  // gemini-2.5-flash) significa que con el tiempo esa versión deja de
  // ser la prioritaria para Google, recibe menos capacidad, y empieza
  // a devolver 503 "saturado" cada vez más seguido — no por una cuota
  // agotada ni un bug acá, sino porque quedó vieja frente a versiones
  // más nuevas (2.0-flash y anteriores ya están dados de baja del todo).
  geminiModel: process.env.GEMINI_MODEL ?? 'gemini-flash-latest',
  // Cuánto esperar por intento antes de abortar y reintentar/rotar de
  // modelo. Sin esto, una llamada "colgada" del lado de Google puede
  // tardar 30-40s en devolver 503, y eso multiplicado por los
  // reintentos deja al docente viendo la pantalla congelada más de un
  // minuto antes de que aparezca cualquier error (ver services/gemini.js).
  geminiTimeoutMs: Number(process.env.GEMINI_TIMEOUT_MS ?? 20000),
  // Modelos a probar EN ORDEN si el principal (geminiModel) agota sus
  // reintentos por saturación (429/503/timeout) — cada modelo de Gemini
  // tiene su propio cupo/capacidad, así que rotar a uno con menos carga
  // es lo único que ayuda cuando la saturación no es momentánea. Vacío
  // por defecto (sin fallback); ej.: "gemini-flash-lite-latest,gemini-3.8-flash"
  // (NO uses gemini-2.0-flash ni anteriores: Google ya los dio de baja
  // — una llamada a un modelo dado de baja también puede colgarse o
  // fallar, así que confirma en https://ai.google.dev/gemini-api/docs/models
  // qué sigue vigente antes de listar algo acá).
  geminiModelFallback: (process.env.GEMINI_MODEL_FALLBACK ?? '')
    .split(',').map((s) => s.trim()).filter(Boolean),
  // Precio en USD por 1 MILLÓN de tokens, para mostrarle al docente
  // cuánto cuesta cada versión que genera. Opcionales a propósito: los
  // precios de Google cambian y dependen del modelo, así que no se
  // inventan acá — sin ellos, la app muestra solo tokens. Cópialos de
  // https://ai.google.dev/gemini-api/docs/pricing para tu GEMINI_MODEL.
  // Ojo: los tokens de "pensamiento" se cobran como salida.
  geminiPrecioEntrada1M: numeroOpcional(process.env.GEMINI_PRECIO_ENTRADA_1M),
  geminiPrecioSalida1M: numeroOpcional(process.env.GEMINI_PRECIO_SALIDA_1M),
  // VARIANTES de una actividad: juegos de preguntas distintos que se
  // reparten al azar entre los estudiantes de la clase al entrar a la
  // sala (para que no se copien). Con IA se generan hasta VARIANTES_IA
  // (cada una cuesta tokens); sin IA, una por estudiante (son gratis).
  variantesIA: Number(process.env.VARIANTES_IA ?? 10),
  // Cuántas variantes se le piden a Gemini a la vez. Más rápido, pero
  // demasiadas en paralelo chocan con el límite por minuto de la API.
  variantesConcurrencia: Number(process.env.VARIANTES_CONCURRENCIA ?? 3),

  // ── Auth ──
  jwtSecret:      process.env.JWT_SECRET ?? 'cambia-esto-en-produccion',
  jwtExpira:      process.env.JWT_EXPIRES_IN ?? '8h',
  jwtExpiraAlumno:process.env.JWT_STUDENT_EXPIRES_IN ?? '3h',

  // ── Despliegue detrás de un proxy (Render, Railway, Fly…) ──
  // El proxy de la plataforma es quien habla con el navegador: sin esto,
  // Express ve la IP del proxy para TODOS y los límites por IP (login,
  // generación) se comparten entre todos los usuarios. 1 = confiar en un
  // salto de proxy. Por defecto, activo solo en producción.
  trustProxy: process.env.TRUST_PROXY != null
    ? (/^\d+$/.test(process.env.TRUST_PROXY) ? Number(process.env.TRUST_PROXY) : process.env.TRUST_PROXY === 'true')
    : (process.env.NODE_ENV === 'production' ? 1 : false),

  // ── Usuarios iniciales ──
  // Las cuentas DEMO (contraseñas conocidas, ver db/seed.js) solo se
  // crean fuera de producción, salvo que se pida con SEED_DEMO=true.
  // En producción, con la base vacía se crea UN admin con estos datos.
  semillaDemo: (process.env.SEED_DEMO ?? (process.env.NODE_ENV === 'production' ? 'false' : 'true')) === 'true',
  adminInicial: {
    email: process.env.ADMIN_EMAIL ?? '',
    password: process.env.ADMIN_PASSWORD ?? '',
    nombre: process.env.ADMIN_NOMBRE ?? 'Administración',
  },

  // ── CORS ──
  origenes: (process.env.CORS_ORIGINS ?? 'http://localhost:5173,http://localhost:4173')
              .split(',').map((s) => s.trim()).filter(Boolean),

  // ── Datos ──
  dataDir: process.env.DATA_DIR || path.join(raiz, 'data'),

  // ── Base de datos (Postgres / Supabase) ──
  // Si DATABASE_URL está definida, el store persiste en Postgres y
  // usa el JSON solo como espejo local. Si NO está, todo el sistema
  // funciona 100% con archivos JSON (modo demo, sin dependencias).
  databaseUrl: process.env.DATABASE_URL ?? '',
  // Supabase exige SSL; en un Postgres local normalmente no.
  dbSsl: (process.env.DB_SSL ?? (process.env.DATABASE_URL?.includes('supabase') ? 'true' : 'false')) === 'true',

  // ── Juego ──
  etapasPorDefecto: Number(process.env.GAME_STAGES ?? 6),

  // ── Observabilidad (punto 6: calidad de ingeniería) ─────────
  // Nivel de los logs estructurados (services/logger.js): trace,
  // debug, info, warn, error, fatal (escala de pino).
  logLevel: process.env.LOG_LEVEL ?? 'info',
  // Webhook para alertas (services/alertas.js) — compatible con el
  // formato de "incoming webhook" de Slack/Discord/Mattermost (un
  // POST con { text }). Sin definir, las alertas solo quedan en el
  // log (con nivel warn/error), nunca se manda nada por red.
  alertWebhookUrl: process.env.ALERT_WEBHOOK_URL ?? '',

  // ── Backups (punto 6: calidad de ingeniería) ────────────────
  // Carpeta donde se guardan las copias con timestamp del espejo
  // JSON (y del dump de Postgres, si hay DATABASE_URL). No es la
  // misma carpeta que dataDir: nunca conviene mezclar el dato vivo
  // con sus respaldos.
  // `||` y no `??`: un BACKUP_DIR= vacío en el .env escribía los backups
  // en la raíz de server/ (y terminaban subidos a GitHub).
  backupDir: process.env.BACKUP_DIR || path.join(raiz, 'backups'),
  // Cada cuántas horas corre el backup automático.
  backupIntervaloHoras: Number(process.env.BACKUP_INTERVAL_HOURS ?? 24),
  // Cuántos backups recientes conservar (se podan los más viejos).
  backupRetener: Number(process.env.BACKUP_RETAIN_COUNT ?? 14),

  // ── Privacidad / retención de datos de estudiantes ──────────
  // Días tras fin de curso o retiro antes de que la identidad del
  // estudiante se anonimice automáticamente. Parámetro, no un valor
  // fijo en código: la ley local todavía no fija un número exacto.
  retencionDias: Number(process.env.DATA_RETENTION_DAYS ?? 30),
  // Cada cuántas horas corre el job de purga automática.
  purgaIntervaloHoras: Number(process.env.PURGE_INTERVAL_HOURS ?? 6),
  // Llave de cifrado en reposo para la tabla de identidad (estudiantes).
  // 64 caracteres hex (32 bytes) recomendado: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
  encryptionKey: process.env.ENCRYPTION_KEY ?? '',

  // ── Correo transaccional (verificación, reset, avisos) ──────
  // 'resend' manda de verdad (necesita RESEND_API_KEY); 'consola'
  // (por defecto) es el modo sandbox de desarrollo: imprime el
  // correo en la terminal en vez de mandarlo, para no necesitar
  // credenciales reales mientras se prueba localmente.
  emailProveedor: process.env.EMAIL_PROVIDER ?? 'consola',
  resendApiKey:   process.env.RESEND_API_KEY ?? '',
  emailDesde:     process.env.EMAIL_FROM ?? 'English Lessons <no-reply@englishlessons.edu>',
  // Base pública del FRONTEND (no del API) — para armar los enlaces
  // que van dentro de los correos (activar cuenta, reset, etc.).
  appUrl: process.env.APP_URL ?? 'http://localhost:5173',
  // Vida de los tokens de un solo uso (verificación, reset, cambio de email).
  tokenTtlMin: Number(process.env.AUTH_TOKEN_TTL_MIN ?? 20),
}

export const tieneGemini = () => Boolean(config.geminiApiKey)
export const tieneDB = () => Boolean(config.databaseUrl)
