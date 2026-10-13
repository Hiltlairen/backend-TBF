// ============================================================
// cargar-contenido.mjs — Sube libros, lecciones y vocabulario a Postgres
// ============================================================
// Uso (una vez, después de correr src/db/schema.sql):
//   DATABASE_URL=postgres://... node scripts/cargar-contenido.mjs
//
// Copia src/db/content.json a las tablas books / lessons / vocabulary
// conservando los mismos ids, porque las clases (clases.book_id) y las
// actividades (lecciones_ids) apuntan a esos ids. Es idempotente: si se
// corre otra vez, actualiza los textos en vez de duplicar filas.
// ============================================================
import 'dotenv/config'
import fs from 'node:fs'
import pg from 'pg'

const url = process.env.DATABASE_URL
if (!url) {
  console.error('Falta DATABASE_URL.')
  process.exit(1)
}
const ssl = (process.env.DB_SSL ?? (url.includes('supabase') ? 'true' : 'false')) === 'true'
const contenido = JSON.parse(fs.readFileSync(new URL('../src/db/content.json', import.meta.url), 'utf8'))

const cliente = new pg.Client({ connectionString: url, ssl: ssl ? { rejectUnauthorized: false } : false })
await cliente.connect()
try {
  await cliente.query('begin')

  for (const b of contenido.books) {
    await cliente.query(
      `insert into books (id, slug, nombre, descripcion, nivel) values ($1,$2,$3,$4,$5)
       on conflict (id) do update set slug=excluded.slug, nombre=excluded.nombre,
         descripcion=excluded.descripcion, nivel=excluded.nivel`,
      [b.id, b.slug, b.nombre, b.descripcion ?? null, b.nivel ?? 'A2'],
    )
  }

  for (const l of contenido.lessons) {
    await cliente.query(
      `insert into lessons (id, book_id, numero, titulo, temas, competencia) values ($1,$2,$3,$4,$5,$6)
       on conflict (id) do update set book_id=excluded.book_id, numero=excluded.numero,
         titulo=excluded.titulo, temas=excluded.temas, competencia=excluded.competencia`,
      [l.id, l.book_id, l.numero, l.titulo, l.temas ?? null, l.competencia ?? null],
    )
  }

  // vocabulary.id es "generated always as identity": para conservar los
  // ids de content.json hay que pedir OVERRIDING SYSTEM VALUE.
  for (const v of contenido.vocabulary) {
    await cliente.query(
      `insert into vocabulary (id, lesson_id, categoria, ingles, espanol) overriding system value
       values ($1,$2,$3,$4,$5)
       on conflict (id) do update set lesson_id=excluded.lesson_id, categoria=excluded.categoria,
         ingles=excluded.ingles, espanol=excluded.espanol`,
      [v.id, v.lesson_id, v.categoria, v.ingles, v.espanol],
    )
  }
  // Que los ids nuevos sigan después del más alto cargado.
  await cliente.query(
    `select setval(pg_get_serial_sequence('vocabulary', 'id'), (select coalesce(max(id), 1) from vocabulary))`,
  )

  await cliente.query('commit')
  console.log(`Contenido cargado: ${contenido.books.length} libros, ${contenido.lessons.length} lecciones, ${contenido.vocabulary.length} palabras.`)
} catch (e) {
  await cliente.query('rollback')
  console.error('No se pudo cargar el contenido:', e.message)
  process.exitCode = 1
} finally {
  await cliente.end()
}
