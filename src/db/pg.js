// ============================================================
// pg.js — Puente a Postgres / Supabase
// ============================================================
// El store principal (store.js) sigue siendo SÍNCRONO y en memoria
// para no reescribir las rutas. Este módulo:
//   1. hidrata()  → carga las tablas de Postgres a la memoria del store
//                   al arrancar (contenido + estado del sistema).
//   2. escribir()  → replica cada mutación del store en Postgres, en
//                   una cola serializada (write-through best-effort).
//
// Si algo falla, se registra en consola pero la app sigue viva con
// su espejo JSON: la clase nunca tumba el servidor por un fallo de red.
// ============================================================
import pg from 'pg'
import { config } from '../config.js'

let pool = null

export function iniciarPool() {
  if (pool || !config.databaseUrl) return pool
  pool = new pg.Pool({
    connectionString: config.databaseUrl,
    ssl: config.dbSsl ? { rejectUnauthorized: false } : false,
    max: 5,
  })
  pool.on('error', (e) => console.error('  [pg] error de pool:', e.message))
  return pool
}

export async function pingDB() {
  if (!pool) return false
  try { await pool.query('select 1'); return true }
  catch (e) { console.error('  [pg] sin conexión:', e.message); return false }
}

// ── Cola serializada de escrituras ─────────────────────────
// Garantiza orden y evita choques; los errores se loguean.
let cola = Promise.resolve()
function encolar(fn) {
  cola = cola.then(fn).catch((e) => console.error('  [pg] escritura falló:', e.message))
  return cola
}

// ============================================================
//  MAPEADORES: colección del store → tabla de Postgres
// ============================================================
// Cada colección declara cómo hidratar (SELECT → doc del store) y
// cómo escribir (doc del store → UPSERT). Las colecciones que no
// figuran aquí simplemente no se persisten en Postgres (viven en JSON).

const nn = (v) => (v === undefined ? null : v)

