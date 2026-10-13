// ============================================================
// generar-sql-instalacion.mjs — Arma src/db/instalacion-completa.sql
// ============================================================
// Un solo archivo para pegar en el SQL Editor de Supabase / Render:
// el esquema (schema.sql) + libros, lecciones y vocabulario de
// content.json con sus mismos ids. Volver a generarlo si cambia
// schema.sql o content.json:  node scripts/generar-sql-instalacion.mjs
// ============================================================
import fs from 'node:fs'

const dir = new URL('../src/db/', import.meta.url)
const esquema = fs.readFileSync(new URL('schema.sql', dir), 'utf8')
const { books, lessons, vocabulary } = JSON.parse(fs.readFileSync(new URL('content.json', dir), 'utf8'))

const txt = (v) => (v == null ? 'null' : `'${String(v).replace(/'/g, "''")}'`)
const filas = (lista, fn) => lista.map((x) => `  (${fn(x).join(', ')})`).join(',\n')

const sql = `-- ============================================================
-- instalacion-completa.sql — Base de datos lista para usar
-- ============================================================
-- GENERADO por scripts/generar-sql-instalacion.mjs (no editar a mano).
-- Pégalo completo en el SQL Editor de Supabase (o psql) y ejecútalo.
-- Se puede correr más de una vez: no duplica nada.
--   1. Crea todas las tablas (schema.sql).
--   2. Carga ${books.length} libros, ${lessons.length} lecciones y ${vocabulary.length} palabras.
-- ============================================================

${esquema}

-- ============================================================
-- CONTENIDO: libros, lecciones y vocabulario (de content.json)
-- ============================================================
begin;

insert into public.books (id, slug, nombre, descripcion, nivel) values
${filas(books, (b) => [b.id, txt(b.slug), txt(b.nombre), txt(b.descripcion), txt(b.nivel ?? 'A2')])}
on conflict (id) do update set slug = excluded.slug, nombre = excluded.nombre,
  descripcion = excluded.descripcion, nivel = excluded.nivel;

insert into public.lessons (id, book_id, numero, titulo, temas, competencia) values
${filas(lessons, (l) => [l.id, l.book_id, l.numero, txt(l.titulo), txt(l.temas), txt(l.competencia)])}
on conflict (id) do update set book_id = excluded.book_id, numero = excluded.numero,
  titulo = excluded.titulo, temas = excluded.temas, competencia = excluded.competencia;

-- vocabulary.id es "generated always as identity": para conservar los
-- ids de la app hay que pedir OVERRIDING SYSTEM VALUE.
insert into public.vocabulary (id, lesson_id, categoria, ingles, espanol) overriding system value values
${filas(vocabulary, (v) => [v.id, v.lesson_id, txt(v.categoria), txt(v.ingles), txt(v.espanol)])}
on conflict (id) do update set lesson_id = excluded.lesson_id, categoria = excluded.categoria,
  ingles = excluded.ingles, espanol = excluded.espanol;

-- Los ids nuevos siguen después del más alto cargado.
select setval(pg_get_serial_sequence('public.vocabulary', 'id'), (select coalesce(max(id), 1) from public.vocabulary));

commit;

-- Comprobación: debería mostrar ${books.length} | ${lessons.length} | ${vocabulary.length}
select (select count(*) from public.books) as libros,
       (select count(*) from public.lessons) as lecciones,
       (select count(*) from public.vocabulary) as palabras;
`
fs.writeFileSync(new URL('instalacion-completa.sql', dir), sql, 'utf8')
console.log(`instalacion-completa.sql: ${(sql.length / 1024).toFixed(0)} KB · ${books.length} libros, ${lessons.length} lecciones, ${vocabulary.length} palabras`)