const MAPEO = {
  usuarios: {
    tabla: 'usuarios',
    hidratar: (row) => ({
      id: row.id, email: row.email, nombre: row.nombre, rol: row.rol,
      password_hash: row.password_hash, avatar: row.avatar, activo: row.activo,
      ultimo_acceso: row.ultimo_acceso, creado_en: row.creado_en,
      aviso_privacidad_version: row.aviso_privacidad_version ?? 0,
      aviso_privacidad_en: row.aviso_privacidad_en ?? null,
      email_verificado: row.email_verificado ?? false,
      email_pendiente: row.email_pendiente ?? null,
      email_pendiente_en: row.email_pendiente_en ?? null,
    }),
    upsert: (d) => ({
      sql: `insert into usuarios (id,email,nombre,rol,password_hash,avatar,activo,ultimo_acceso,aviso_privacidad_version,aviso_privacidad_en,email_verificado,email_pendiente,email_pendiente_en,creado_en)
            values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,coalesce($14,now()))
            on conflict (id) do update set
              email=excluded.email, nombre=excluded.nombre, rol=excluded.rol,
              password_hash=excluded.password_hash, avatar=excluded.avatar,
              activo=excluded.activo, ultimo_acceso=excluded.ultimo_acceso,
              aviso_privacidad_version=excluded.aviso_privacidad_version,
              aviso_privacidad_en=excluded.aviso_privacidad_en,
              email_verificado=excluded.email_verificado,
              email_pendiente=excluded.email_pendiente,
              email_pendiente_en=excluded.email_pendiente_en,
              actualizado_en=now()`,
      val: [d.id, d.email, d.nombre, d.rol, d.password_hash, nn(d.avatar), d.activo ?? true, nn(d.ultimo_acceso),
            d.aviso_privacidad_version ?? 0, nn(d.aviso_privacidad_en),
            d.email_verificado ?? false, nn(d.email_pendiente), nn(d.email_pendiente_en), nn(d.creado_en)],
    }),
  },

  tokens_auth: {
    tabla: 'tokens_auth',
    upsert: (d) => ({
      sql: `insert into tokens_auth (id,usuario_id,tipo,token_hash,email_nuevo,expira_en,usado_en,usado_motivo,creado_en)
            values ($1,$2,$3,$4,$5,$6,$7,$8,coalesce($9,now()))
            on conflict (id) do update set usado_en=excluded.usado_en, usado_motivo=excluded.usado_motivo`,
      val: [d.id, uuidOrNull(d.usuario_id), d.tipo, d.token_hash, nn(d.email_nuevo),
            nn(d.expira_en), nn(d.usado_en), nn(d.usado_motivo), nn(d.creado_en)],
    }),
  },

  actividades: {
    tabla: 'generated_activities',
    // No se hidratan a memoria por defecto (pueden ser muchas); se leen bajo demanda.
    upsert: (d) => ({
      sql: `insert into generated_activities (codigo,lecciones_ids,nivel,curso,cantidad,titulo,contenido,docente_id,created_at)
            values ($1,$2,$3,$4,$5,$6,$7,$8,coalesce($9,now()))`,
      val: [nn(d.codigo), d.lecciones_ids ?? [], d.nivel ?? 'A2', nn(d.curso), nn(d.cantidad),
            nn(d.titulo), JSON.stringify(d.contenido ?? {}), uuidOrNull(d.autor), nn(d.creado_en)],
      // La PK de generated_activities es bigint identity; no forzamos id.
      sinId: true,
    }),
  },

  rutas: {
    tabla: 'rutas',
    upsert: (d) => ({
      sql: `insert into rutas (id,nivel,curso,titulo,lecciones_ids,ruta,contenidos,docente_id,docente_nombre,estado,created_at)
            values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,coalesce($11,now()))
            on conflict (id) do update set estado=excluded.estado`,
      val: [d.id, d.nivel ?? 'A2', nn(d.curso), nn(d.titulo), d.lecciones_ids ?? [],
            JSON.stringify(d.ruta ?? {}), JSON.stringify(d.contenidos ?? {}),
            uuidOrNull(d.autor), nn(d.autor_nombre), d.estado ?? 'aprobada', nn(d.creado_en)],
    }),
  },

  salas: {
    tabla: 'salas',
    upsert: (d) => ({
      sql: `insert into salas (id,codigo,modo,titulo,curso,limite_estudiantes,estudiantes,ruta_id,clase_id,docente_id,docente_nombre,activa,cerrada_por,expira_en,cerrada_en,creado_en)
            values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,coalesce($16,now()))
            on conflict (id) do update set
              estudiantes=excluded.estudiantes, activa=excluded.activa,
              cerrada_por=excluded.cerrada_por, cerrada_en=excluded.cerrada_en`,
      val: [d.id, d.codigo, d.modo, nn(d.titulo), nn(d.curso), d.limite_estudiantes ?? 30,
            d.estudiantes ?? [], uuidOrNull(d.ruta_id), uuidOrNull(d.clase_id), uuidOrNull(d.docente_id), nn(d.docente_nombre),
            d.activa ?? true, nn(d.cerrada_por), nn(d.expira_en), nn(d.cerrada_en), nn(d.creado_en)],
    }),
  },

  partidas: {
    tabla: 'partidas',
    upsert: (d) => ({
      sql: `insert into partidas (id,sala_id,codigo,modo,ruta_id,estudiante,estudiante_id,estado,nodo_actual,historial,puntaje_total,creado_en,terminada_en)
            values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,coalesce($12,now()),$13)
            on conflict (id) do update set
              estado=excluded.estado, nodo_actual=excluded.nodo_actual,
              historial=excluded.historial, puntaje_total=excluded.puntaje_total,
              terminada_en=excluded.terminada_en`,
      val: [d.id, uuidOrNull(d.sala_id), nn(d.codigo), nn(d.modo), uuidOrNull(d.ruta_id),
            d.estudiante, uuidOrNull(d.estudiante_id), d.estado ?? 'en_curso', nn(d.nodoActual), JSON.stringify(d.historial ?? []),
            d.puntajeTotal ?? 0, nn(d.creado_en), nn(d.terminada_en)],
    }),
  },

  resultados: {
    tabla: 'student_results',
    upsert: (d) => ({
      sql: `insert into student_results (partida_id,sala_id,ruta_id,modo,estudiante_nombre,estudiante_id,puntaje,puntaje_maximo,requiere_revision,detalle,fecha)
            values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,coalesce($11,now()))`,
      val: [uuidOrNull(d.partida_id), uuidOrNull(d.sala_id), uuidOrNull(d.ruta_id), nn(d.modo),
            d.estudiante ?? d.estudiante_nombre ?? 'Anónimo', uuidOrNull(d.estudiante_id), d.puntaje ?? 0, d.puntaje_maximo ?? 100,
            d.requiere_revision ?? false, JSON.stringify(d.detalle ?? d.historial ?? null), nn(d.creado_en)],
      sinId: true,
    }),
  },

  clases: {
    tabla: 'clases',
    hidratar: (row) => ({
      id: row.id, nombre: row.nombre, periodo: row.periodo, book_id: row.book_id,
      docente_id: row.docente_id, creado_por: row.creado_por, activa: row.activa,
      finalizada_en: row.finalizada_en ?? null,
      creado_en: row.creado_en,
    }),
    upsert: (d) => ({
      sql: `insert into clases (id,nombre,periodo,book_id,docente_id,creado_por,activa,finalizada_en,creado_en)
            values ($1,$2,$3,$4,$5,$6,$7,$8,coalesce($9,now()))
            on conflict (id) do update set
              finalizada_en=excluded.finalizada_en,
              nombre=excluded.nombre, periodo=excluded.periodo, book_id=excluded.book_id,
              docente_id=excluded.docente_id, activa=excluded.activa`,
      val: [d.id, d.nombre, nn(d.periodo), d.book_id ?? null, uuidOrNull(d.docente_id),
            uuidOrNull(d.creado_por), d.activa ?? true, nn(d.finalizada_en), nn(d.creado_en)],
    }),
  },

  estudiantes: {
    tabla: 'estudiantes',
    hidratar: (row) => ({
      id: row.id, clase_id: row.clase_id, nombre: row.nombre,               // `nombre` viaja cifrado (ver services/crypto.js)
      codigo_matricula: row.codigo_matricula, activo: row.activo, creado_en: row.creado_en,
      codigo_externo: row.codigo_externo ?? null,                           // referencia del instituto; NO es de acceso
      retiro_en: row.retiro_en ?? null,
      purgado_en: row.purgado_en ?? null,
      purgado_motivo: row.purgado_motivo ?? null,
    }),
    upsert: (d) => ({
      sql: `insert into estudiantes (id,clase_id,nombre,codigo_matricula,codigo_externo,activo,retiro_en,purgado_en,purgado_motivo,creado_en)
            values ($1,$2,$3,$4,$5,$6,$7,$8,$9,coalesce($10,now()))
            on conflict (id) do update set
              clase_id=excluded.clase_id, nombre=excluded.nombre,
              codigo_matricula=excluded.codigo_matricula, codigo_externo=excluded.codigo_externo,
              activo=excluded.activo,
              retiro_en=excluded.retiro_en, purgado_en=excluded.purgado_en, purgado_motivo=excluded.purgado_motivo`,
      val: [d.id, uuidOrNull(d.clase_id), d.nombre, d.codigo_matricula, nn(d.codigo_externo), d.activo ?? true,
            nn(d.retiro_en), nn(d.purgado_en), nn(d.purgado_motivo), nn(d.creado_en)],
    }),
  },

  revisiones: {
    tabla: 'revisiones',
    upsert: (d) => ({
      // enviado_por_nombre solo se guarda para salas sueltas sin clase
      // (sin identidad que duplicar); si hay estudiante_id, ese campo
      // queda null a propósito — ver rooms.routes.js.
      sql: `insert into revisiones (id,tipo,referencia_id,estado,enviado_por,enviado_por_nombre,enviado_por_estudiante_id,resumen,payload,decidido_por,nota,creado_en,actualizado_en)
            values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,coalesce($12,now()),$13)
            on conflict (id) do update set
              estado=excluded.estado, decidido_por=excluded.decidido_por,
              nota=excluded.nota, actualizado_en=now()`,
      val: [d.id, d.tipo, nn(String(d.referencia_id ?? '')) || null, d.estado ?? 'pendiente',
            uuidOrNull(d.enviado_por), nn(d.enviado_por_nombre), uuidOrNull(d.enviado_por_estudiante_id), nn(d.resumen),
            d.payload ? JSON.stringify(d.payload) : null, uuidOrNull(d.decidido_por), nn(d.nota),
            nn(d.creado_en), nn(d.actualizado_en)],
    }),
  },

  generaciones: {
    tabla: 'generaciones',
    upsert: (d) => ({
      sql: `insert into generaciones (id,tipo,referencia_id,autor,codigo,nivel,curso,clase_id,llamadas_gemini,tokens_entrada,tokens_salida,desde_cache,modelo,creado_en)
            values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,coalesce($14,now()))`,
      val: [d.id, d.tipo, nn(String(d.referencia_id ?? '')) || null, uuidOrNull(d.autor), nn(d.codigo),
            nn(d.nivel), nn(d.curso), uuidOrNull(d.clase_id), d.llamadas_gemini ?? 0, d.tokens_entrada ?? 0, d.tokens_salida ?? 0,
            d.desde_cache ?? false, nn(d.modelo), nn(d.creado_en)],
    }),
  },
}

// El store usa UUIDs para usuarios; los invitados no. Evita romper el cast a uuid.
function uuidOrNull(v) {
  return typeof v === 'string' && /^[0-9a-f-]{36}$/i.test(v) ? v : null
}

// ── Persistir una mutación (insertar/actualizar) ───────────
export function persistir(coleccion, doc) {
  if (!pool || !MAPEO[coleccion]) return
  const { sql, val } = MAPEO[coleccion].upsert(doc)
  encolar(() => pool.query(sql, val))
}

export function persistirBorrado(coleccion, id) {
  if (!pool || !MAPEO[coleccion]) return
  const tabla = MAPEO[coleccion].tabla
  encolar(() => pool.query(`delete from ${tabla} where id = $1`, [id]))
}

// ── Hidratar el store desde Postgres al arrancar ───────────
// Devuelve un objeto { coleccion: [docs] } con lo que haya en la BD.
export async function hidratar() {
  if (!pool) return {}
  const out = {}

  // Contenido base (books/lessons/vocabulary) → helpers de contenido
  const contenido = {}
  try {
    contenido.books = (await pool.query('select * from books order by id')).rows
    contenido.lessons = (await pool.query('select * from lessons order by numero')).rows
    contenido.vocabulary = (await pool.query('select * from vocabulary order by id')).rows
  } catch (e) {
    console.error('  [pg] no se pudo leer el contenido:', e.message)
  }

  // Colecciones de estado que sí hidratamos a memoria
  for (const [col, m] of Object.entries(MAPEO)) {
    if (!m.hidratar) continue
    try {
      const rows = (await pool.query(`select * from ${m.tabla}`)).rows
      out[col] = rows.map(m.hidratar)
    } catch (e) {
      console.error(`  [pg] no se pudo hidratar ${col}:`, e.message)
    }
  }

  return { colecciones: out, contenido }
}

// ── Leer vocabulario de la BD bajo demanda (diccionario) ───
// Se usa en el flujo de generación: extrae el diccionario fresco
// desde Postgres antes de mandarlo al agente.
export async function vocabularioDeBD(lessonIds = []) {
  if (!pool || !lessonIds.length) return null
  try {
    const { rows } = await pool.query(
      'select id, lesson_id, categoria, ingles, espanol from vocabulary where lesson_id = any($1::bigint[])',
      [lessonIds.map(Number)]
    )
    return rows
  } catch (e) {
    console.error('  [pg] vocabularioDeBD falló:', e.message)
    return null
  }
}

// ── Registrar una sesión de login ──────────────────────────
export function registrarSesion({ usuario_id, email }) {
  if (!pool) return
  encolar(() => pool.query(
    'insert into sesiones (usuario_id, email) values ($1,$2)',
    [uuidOrNull(usuario_id), email ?? null]
  ))
}

export { pool }
