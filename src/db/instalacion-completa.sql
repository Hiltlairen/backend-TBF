-- ============================================================
-- instalacion-completa.sql — Base de datos lista para usar
-- ============================================================
-- GENERADO por scripts/generar-sql-instalacion.mjs (no editar a mano).
-- Pégalo completo en el SQL Editor de Supabase (o psql) y ejecútalo.
-- Se puede correr más de una vez: no duplica nada.
--   1. Crea todas las tablas (schema.sql).
--   2. Carga 2 libros, 10 lecciones y 769 palabras.
-- ============================================================

-- ============================================================
-- schema.sql — Esquema Postgres / Supabase
-- ============================================================
-- Parte de TU esquema original (books, lessons, vocabulary,
-- activity_types, generated_activities, student_results) y lo
-- EXTIENDE con lo que la app necesita y tu esquema no tenía:
--   · usuarios         → inicio de sesión del personal
--   · sesiones         → bitácora de logins
--   · salas            → código de sala + curso + límite de cupo
--   · rutas            → aventuras (grafo) generadas
--   · partidas         → progreso del estudiante en una sala
--   · revisiones       → cola de curaduría
--   · generaciones     → bitácora de consumo de tokens de la IA
-- Además añade columnas nuevas: books.nivel, generated_activities.curso, etc.
--
-- Es idempotente: usa IF NOT EXISTS / ADD COLUMN IF NOT EXISTS.
-- Ejecútalo una vez en el SQL editor de Supabase.
-- ============================================================

-- ── Extensión para UUIDs ──
create extension if not exists "pgcrypto";

-- ============================================================
-- CONTENIDO (tu esquema, con nivel en books)
-- ============================================================
create table if not exists public.books (
  id          bigint primary key,
  slug        text not null unique,
  nombre      text not null,
  descripcion text,
  nivel       text not null default 'A2',   -- NUEVO: 1A→A1, 1B→A2…
  created_at  timestamptz not null default now()
);

create table if not exists public.lessons (
  id          bigint primary key,
  book_id     bigint not null references public.books(id),
  numero      integer not null,
  titulo      text not null,
  temas       text,
  competencia text,
  created_at  timestamptz not null default now()
);

create table if not exists public.vocabulary (
  id          bigint generated always as identity primary key,
  lesson_id   bigint not null references public.lessons(id),
  categoria   text not null,
  ingles      text not null,
  espanol     text not null,
  created_at  timestamptz not null default now()
);
create index if not exists idx_vocabulary_lesson on public.vocabulary(lesson_id);

create table if not exists public.activity_types (
  id                       bigint generated always as identity primary key,
  codigo                   text not null unique,
  titulo                   text not null,
  descripcion              text,
  nivel_por_defecto        text default 'A2',
  requiere_revision_manual boolean not null default false,
  activo                   boolean not null default true,
  created_at               timestamptz not null default now()
);

-- ============================================================
-- USUARIOS Y SESIONES (login del personal)
-- ============================================================
create table if not exists public.usuarios (
  id            uuid primary key default gen_random_uuid(),
  email         text not null unique,
  nombre        text not null,
  rol           text not null check (rol in ('admin','curador','docente')),
  password_hash text not null,
  avatar        text,                       -- data URL de la foto de perfil
  activo        boolean not null default true,
  ultimo_acceso timestamptz,
  creado_en     timestamptz not null default now(),
  actualizado_en timestamptz
);

create table if not exists public.sesiones (
  id         uuid primary key default gen_random_uuid(),
  usuario_id uuid references public.usuarios(id),
  email      text,
  creado_en  timestamptz not null default now()
);

-- ============================================================
-- ACTIVIDADES GENERADAS (tu tabla + curso, cantidad, contenido)
-- ============================================================
create table if not exists public.generated_activities (
  id               bigint generated always as identity primary key,
  book_id          bigint references public.books(id),
  activity_type_id bigint references public.activity_types(id),
  codigo           text,                    -- código de la actividad (redundante, cómodo)
  lecciones_ids    bigint[] not null default '{}',
  nivel            text not null default 'A2',
  curso            text,                    -- NUEVO: curso escrito por el docente
  cantidad         integer,                 -- NUEVO: nº de preguntas usado
  titulo           text,
  contenido        jsonb not null,          -- el contenido COMPLETO generado por la IA
  docente_id       uuid references public.usuarios(id),
  created_at       timestamptz not null default now()
);

-- ── Rutas (aventuras). No estaba en tu esquema. ──
create table if not exists public.rutas (
  id             uuid primary key default gen_random_uuid(),
  nivel          text not null default 'A2',
  curso          text,
  titulo         text,
  lecciones_ids  bigint[] not null default '{}',
  ruta           jsonb not null,            -- el grafo (nodos, umbrales…)
  contenidos     jsonb not null,            -- contenido por actividad
  docente_id     uuid references public.usuarios(id),
  docente_nombre text,
  estado         text not null default 'aprobada',
  created_at     timestamptz not null default now()
);

-- ============================================================
-- CLASES (cohortes de un semestre) Y ESTUDIANTES (usuario temporal
-- por semestre, identificado SOLO por código de matrícula — sin
-- email ni contraseña). Las crea/gestiona admin o curador; el
-- docente solo ve y usa las que se le asignaron.
-- ============================================================
create table if not exists public.clases (
  id           uuid primary key default gen_random_uuid(),
  nombre       text not null,
  periodo      text,
  book_id      bigint references public.books(id),
  docente_id   uuid references public.usuarios(id),
  creado_por   uuid references public.usuarios(id),
  activa       boolean not null default true,
  creado_en    timestamptz not null default now()
);
create index if not exists idx_clases_docente on public.clases(docente_id);

create table if not exists public.estudiantes (
  id                uuid primary key default gen_random_uuid(),
  clase_id          uuid references public.clases(id),
  nombre            text not null,
  codigo_matricula  text not null unique,
  activo            boolean not null default true,
  creado_en         timestamptz not null default now()
);
create index if not exists idx_estudiantes_clase on public.estudiantes(clase_id);
create index if not exists idx_estudiantes_codigo on public.estudiantes(codigo_matricula);

-- ============================================================
-- SALAS (código de sala) — con curso y límite de cupo
-- ============================================================
create table if not exists public.salas (
  id                 uuid primary key default gen_random_uuid(),
  codigo             text not null,
  modo               text not null check (modo in ('simple','juego')),
  titulo             text,
  curso              text,                  -- NUEVO
  limite_estudiantes integer not null default 30,  -- NUEVO: tope de cupo (configurable hasta 30)
  estudiantes        text[] not null default '{}', -- nombres que ya entraron
  actividad_id       bigint references public.generated_activities(id),
  ruta_id            uuid references public.rutas(id),
  clase_id           uuid references public.clases(id), -- NUEVO: si la sala usa códigos de matrícula
  docente_id         uuid references public.usuarios(id),
  docente_nombre     text,
  activa             boolean not null default true,
  cerrada_por        text,                  -- 'cupo' | 'manual' | null
  expira_en          timestamptz,
  cerrada_en         timestamptz,
  creado_en          timestamptz not null default now()
);
create index if not exists idx_salas_codigo_activa on public.salas(codigo) where activa;
alter table public.salas add column if not exists clase_id uuid references public.clases(id);
alter table public.salas alter column limite_estudiantes set default 30;

-- ============================================================
-- PARTIDAS (progreso del estudiante)
-- ============================================================
create table if not exists public.partidas (
  id            uuid primary key default gen_random_uuid(),
  sala_id       uuid references public.salas(id),
  codigo        text,
  modo          text,
  ruta_id       uuid references public.rutas(id),
  estudiante    text not null,
  estudiante_id uuid references public.estudiantes(id), -- NUEVO: cuando la sala usa código de matrícula
  estado        text not null default 'en_curso',
  nodo_actual   text,
  historial     jsonb not null default '[]',
  puntaje_total numeric not null default 0,
  creado_en     timestamptz not null default now(),
  terminada_en  timestamptz
);
alter table public.partidas add column if not exists estudiante_id uuid references public.estudiantes(id);

-- ============================================================
-- RESULTADOS (tu tabla, con vínculo flexible)
-- ============================================================
create table if not exists public.student_results (
  id                    bigint generated always as identity primary key,
  generated_activity_id bigint references public.generated_activities(id),
  partida_id            uuid references public.partidas(id),
  sala_id               uuid references public.salas(id),
  ruta_id               uuid references public.rutas(id),
  modo                  text,
  estudiante_nombre     text not null,
  estudiante_id         uuid references public.estudiantes(id), -- ya existía, ahora se puebla
  puntaje               numeric not null,
  puntaje_maximo        numeric not null default 100,
  requiere_revision     boolean not null default false,
  detalle               jsonb,
  fecha                 timestamptz not null default now()
);

-- ============================================================
-- CURADURÍA
-- ============================================================
create table if not exists public.revisiones (
  id                 uuid primary key default gen_random_uuid(),
  tipo               text not null,          -- 'actividad' | 'vocabulario' | 'entrega'
  referencia_id      text,
  estado             text not null default 'pendiente',
  enviado_por        uuid,
  enviado_por_nombre text,
  resumen            text,
  payload            jsonb,
  decidido_por       uuid,
  nota               text,
  creado_en          timestamptz not null default now(),
  actualizado_en     timestamptz
);

-- ============================================================
-- BITÁCORA DE GENERACIONES (consumo de tokens de la IA)
-- ============================================================
create table if not exists public.generaciones (
  id              uuid primary key default gen_random_uuid(),
  tipo            text not null,             -- 'actividad' | 'ruta'
  referencia_id   text,
  autor           uuid,
  codigo          text,
  nivel           text,
  curso           text,
  clase_id        uuid references public.clases(id), -- NUEVO: para reportes por clase
  llamadas_gemini integer not null default 0,
  tokens_entrada  integer not null default 0,
  tokens_salida   integer not null default 0,
  desde_cache     boolean not null default false,
  modelo          text,
  creado_en       timestamptz not null default now()
);
alter table public.generaciones add column if not exists clase_id uuid references public.clases(id);

-- ============================================================
-- VOCABULARIO AÑADIDO POR DOCENTES (fuera de la carga base)
-- Se guarda en 'vocabulary' igual; esta tabla es opcional para
-- distinguir el origen. La app usa 'vocabulary' directamente.
-- ============================================================

-- ============================================================
-- ALINEACIÓN CON EL CÓDIGO ACTUAL (db/pg.js → MAPEO)
-- ------------------------------------------------------------
-- Columnas y tablas que el código escribe y que el esquema original
-- no tenía, y restricciones que el código contradice a propósito
-- (cuenta invitada sin contraseña, estudiante purgado sin nombre,
-- partida de un estudiante de clase sin nombre libre). Sin esto,
-- cada escritura fallaba y Postgres quedaba vacío. Idempotente: se
-- puede correr sobre una base que ya tenga el esquema anterior.
-- ============================================================

-- Usuarios: activación por correo, cambio de email y aviso de privacidad
alter table public.usuarios alter column password_hash drop not null;     -- la cuenta nace sin contraseña (invitación)
alter table public.usuarios add column if not exists email_verificado         boolean not null default false;
alter table public.usuarios add column if not exists email_pendiente          text;
alter table public.usuarios add column if not exists email_pendiente_en       timestamptz;
alter table public.usuarios add column if not exists aviso_privacidad_version integer not null default 0;
alter table public.usuarios add column if not exists aviso_privacidad_en      timestamptz;

-- Tokens de un solo uso (verificar cuenta, restablecer contraseña, cambiar email)
create table if not exists public.tokens_auth (
  id           uuid primary key default gen_random_uuid(),
  usuario_id   uuid references public.usuarios(id) on delete cascade,
  tipo         text not null,               -- 'verificacion_cuenta' | 'reset_password' | 'cambio_email'
  token_hash   text not null,               -- sha256: el token en claro nunca se guarda
  email_nuevo  text,
  expira_en    timestamptz,
  usado_en     timestamptz,
  usado_motivo text,
  creado_en    timestamptz not null default now()
);
create index if not exists idx_tokens_auth_hash on public.tokens_auth(token_hash);

-- Clases: fin de curso (arranca la ventana de retención)
alter table public.clases add column if not exists finalizada_en timestamptz;

-- Estudiantes: código del instituto, baja y purga (la purga borra nombre y código)
alter table public.estudiantes add column if not exists codigo_externo text;
alter table public.estudiantes add column if not exists retiro_en      timestamptz;
alter table public.estudiantes add column if not exists purgado_en     timestamptz;
alter table public.estudiantes add column if not exists purgado_motivo text;
alter table public.estudiantes alter column nombre drop not null;
alter table public.estudiantes alter column codigo_matricula drop not null;

-- Partidas: con clase, el nombre vive en `estudiantes` (solo va estudiante_id)
alter table public.partidas alter column estudiante drop not null;

-- Revisiones: entregas de estudiantes con identidad (sin duplicar su nombre)
alter table public.revisiones add column if not exists enviado_por_estudiante_id uuid references public.estudiantes(id);

-- ============================================================
-- REGISTRO COMPLETO (doc jsonb) — que un reinicio no pierda nada
-- ------------------------------------------------------------
-- Cada tabla guarda, además de sus columnas, el registro COMPLETO tal
-- cual lo usa la app (variantes, grafo, historial, notas…). Al
-- arrancar, el servidor se reconstruye desde `doc` (db/pg.js →
-- hidratar). Sin esto, actividades, salas y resultados se escribían
-- pero no se podían volver a leer: en Render (disco efímero, el
-- servicio se duerme tras 15 min) se perdían en cada reinicio.
-- ============================================================
alter table public.usuarios             add column if not exists doc jsonb;
alter table public.tokens_auth          add column if not exists doc jsonb;
alter table public.clases               add column if not exists doc jsonb;
alter table public.estudiantes          add column if not exists doc jsonb;
alter table public.rutas                add column if not exists doc jsonb;
alter table public.salas                add column if not exists doc jsonb;
alter table public.partidas             add column if not exists doc jsonb;
alter table public.revisiones           add column if not exists doc jsonb;
alter table public.generaciones         add column if not exists doc jsonb;
alter table public.generated_activities add column if not exists doc jsonb;
alter table public.student_results      add column if not exists doc jsonb;

-- Estas dos tienen PK numérica: el id de la app (uuid) va en `uid` y
-- es por donde se actualizan (antes cada cambio insertaba otra fila).
alter table public.generated_activities add column if not exists uid uuid;
alter table public.student_results      add column if not exists uid uuid;
create unique index if not exists ux_generated_activities_uid on public.generated_activities(uid);
create unique index if not exists ux_student_results_uid      on public.student_results(uid);

-- Bitácora del sistema y vocabulario agregado por docentes (tipo 'vocab').
create table if not exists public.auditoria (
  id        uuid primary key,
  tipo      text,
  doc       jsonb not null,
  creado_en timestamptz not null default now()
);
create index if not exists idx_auditoria_tipo on public.auditoria(tipo);


-- ============================================================
-- CONTENIDO: libros, lecciones y vocabulario (de content.json)
-- ============================================================
begin;

insert into public.books (id, slug, nombre, descripcion, nivel) values
  (1, 'in-english-1a', 'In English 1A', 'Lecciones 1 a 5: bienvenida, familia, horario, casa y rutina diaria.', 'A1'),
  (2, 'in-english-1b', 'In English 1B', 'Lecciones 6 a 10: habilidades, vida diaria, pasado y futuro.', 'A2')
on conflict (id) do update set slug = excluded.slug, nombre = excluded.nombre,
  descripcion = excluded.descripcion, nivel = excluded.nivel;

insert into public.lessons (id, book_id, numero, titulo, temas, competencia) values
  (1, 1, 1, 'Welcome to Benjamin Franklin Institute', 'Saludos y despedidas; vocabulario para empezar (frases de aula); útiles escolares; el abecedario; signos zodiacales; adjetivos de personalidad; países y nacionalidades.', 'El estudiante podrá presentarse, dar información personal básica y describir su personalidad usando adjetivos sencillos.'),
  (2, 1, 2, 'My family and friends', 'Miembros de la familia; animales; colores; ropa y prendas de vestir.', 'El estudiante podrá hablar de su familia, describir mascotas/animales y describir colores y prendas de ropa favoritas.'),
  (3, 1, 3, 'My schedule, time and more', 'Números cardinales y ordinales (1-31); días de la semana y meses; la hora; el clima.', 'El estudiante podrá contar, decir y preguntar la hora, y describir el clima y la ropa adecuada según el lugar.'),
  (4, 1, 4, 'My house and my favorite places', 'Partes de la casa; adjetivos para describir lugares; muebles; HAY (There is/There are); ocupaciones; pronombres personales; el verbo TO BE; adjetivos posesivos.', 'El estudiante podrá describir su casa, su cuarto favorito y otros lugares; hablará de ocupaciones y usará correctamente el verbo TO BE y los posesivos.'),
  (5, 1, 5, 'My everyday activities', 'Acciones del salón de clase; actividades en casa; actividades cotidianas; rutina diaria.', 'El estudiante podrá describir su rutina y actividades típicas de un día, comunicándose con cualquier hablante extranjero sobre temas cotidianos.'),
  (6, 2, 6, 'Let''s talk about your abilities', 'Partes del cuerpo humano; habilidades comunes; el modal CAN (habilidad); demostrativos (this/that/these/those).', 'El estudiante podrá hablar de sus habilidades y las de otras personas, y usará correctamente los demostrativos.'),
  (7, 2, 7, 'My life and leisure activities', 'Lugares en la ciudad; preposiciones de lugar; verbos de acción; presente simple; lectura ''I love Alasita''.', 'El estudiante podrá hablar de sus actividades y hábitos diarios, incluyendo la tercera persona, sin problemas en presente simple.'),
  (8, 2, 8, 'Ask and answer about your life', 'Verbos de acción; el modal DO/DOES; preguntas con Wh- (what, where, when, who, which, why, how).', 'El estudiante podrá formar negativos y preguntas, y usará las palabras Wh- para preguntar sobre cualquier tema.'),
  (9, 2, 9, 'When I was young', 'El verbo BE en pasado (was/were); verbos regulares en pasado; verbos irregulares; el modal DID (negativos y preguntas en pasado).', 'El estudiante podrá hablar de eventos pasados de su vida y preguntar/responder sobre cosas que sucedieron en el pasado.'),
  (10, 2, 10, 'Let''s talk about the future', 'Comida y bebidas; el modal WILL (futuro); BE GOING TO (planes futuros); repaso general de gramática.', 'El estudiante podrá hablar del futuro sin problemas y diferenciará entre una posibilidad (WILL) y un plan futuro (BE GOING TO).')
on conflict (id) do update set book_id = excluded.book_id, numero = excluded.numero,
  titulo = excluded.titulo, temas = excluded.temas, competencia = excluded.competencia;

-- vocabulary.id es "generated always as identity": para conservar los
-- ids de la app hay que pedir OVERRIDING SYSTEM VALUE.
insert into public.vocabulary (id, lesson_id, categoria, ingles, espanol) overriding system value values
  (1, 1, 'Útiles escolares (School stuff)', 'Book', 'Libro'),
  (2, 1, 'Útiles escolares (School stuff)', 'Notebook', 'Cuaderno'),
  (3, 1, 'Útiles escolares (School stuff)', 'Pen', 'Lapicero / Bolígrafo'),
  (4, 1, 'Útiles escolares (School stuff)', 'Pencil', 'Lápiz'),
  (5, 1, 'Útiles escolares (School stuff)', 'Marker', 'Marcador'),
  (6, 1, 'Útiles escolares (School stuff)', 'Dictionary', 'Diccionario'),
  (7, 1, 'Útiles escolares (School stuff)', 'Desk', 'Escritorio / Pupitre'),
  (8, 1, 'Útiles escolares (School stuff)', 'Whiteboard', 'Pizarra blanca'),
  (9, 1, 'Útiles escolares (School stuff)', 'Eraser', 'Borrador'),
  (10, 1, 'Útiles escolares (School stuff)', 'Sharpener', 'Sacapuntas'),
  (11, 1, 'Útiles escolares (School stuff)', 'Ruler', 'Regla'),
  (12, 1, 'Útiles escolares (School stuff)', 'Calculator', 'Calculadora'),
  (13, 1, 'Útiles escolares (School stuff)', 'Table', 'Mesa'),
  (14, 1, 'Útiles escolares (School stuff)', 'Chair', 'Silla'),
  (15, 1, 'Útiles escolares (School stuff)', 'Hole Punch', 'Perforadora'),
  (16, 1, 'Útiles escolares (School stuff)', 'Computer', 'Computadora'),
  (17, 1, 'Útiles escolares (School stuff)', 'Wastebasket', 'Papelera / Basurero'),
  (18, 1, 'Útiles escolares (School stuff)', 'Bookshelf', 'Repisa / Librero'),
  (19, 1, 'Útiles escolares (School stuff)', 'Teacher', 'Profesor/a'),
  (20, 1, 'Útiles escolares (School stuff)', 'Student', 'Estudiante'),
  (21, 1, 'Útiles escolares (School stuff)', 'Backpack', 'Mochila'),
  (22, 1, 'Útiles escolares (School stuff)', 'Highlighter', 'Resaltador'),
  (23, 1, 'Útiles escolares (School stuff)', 'Paper', 'Papel'),
  (24, 1, 'Útiles escolares (School stuff)', 'Stapler', 'Engrapadora'),
  (25, 1, 'Útiles escolares (School stuff)', 'Paper clip', 'Clip / Sujetapapeles'),
  (26, 1, 'Signos zodiacales (Zodiac signs)', 'Aries', 'Aries'),
  (27, 1, 'Signos zodiacales (Zodiac signs)', 'Taurus', 'Tauro'),
  (28, 1, 'Signos zodiacales (Zodiac signs)', 'Gemini', 'Géminis'),
  (29, 1, 'Signos zodiacales (Zodiac signs)', 'Cancer', 'Cáncer'),
  (30, 1, 'Signos zodiacales (Zodiac signs)', 'Leo', 'Leo'),
  (31, 1, 'Signos zodiacales (Zodiac signs)', 'Virgo', 'Virgo'),
  (32, 1, 'Signos zodiacales (Zodiac signs)', 'Libra', 'Libra'),
  (33, 1, 'Signos zodiacales (Zodiac signs)', 'Scorpio', 'Escorpio'),
  (34, 1, 'Signos zodiacales (Zodiac signs)', 'Sagittarius', 'Sagitario'),
  (35, 1, 'Signos zodiacales (Zodiac signs)', 'Capricorn', 'Capricornio'),
  (36, 1, 'Signos zodiacales (Zodiac signs)', 'Aquarius', 'Acuario'),
  (37, 1, 'Signos zodiacales (Zodiac signs)', 'Pisces', 'Piscis'),
  (38, 1, 'Adjetivos de personalidad', 'Friendly', 'Amigable'),
  (39, 1, 'Adjetivos de personalidad', 'Serious', 'Serio/a'),
  (40, 1, 'Adjetivos de personalidad', 'Grumpy', 'Gruñón/a'),
  (41, 1, 'Adjetivos de personalidad', 'Intelligent', 'Inteligente'),
  (42, 1, 'Adjetivos de personalidad', 'Creative', 'Creativo/a'),
  (43, 1, 'Adjetivos de personalidad', 'Jealous', 'Celoso/a'),
  (44, 1, 'Adjetivos de personalidad', 'Quiet', 'Callado/a, tranquilo/a'),
  (45, 1, 'Adjetivos de personalidad', 'Cooperative', 'Cooperativo/a'),
  (46, 1, 'Adjetivos de personalidad', 'Funny', 'Divertido/a'),
  (47, 1, 'Adjetivos de personalidad', 'Beautiful', 'Hermoso/a'),
  (48, 1, 'Adjetivos de personalidad', 'Stubborn', 'Terco/a'),
  (49, 1, 'Adjetivos de personalidad', 'Sensitive', 'Sensible'),
  (50, 1, 'Adjetivos de personalidad', 'Romantic', 'Romántico/a'),
  (51, 1, 'Adjetivos de personalidad', 'Energetic', 'Enérgico/a'),
  (52, 1, 'Adjetivos de personalidad', 'Angry', 'Enojado/a'),
  (53, 1, 'Adjetivos de personalidad', 'Self-confident', 'Seguro/a de sí mismo/a'),
  (54, 1, 'Adjetivos de personalidad', 'Efficient', 'Eficiente'),
  (55, 1, 'Adjetivos de personalidad', 'Careful', 'Cuidadoso/a'),
  (56, 1, 'Adjetivos de personalidad', 'Crazy', 'Loco/a'),
  (57, 1, 'Adjetivos de personalidad', 'Toxic', 'Tóxico/a'),
  (58, 1, 'Adjetivos de personalidad', 'Naughty', 'Travieso/a'),
  (59, 1, 'Adjetivos de personalidad', 'Silly', 'Tonto/a'),
  (60, 1, 'Adjetivos de personalidad', 'Wacky', 'Chiflado/a, excéntrico/a'),
  (61, 1, 'Adjetivos de personalidad', 'Tender', 'Tierno/a'),
  (62, 1, 'Adjetivos de personalidad', 'Happy', 'Feliz'),
  (63, 1, 'Países y nacionalidades', 'Australia / Australian', 'Australia / Australiano-a'),
  (64, 1, 'Países y nacionalidades', 'Brazil / Brazilian', 'Brasil / Brasileño-a'),
  (65, 1, 'Países y nacionalidades', 'Canada / Canadian', 'Canadá / Canadiense'),
  (66, 1, 'Países y nacionalidades', 'China / Chinese', 'China / Chino-a'),
  (67, 1, 'Países y nacionalidades', 'England / English', 'Inglaterra / Inglés-a'),
  (68, 1, 'Países y nacionalidades', 'France / French', 'Francia / Francés-a'),
  (69, 1, 'Países y nacionalidades', 'Germany / German', 'Alemania / Alemán-a'),
  (70, 1, 'Países y nacionalidades', 'Greece / Greek', 'Grecia / Griego-a'),
  (71, 1, 'Países y nacionalidades', 'Italy / Italian', 'Italia / Italiano-a'),
  (72, 1, 'Países y nacionalidades', 'Japan / Japanese', 'Japón / Japonés-a'),
  (73, 1, 'Países y nacionalidades', 'Korea / Korean', 'Corea / Coreano-a'),
  (74, 1, 'Países y nacionalidades', 'Mexico / Mexican', 'México / Mexicano-a'),
  (75, 1, 'Países y nacionalidades', 'Peru / Peruvian', 'Perú / Peruano-a'),
  (76, 1, 'Países y nacionalidades', 'Portugal / Portuguese', 'Portugal / Portugués-a'),
  (77, 1, 'Países y nacionalidades', 'Russia / Russian', 'Rusia / Ruso-a'),
  (78, 1, 'Países y nacionalidades', 'Spain / Spanish', 'España / Español-a'),
  (79, 1, 'Países y nacionalidades', 'The United States / American', 'Estados Unidos / Estadounidense'),
  (80, 1, 'Países y nacionalidades', 'Vietnam / Vietnamese', 'Vietnam / Vietnamita'),
  (81, 1, 'Frases para empezar', 'How do you say ___ in English?', '¿Cómo se dice ___ en inglés?'),
  (82, 1, 'Frases para empezar', 'What does ___ mean? / What´s ___?', '¿Qué significa ___?'),
  (83, 1, 'Frases para empezar', 'I´m sorry, I am late!', 'Lo siento, ¡llegué tarde!'),
  (84, 1, 'Frases para empezar', 'I finished. / I''m done.', 'Ya terminé.'),
  (85, 1, 'Frases para empezar', 'Excuse me. May I come in?', 'Disculpe, ¿puedo pasar?'),
  (86, 1, 'Frases para empezar', 'May I go to the restroom, please?', '¿Puedo ir al baño, por favor?'),
  (87, 1, 'Frases para empezar', 'Can you repeat, please?', '¿Puede repetir, por favor?'),
  (88, 1, 'Frases para empezar', 'Sorry, I don´t understand.', 'Disculpe, no entiendo.'),
  (89, 1, 'Frases para empezar', 'This is ___.', 'Te presento a ___.'),
  (90, 2, 'Miembros de la familia', 'Grandfather', 'Abuelo'),
  (91, 2, 'Miembros de la familia', 'Grandmother', 'Abuela'),
  (92, 2, 'Miembros de la familia', 'Father', 'Padre'),
  (93, 2, 'Miembros de la familia', 'Mother', 'Madre'),
  (94, 2, 'Miembros de la familia', 'Husband', 'Esposo'),
  (95, 2, 'Miembros de la familia', 'Wife', 'Esposa'),
  (96, 2, 'Miembros de la familia', 'Brother', 'Hermano'),
  (97, 2, 'Miembros de la familia', 'Sister', 'Hermana'),
  (98, 2, 'Miembros de la familia', 'Son', 'Hijo'),
  (99, 2, 'Miembros de la familia', 'Daughter', 'Hija'),
  (100, 2, 'Miembros de la familia', 'Grandson', 'Nieto'),
  (101, 2, 'Miembros de la familia', 'Granddaughter', 'Nieta'),
  (102, 2, 'Miembros de la familia', 'Uncle', 'Tío'),
  (103, 2, 'Miembros de la familia', 'Aunt', 'Tía'),
  (104, 2, 'Miembros de la familia', 'Cousin', 'Primo/a'),
  (105, 2, 'Miembros de la familia', 'Nephew', 'Sobrino'),
  (106, 2, 'Miembros de la familia', 'Niece', 'Sobrina'),
  (107, 2, 'Miembros de la familia', 'Stepfather', 'Padrastro'),
  (108, 2, 'Miembros de la familia', 'Stepmother', 'Madrastra'),
  (109, 2, 'Miembros de la familia', 'Step brother', 'Hermanastro'),
  (110, 2, 'Miembros de la familia', 'Step sister', 'Hermanastra'),
  (111, 2, 'Miembros de la familia', 'Father-in-law', 'Suegro'),
  (112, 2, 'Miembros de la familia', 'Mother-in-law', 'Suegra'),
  (113, 2, 'Miembros de la familia', 'Brother-in-law', 'Cuñado'),
  (114, 2, 'Miembros de la familia', 'Sister-in-law', 'Cuñada'),
  (115, 2, 'Miembros de la familia', 'Twins', 'Gemelos/Mellizos'),
  (116, 2, 'Miembros de la familia', 'Acquaintance', 'Conocido/a'),
  (117, 2, 'Miembros de la familia', 'Half-brother', 'Medio hermano'),
  (118, 2, 'Miembros de la familia', 'Half-sister', 'Media hermana'),
  (119, 2, 'Miembros de la familia', 'What''s-his-name', 'Cómo se llame (él)'),
  (120, 2, 'Miembros de la familia', 'What''s-her-name', 'Cómo se llame (ella)'),
  (121, 2, 'Animales', 'Dog', 'Perro'),
  (122, 2, 'Animales', 'Cat', 'Gato'),
  (123, 2, 'Animales', 'Mouse', 'Ratón'),
  (124, 2, 'Animales', 'Horse', 'Caballo'),
  (125, 2, 'Animales', 'Monkey', 'Mono'),
  (126, 2, 'Animales', 'Parrot', 'Loro'),
  (127, 2, 'Animales', 'Lion', 'León'),
  (128, 2, 'Animales', 'Tiger', 'Tigre'),
  (129, 2, 'Animales', 'Elephant', 'Elefante'),
  (130, 2, 'Animales', 'Rooster', 'Gallo'),
  (131, 2, 'Animales', 'Hen', 'Gallina'),
  (132, 2, 'Animales', 'Sheep', 'Oveja'),
  (133, 2, 'Animales', 'Camel', 'Camello'),
  (134, 2, 'Animales', 'Zebra', 'Cebra'),
  (135, 2, 'Animales', 'Kangaroo', 'Canguro'),
  (136, 2, 'Animales', 'Cow', 'Vaca'),
  (137, 2, 'Animales', 'Fox', 'Zorro'),
  (138, 2, 'Animales', 'Wolf', 'Lobo'),
  (139, 2, 'Animales', 'Turtle', 'Tortuga'),
  (140, 2, 'Animales', 'Duck', 'Pato'),
  (141, 2, 'Animales', 'Fish', 'Pez'),
  (142, 2, 'Animales', 'Shark', 'Tiburón'),
  (143, 2, 'Animales', 'Whale', 'Ballena'),
  (144, 2, 'Animales', 'Dolphin', 'Delfín'),
  (145, 2, 'Animales', 'Octopus', 'Pulpo'),
  (146, 2, 'Animales', 'Crocodile', 'Cocodrilo'),
  (147, 2, 'Animales', 'Frog', 'Rana'),
  (148, 2, 'Animales', 'Snake', 'Serpiente'),
  (149, 2, 'Animales', 'Iguana', 'Iguana'),
  (150, 2, 'Animales', 'Lizard', 'Lagartija'),
  (151, 2, 'Colores', 'Blue', 'Azul'),
  (152, 2, 'Colores', 'Yellow', 'Amarillo'),
  (153, 2, 'Colores', 'Red', 'Rojo'),
  (154, 2, 'Colores', 'Black', 'Negro'),
  (155, 2, 'Colores', 'Pink', 'Rosado'),
  (156, 2, 'Colores', 'Orange', 'Naranja'),
  (157, 2, 'Colores', 'Brown', 'Marrón / Café'),
  (158, 2, 'Colores', 'Beige', 'Beige'),
  (159, 2, 'Colores', 'Navy blue', 'Azul marino'),
  (160, 2, 'Colores', 'Green', 'Verde'),
  (161, 2, 'Colores', 'Purple', 'Morado'),
  (162, 2, 'Colores', 'Turquoise', 'Turquesa'),
  (163, 2, 'Colores', 'White', 'Blanco'),
  (164, 2, 'Colores', 'Gray', 'Gris'),
  (165, 2, 'Ropa (Clothing)', 'Sweater', 'Suéter / Chompa'),
  (166, 2, 'Ropa (Clothing)', 'Blouse', 'Blusa'),
  (167, 2, 'Ropa (Clothing)', 'T-shirt', 'Camiseta'),
  (168, 2, 'Ropa (Clothing)', 'Shirt', 'Camisa'),
  (169, 2, 'Ropa (Clothing)', 'Tank top', 'Camiseta sin mangas'),
  (170, 2, 'Ropa (Clothing)', 'Jersey', 'Jersey'),
  (171, 2, 'Ropa (Clothing)', 'Jacket', 'Chaqueta'),
  (172, 2, 'Ropa (Clothing)', 'Overcoat', 'Sobretodo / Abrigo'),
  (173, 2, 'Ropa (Clothing)', 'Rain jacket', 'Impermeable'),
  (174, 2, 'Ropa (Clothing)', 'Scarf', 'Bufanda'),
  (175, 2, 'Ropa (Clothing)', 'Pants', 'Pantalones'),
  (176, 2, 'Ropa (Clothing)', 'Jeans', 'Jeans'),
  (177, 2, 'Ropa (Clothing)', 'Leggings', 'Mallas / Leggins'),
  (178, 2, 'Ropa (Clothing)', 'Overalls', 'Overol'),
  (179, 2, 'Ropa (Clothing)', 'Skirt', 'Falda'),
  (180, 2, 'Ropa (Clothing)', 'Jumper', 'Vestido de tirantes / Jumper'),
  (181, 2, 'Ropa (Clothing)', 'Dress', 'Vestido'),
  (182, 2, 'Ropa (Clothing)', 'Shorts', 'Pantalón corto'),
  (183, 2, 'Ropa (Clothing)', 'Suit', 'Traje'),
  (184, 2, 'Ropa (Clothing)', 'Socks', 'Calcetines'),
  (185, 2, 'Ropa (Clothing)', 'Shoes', 'Zapatos'),
  (186, 2, 'Ropa (Clothing)', 'Flip-flops', 'Sandalias de dedo / Chinelas'),
  (187, 2, 'Ropa (Clothing)', 'Boots', 'Botas'),
  (188, 2, 'Ropa (Clothing)', 'Sandals', 'Sandalias'),
  (189, 2, 'Ropa (Clothing)', 'Gloves', 'Guantes'),
  (190, 2, 'Ropa (Clothing)', 'Belt', 'Cinturón'),
  (191, 2, 'Ropa (Clothing)', 'Glasses', 'Lentes'),
  (192, 2, 'Ropa (Clothing)', 'Sneakers', 'Zapatillas deportivas'),
  (193, 2, 'Ropa (Clothing)', 'Baseball cap', 'Gorra'),
  (194, 2, 'Ropa (Clothing)', 'Hat', 'Sombrero'),
  (195, 3, 'Números ordinales', 'First (1st)', 'Primero'),
  (196, 3, 'Números ordinales', 'Second (2nd)', 'Segundo'),
  (197, 3, 'Números ordinales', 'Third (3rd)', 'Tercero'),
  (198, 3, 'Números ordinales', 'Fourth (4th)', 'Cuarto'),
  (199, 3, 'Números ordinales', 'Fifth (5th)', 'Quinto'),
  (200, 3, 'Números ordinales', 'Sixth (6th)', 'Sexto'),
  (201, 3, 'Números ordinales', 'Seventh (7th)', 'Séptimo'),
  (202, 3, 'Números ordinales', 'Eighth (8th)', 'Octavo'),
  (203, 3, 'Números ordinales', 'Ninth (9th)', 'Noveno'),
  (204, 3, 'Números ordinales', 'Tenth (10th)', 'Décimo'),
  (205, 3, 'Números ordinales', 'Twentieth (20th)', 'Vigésimo'),
  (206, 3, 'Números ordinales', 'Thirtieth (30th)', 'Trigésimo'),
  (207, 3, 'El clima (Weather)', 'Sunny', 'Soleado'),
  (208, 3, 'El clima (Weather)', 'Warm', 'Templado / Cálido'),
  (209, 3, 'El clima (Weather)', 'Hot', 'Caluroso'),
  (210, 3, 'El clima (Weather)', 'Boiling', 'Abrasador'),
  (211, 3, 'El clima (Weather)', 'Cool', 'Fresco'),
  (212, 3, 'El clima (Weather)', 'Cold', 'Frío'),
  (213, 3, 'El clima (Weather)', 'Freezing', 'Helado'),
  (214, 3, 'El clima (Weather)', 'Cloudy', 'Nublado'),
  (215, 3, 'El clima (Weather)', 'Rainy', 'Lluvioso'),
  (216, 3, 'El clima (Weather)', 'Stormy', 'Tormentoso'),
  (217, 3, 'El clima (Weather)', 'Snowy', 'Nevado'),
  (218, 3, 'El clima (Weather)', 'Windy', 'Ventoso'),
  (219, 3, 'El clima (Weather)', 'Foggy', 'Con neblina'),
  (220, 3, 'El clima (Weather)', 'Hailing', 'Con granizo'),
  (221, 3, 'El clima (Weather)', 'Drizzly', 'Con llovizna'),
  (222, 3, 'Abreviaturas de dirección', 'Ave. (Avenue)', 'Avenida'),
  (223, 3, 'Abreviaturas de dirección', 'St. (Street)', 'Calle'),
  (224, 3, 'Vocabulario útil de tiempo (días/meses)', 'Sunday – Saturday', 'Domingo – Sábado (días de la semana)'),
  (225, 3, 'Vocabulario útil de tiempo (días/meses)', 'January – December', 'Enero – Diciembre (meses del año)'),
  (226, 3, 'Vocabulario útil de tiempo (días/meses)', 'Yesterday / Today / Tomorrow', 'Ayer / Hoy / Mañana'),
  (227, 4, 'Partes de la casa', 'Bedroom', 'Dormitorio'),
  (228, 4, 'Partes de la casa', 'Dressroom', 'Vestidor'),
  (229, 4, 'Partes de la casa', 'Laundry', 'Lavandería'),
  (230, 4, 'Partes de la casa', 'Bathroom', 'Baño'),
  (231, 4, 'Partes de la casa', 'Dining room', 'Comedor'),
  (232, 4, 'Partes de la casa', 'Living room', 'Sala'),
  (233, 4, 'Partes de la casa', 'Study room', 'Estudio'),
  (234, 4, 'Partes de la casa', 'Garden', 'Jardín'),
  (235, 4, 'Partes de la casa', 'Kitchen', 'Cocina'),
  (236, 4, 'Partes de la casa', 'Yard', 'Patio'),
  (237, 4, 'Adjetivos para describir lugares', 'Beautiful', 'Hermoso'),
  (238, 4, 'Adjetivos para describir lugares', 'Comfortable', 'Cómodo'),
  (239, 4, 'Adjetivos para describir lugares', 'Noisy', 'Ruidoso'),
  (240, 4, 'Adjetivos para describir lugares', 'Tranquil', 'Tranquilo'),
  (241, 4, 'Adjetivos para describir lugares', 'Messy', 'Desordenado'),
  (242, 4, 'Adjetivos para describir lugares', 'Warm', 'Cálido'),
  (243, 4, 'Adjetivos para describir lugares', 'Clean', 'Limpio'),
  (244, 4, 'Adjetivos para describir lugares', 'Uncomfortable', 'Incómodo'),
  (245, 4, 'Adjetivos para describir lugares', 'Cold', 'Frío'),
  (246, 4, 'Adjetivos para describir lugares', 'Empty', 'Vacío'),
  (247, 4, 'Adjetivos para describir lugares', 'Crowded', 'Lleno de gente'),
  (248, 4, 'Adjetivos para describir lugares', 'Cool', 'Fresco'),
  (249, 4, 'Adjetivos para describir lugares', 'Funny', 'Divertido'),
  (250, 4, 'Adjetivos para describir lugares', 'Boring', 'Aburrido'),
  (251, 4, 'Adjetivos para describir lugares', 'Clear', 'Claro / Despejado'),
  (252, 4, 'Adjetivos para describir lugares', 'Fresh', 'Fresco'),
  (253, 4, 'Adjetivos para describir lugares', 'Complicated', 'Complicado'),
  (254, 4, 'Adjetivos para describir lugares', 'Small', 'Pequeño'),
  (255, 4, 'Adjetivos para describir lugares', 'Big', 'Grande'),
  (256, 4, 'Adjetivos para describir lugares', 'Relaxing', 'Relajante'),
  (257, 4, 'Adjetivos para describir lugares', 'Hot', 'Caluroso'),
  (258, 4, 'Adjetivos para describir lugares', 'Organized', 'Organizado'),
  (259, 4, 'Adjetivos para describir lugares', 'Personal', 'Personal'),
  (260, 4, 'Adjetivos para describir lugares', 'Wide', 'Ancho'),
  (261, 4, 'Adjetivos para describir lugares', 'Narrow', 'Angosto'),
  (262, 4, 'Adjetivos generales', 'Big / Little / Small', 'Grande / Pequeño / Pequeño'),
  (263, 4, 'Adjetivos generales', 'Great', 'Estupendo'),
  (264, 4, 'Adjetivos generales', 'Important', 'Importante'),
  (265, 4, 'Adjetivos generales', 'Slow / Fast', 'Lento / Rápido'),
  (266, 4, 'Adjetivos generales', 'Large', 'Grande, amplio'),
  (267, 4, 'Adjetivos generales', 'Smooth', 'Suave'),
  (268, 4, 'Adjetivos generales', 'Bumpy', 'Con baches / Disparejo'),
  (269, 4, 'Adjetivos generales', 'Sunny', 'Soleado'),
  (270, 4, 'Adjetivos generales', 'Old / New', 'Viejo / Nuevo'),
  (271, 4, 'Adjetivos generales', 'Good / Bad', 'Bueno / Malo'),
  (272, 4, 'Adjetivos generales', 'Tall', 'Alto'),
  (273, 4, 'Adjetivos generales', 'Quiet', 'Callado'),
  (274, 4, 'Adjetivos generales', 'Pretty', 'Bonito'),
  (275, 4, 'Adjetivos generales', 'Right / Same', 'Correcto / Igual'),
  (276, 4, 'Adjetivos generales', 'Sweet / Sour', 'Dulce / Ácido'),
  (277, 4, 'Adjetivos generales', 'Pleasant', 'Agradable'),
  (278, 4, 'Adjetivos generales', 'High', 'Alto (altura)'),
  (279, 4, 'Adjetivos generales', 'Round', 'Redondo'),
  (280, 4, 'Adjetivos generales', 'Thin / Fat', 'Delgado / Gordo'),
  (281, 4, 'Adjetivos generales', 'Nice', 'Agradable, lindo'),
  (282, 4, 'Adjetivos generales', 'Different', 'Diferente'),
  (283, 4, 'Adjetivos generales', 'Difficult', 'Difícil'),
  (284, 4, 'Adjetivos generales', 'Long', 'Largo'),
  (285, 4, 'Adjetivos generales', 'Dark', 'Oscuro'),
  (286, 4, 'Adjetivos generales', 'Rainy', 'Lluvioso'),
  (287, 4, 'Adjetivos generales', 'Lazy', 'Perezoso'),
  (288, 4, 'Adjetivos generales', 'Loud', 'Ruidoso'),
  (289, 4, 'Adjetivos generales', 'Dull', 'Aburrido / Sin brillo'),
  (290, 4, 'Adjetivos generales', 'First / Last / Next / Other', 'Primero / Último / Siguiente / Otro'),
  (291, 4, 'Muebles (Furniture)', 'Sofa', 'Sofá'),
  (292, 4, 'Muebles (Furniture)', 'Bookcase', 'Librero'),
  (293, 4, 'Muebles (Furniture)', 'Window', 'Ventana'),
  (294, 4, 'Muebles (Furniture)', 'TV', 'Televisor'),
  (295, 4, 'Muebles (Furniture)', 'Picture', 'Cuadro'),
  (296, 4, 'Muebles (Furniture)', 'Plant', 'Planta'),
  (297, 4, 'Muebles (Furniture)', 'Carpet', 'Alfombra'),
  (298, 4, 'Muebles (Furniture)', 'Table', 'Mesa'),
  (299, 4, 'Muebles (Furniture)', 'Chair', 'Silla'),
  (300, 4, 'Muebles (Furniture)', 'Lamp', 'Lámpara'),
  (301, 4, 'Muebles (Furniture)', 'Bed', 'Cama'),
  (302, 4, 'Muebles (Furniture)', 'Pillow', 'Almohada'),
  (303, 4, 'Muebles (Furniture)', 'Curtains', 'Cortinas'),
  (304, 4, 'Muebles (Furniture)', 'Night table', 'Mesa de noche'),
  (305, 4, 'Muebles (Furniture)', 'Bureau', 'Cómoda'),
  (306, 4, 'Muebles (Furniture)', 'Closet', 'Closet / Ropero'),
  (307, 4, 'Muebles (Furniture)', 'Refrigerator', 'Refrigerador'),
  (308, 4, 'Muebles (Furniture)', 'Cabinet', 'Gabinete'),
  (309, 4, 'Muebles (Furniture)', 'Blender', 'Licuadora'),
  (310, 4, 'Muebles (Furniture)', 'Microwave', 'Microondas'),
  (311, 4, 'Muebles (Furniture)', 'Stove', 'Cocina / Estufa'),
  (312, 4, 'Muebles (Furniture)', 'Coffeemaker', 'Cafetera'),
  (313, 4, 'Muebles (Furniture)', 'Mirror', 'Espejo'),
  (314, 4, 'Muebles (Furniture)', 'Toilet', 'Inodoro'),
  (315, 4, 'Muebles (Furniture)', 'Towel', 'Toalla'),
  (316, 4, 'Muebles (Furniture)', 'Shower', 'Ducha'),
  (317, 4, 'Muebles (Furniture)', 'Sink', 'Lavamanos / Fregadero'),
  (318, 4, 'Muebles (Furniture)', 'Wastebasket', 'Papelera'),
  (319, 4, 'Muebles (Furniture)', 'Stereo system', 'Equipo de sonido'),
  (320, 4, 'Muebles (Furniture)', 'DVD player', 'Reproductor de DVD'),
  (321, 4, 'Ocupaciones (Occupations)', 'Teacher', 'Profesor/a'),
  (322, 4, 'Ocupaciones (Occupations)', 'Student', 'Estudiante'),
  (323, 4, 'Ocupaciones (Occupations)', 'Doctor', 'Doctor/a'),
  (324, 4, 'Ocupaciones (Occupations)', 'Engineer', 'Ingeniero/a'),
  (325, 4, 'Ocupaciones (Occupations)', 'Architect', 'Arquitecto/a'),
  (326, 4, 'Ocupaciones (Occupations)', 'Dancer', 'Bailarín/a'),
  (327, 4, 'Ocupaciones (Occupations)', 'Actor', 'Actor'),
  (328, 4, 'Ocupaciones (Occupations)', 'Actress', 'Actriz'),
  (329, 4, 'Ocupaciones (Occupations)', 'Waiter', 'Mesero'),
  (330, 4, 'Ocupaciones (Occupations)', 'Waitress', 'Mesera'),
  (331, 4, 'Ocupaciones (Occupations)', 'Plumber', 'Plomero/a'),
  (332, 4, 'Ocupaciones (Occupations)', 'Journalist', 'Periodista'),
  (333, 4, 'Ocupaciones (Occupations)', 'Writer', 'Escritor/a'),
  (334, 4, 'Ocupaciones (Occupations)', 'Clown', 'Payaso'),
  (335, 4, 'Ocupaciones (Occupations)', 'Cashier', 'Cajero/a'),
  (336, 4, 'Ocupaciones (Occupations)', 'Musician', 'Músico/a'),
  (337, 4, 'Ocupaciones (Occupations)', 'Psychologist', 'Psicólogo/a'),
  (338, 4, 'Ocupaciones (Occupations)', 'Professor', 'Catedrático/a'),
  (339, 4, 'Ocupaciones (Occupations)', 'Pilot', 'Piloto'),
  (340, 4, 'Ocupaciones (Occupations)', 'Driver', 'Conductor/a'),
  (341, 4, 'Ocupaciones (Occupations)', 'Baker', 'Panadero/a'),
  (342, 4, 'Ocupaciones (Occupations)', 'Butcher', 'Carnicero/a'),
  (343, 4, 'Ocupaciones (Occupations)', 'Electrician', 'Electricista'),
  (344, 4, 'Ocupaciones (Occupations)', 'Graphic designer', 'Diseñador/a gráfico/a'),
  (345, 4, 'Ocupaciones (Occupations)', 'Singer', 'Cantante'),
  (346, 4, 'Pronombres personales (Subject pronouns)', 'I', 'Yo'),
  (347, 4, 'Pronombres personales (Subject pronouns)', 'You', 'Tú / Usted'),
  (348, 4, 'Pronombres personales (Subject pronouns)', 'He', 'Él'),
  (349, 4, 'Pronombres personales (Subject pronouns)', 'She', 'Ella'),
  (350, 4, 'Pronombres personales (Subject pronouns)', 'It', 'Esto / Esta (cosa, animal)'),
  (351, 4, 'Pronombres personales (Subject pronouns)', 'We', 'Nosotros / Nosotras'),
  (352, 4, 'Pronombres personales (Subject pronouns)', 'You (plural)', 'Ustedes'),
  (353, 4, 'Pronombres personales (Subject pronouns)', 'They', 'Ellos / Ellas'),
  (354, 5, 'Acciones del salón de clase', 'Spell a word', 'Deletrear una palabra'),
  (355, 5, 'Acciones del salón de clase', 'Stand up', 'Pararse'),
  (356, 5, 'Acciones del salón de clase', 'Sit down', 'Sentarse'),
  (357, 5, 'Acciones del salón de clase', 'Go to the board', 'Ir a la pizarra'),
  (358, 5, 'Acciones del salón de clase', 'Write on the board', 'Escribir en la pizarra'),
  (359, 5, 'Acciones del salón de clase', 'Erase the board', 'Borrar la pizarra'),
  (360, 5, 'Acciones del salón de clase', 'Read the instructions', 'Leer las instrucciones'),
  (361, 5, 'Acciones del salón de clase', 'Put away my stuff', 'Guardar mis cosas'),
  (362, 5, 'Acciones del salón de clase', 'Raise a hand', 'Levantar la mano'),
  (363, 5, 'Acciones del salón de clase', 'Ask questions', 'Hacer preguntas'),
  (364, 5, 'Acciones del salón de clase', 'Listen to the teacher', 'Escuchar al profesor'),
  (365, 5, 'Acciones del salón de clase', 'Answer questions', 'Responder preguntas'),
  (366, 5, 'Acciones del salón de clase', 'Practice with a partner', 'Practicar con un compañero'),
  (367, 5, 'Acciones del salón de clase', 'Do homework', 'Hacer la tarea'),
  (368, 5, 'Acciones del salón de clase', 'Correct mistakes', 'Corregir errores'),
  (369, 5, 'Acciones del salón de clase', 'Match words with pictures', 'Relacionar palabras con imágenes'),
  (370, 5, 'Acciones del salón de clase', 'Fill in the blanks', 'Llenar los espacios en blanco'),
  (371, 5, 'Acciones del salón de clase', 'Match the words', 'Relacionar las palabras'),
  (372, 5, 'Acciones del salón de clase', 'Work alone', 'Trabajar solo/a'),
  (373, 5, 'Acciones del salón de clase', 'Check my answers', 'Revisar mis respuestas'),
  (374, 5, 'Acciones del salón de clase', 'Write on my notebook', 'Escribir en mi cuaderno'),
  (375, 5, 'Acciones del salón de clase', 'Listen and repeat', 'Escuchar y repetir'),
  (376, 5, 'Acciones del salón de clase', 'Circle the correct answer', 'Encerrar la respuesta correcta'),
  (377, 5, 'Acciones del salón de clase', 'Share with the class', 'Compartir con la clase'),
  (378, 5, 'Acciones del salón de clase', 'Put the words in order', 'Ordenar las palabras'),
  (379, 5, 'Acciones del salón de clase', 'Study', 'Estudiar'),
  (380, 5, 'Actividades en casa (Actions we do at home)', 'Watch TV', 'Ver televisión'),
  (381, 5, 'Actividades en casa (Actions we do at home)', 'Read a book', 'Leer un libro'),
  (382, 5, 'Actividades en casa (Actions we do at home)', 'Play the guitar', 'Tocar la guitarra'),
  (383, 5, 'Actividades en casa (Actions we do at home)', 'Listen to music', 'Escuchar música'),
  (384, 5, 'Actividades en casa (Actions we do at home)', 'Play video games', 'Jugar videojuegos'),
  (385, 5, 'Actividades en casa (Actions we do at home)', 'Use the computer', 'Usar la computadora'),
  (386, 5, 'Actividades en casa (Actions we do at home)', 'Exercise at home', 'Hacer ejercicio en casa'),
  (387, 5, 'Actividades en casa (Actions we do at home)', 'Clean the house', 'Limpiar la casa'),
  (388, 5, 'Actividades en casa (Actions we do at home)', 'Wash the dishes', 'Lavar los platos'),
  (389, 5, 'Actividades en casa (Actions we do at home)', 'Feed the pet', 'Alimentar a la mascota'),
  (390, 5, 'Actividades en casa (Actions we do at home)', 'Walk the dog', 'Pasear al perro'),
  (391, 5, 'Actividades en casa (Actions we do at home)', 'Study', 'Estudiar'),
  (392, 5, 'Actividades en casa (Actions we do at home)', 'Make breakfast', 'Hacer el desayuno'),
  (393, 5, 'Actividades en casa (Actions we do at home)', 'Make lunch', 'Hacer el almuerzo'),
  (394, 5, 'Actividades en casa (Actions we do at home)', 'Make dinner', 'Hacer la cena'),
  (395, 5, 'Actividades en casa (Actions we do at home)', 'Go to bed', 'Ir a la cama'),
  (396, 5, 'Actividades en casa (Actions we do at home)', 'Get dressed', 'Vestirse'),
  (397, 5, 'Actividades en casa (Actions we do at home)', 'Shave', 'Rasurarse'),
  (398, 5, 'Actividades en casa (Actions we do at home)', 'Take a shower', 'Ducharse'),
  (399, 5, 'Actividades en casa (Actions we do at home)', 'Brush my teeth', 'Cepillarse los dientes'),
  (400, 5, 'Actividades cotidianas (Everyday activities)', 'Chat on the phone', 'Chatear por teléfono'),
  (401, 5, 'Actividades cotidianas (Everyday activities)', 'Go to work', 'Ir al trabajo'),
  (402, 5, 'Actividades cotidianas (Everyday activities)', 'Go to study', 'Ir a estudiar'),
  (403, 5, 'Actividades cotidianas (Everyday activities)', 'Leave home', 'Salir de casa'),
  (404, 5, 'Actividades cotidianas (Everyday activities)', 'Eat out', 'Comer afuera'),
  (405, 5, 'Actividades cotidianas (Everyday activities)', 'Start work', 'Empezar a trabajar'),
  (406, 5, 'Actividades cotidianas (Everyday activities)', 'Start classes', 'Empezar las clases'),
  (407, 5, 'Actividades cotidianas (Everyday activities)', 'Talk to friends', 'Hablar con amigos'),
  (408, 5, 'Actividades cotidianas (Everyday activities)', 'Get home', 'Llegar a casa'),
  (409, 5, 'Actividades cotidianas (Everyday activities)', 'Have breakfast', 'Desayunar'),
  (410, 5, 'Actividades cotidianas (Everyday activities)', 'Have lunch', 'Almorzar'),
  (411, 5, 'Actividades cotidianas (Everyday activities)', 'Have dinner', 'Cenar'),
  (412, 5, 'Actividades cotidianas (Everyday activities)', 'Have a snack', 'Comer un bocadillo'),
  (413, 5, 'Actividades cotidianas (Everyday activities)', 'Play soccer', 'Jugar fútbol'),
  (414, 5, 'Actividades cotidianas (Everyday activities)', 'Comb my hair', 'Peinarse'),
  (415, 5, 'Actividades cotidianas (Everyday activities)', 'Go dancing', 'Ir a bailar'),
  (416, 5, 'Actividades cotidianas (Everyday activities)', 'Take a nap', 'Tomar una siesta'),
  (417, 5, 'Actividades cotidianas (Everyday activities)', 'Go sightseeing', 'Hacer turismo'),
  (418, 5, 'Actividades cotidianas (Everyday activities)', 'Hang out', 'Salir / pasar el rato'),
  (419, 5, 'Actividades cotidianas (Everyday activities)', 'Get up', 'Levantarse'),
  (420, 5, 'Actividades cotidianas (Everyday activities)', 'Wake up', 'Despertarse'),
  (421, 5, 'Actividades cotidianas (Everyday activities)', 'Put on makeup', 'Maquillarse'),
  (422, 5, 'Actividades cotidianas (Everyday activities)', 'Brush my hair', 'Cepillarse el cabello'),
  (423, 5, 'Actividades cotidianas (Everyday activities)', 'Go out with friends', 'Salir con amigos'),
  (424, 5, 'Actividades cotidianas (Everyday activities)', 'Make the bed', 'Hacer la cama'),
  (425, 5, 'Actividades cotidianas (Everyday activities)', 'Do the laundry', 'Lavar la ropa'),
  (426, 5, 'Actividades cotidianas (Everyday activities)', 'Wash clothes', 'Lavar la ropa'),
  (427, 5, 'Actividades cotidianas (Everyday activities)', 'Take the bus', 'Tomar el bus'),
  (428, 5, 'Actividades cotidianas (Everyday activities)', 'Iron clothes', 'Planchar la ropa'),
  (429, 5, 'Actividades cotidianas (Everyday activities)', 'Play cards', 'Jugar a las cartas'),
  (430, 5, 'Actividades cotidianas (Everyday activities)', 'Go swimming', 'Ir a nadar'),
  (431, 5, 'Actividades cotidianas (Everyday activities)', 'Relax', 'Relajarse'),
  (432, 5, 'Actividades cotidianas (Everyday activities)', 'Make a snack', 'Preparar un bocadillo'),
  (433, 6, 'El cuerpo humano (The human body)', 'Head', 'Cabeza'),
  (434, 6, 'El cuerpo humano (The human body)', 'Hair', 'Cabello'),
  (435, 6, 'El cuerpo humano (The human body)', 'Shoulder', 'Hombro'),
  (436, 6, 'El cuerpo humano (The human body)', 'Eye', 'Ojo'),
  (437, 6, 'El cuerpo humano (The human body)', 'Chest', 'Pecho'),
  (438, 6, 'El cuerpo humano (The human body)', 'Nose', 'Nariz'),
  (439, 6, 'El cuerpo humano (The human body)', 'Hand', 'Mano'),
  (440, 6, 'El cuerpo humano (The human body)', 'Mouth', 'Boca'),
  (441, 6, 'El cuerpo humano (The human body)', 'Hip', 'Cadera'),
  (442, 6, 'El cuerpo humano (The human body)', 'Waist', 'Cintura'),
  (443, 6, 'El cuerpo humano (The human body)', 'Leg', 'Pierna'),
  (444, 6, 'El cuerpo humano (The human body)', 'Fingers', 'Dedos (mano)'),
  (445, 6, 'El cuerpo humano (The human body)', 'Foot', 'Pie'),
  (446, 6, 'El cuerpo humano (The human body)', 'Knee', 'Rodilla'),
  (447, 6, 'El cuerpo humano (The human body)', 'Ear', 'Oreja'),
  (448, 6, 'El cuerpo humano (The human body)', 'Lips', 'Labios'),
  (449, 6, 'Habilidades comunes (Common abilities)', 'Play video games', 'Jugar videojuegos'),
  (450, 6, 'Habilidades comunes (Common abilities)', 'Go shopping', 'Ir de compras'),
  (451, 6, 'Habilidades comunes (Common abilities)', 'Record Tik Tok', 'Grabar TikTok'),
  (452, 6, 'Habilidades comunes (Common abilities)', 'Feel music', 'Sentir la música'),
  (453, 6, 'Habilidades comunes (Common abilities)', 'Play the guitar', 'Tocar la guitarra'),
  (454, 6, 'Habilidades comunes (Common abilities)', 'Play the piano', 'Tocar el piano'),
  (455, 6, 'Habilidades comunes (Common abilities)', 'Play soccer', 'Jugar fútbol'),
  (456, 6, 'Habilidades comunes (Common abilities)', 'Play basketball', 'Jugar básquetbol'),
  (457, 6, 'Habilidades comunes (Common abilities)', 'Do exercise', 'Hacer ejercicio'),
  (458, 6, 'Habilidades comunes (Common abilities)', 'Do karate', 'Hacer karate'),
  (459, 6, 'Habilidades comunes (Common abilities)', 'Build your body', 'Desarrollar el cuerpo'),
  (460, 6, 'Habilidades comunes (Common abilities)', 'Work out at home', 'Entrenar en casa'),
  (461, 6, 'Habilidades comunes (Common abilities)', 'Chat with friends', 'Chatear con amigos'),
  (462, 6, 'Habilidades comunes (Common abilities)', 'Sing a song', 'Cantar una canción'),
  (463, 6, 'Habilidades comunes (Common abilities)', 'Surf on YouTube', 'Navegar en YouTube'),
  (464, 6, 'Habilidades comunes (Common abilities)', 'Do ballet', 'Hacer ballet'),
  (465, 6, 'Habilidades comunes (Common abilities)', 'Paint a picture', 'Pintar un cuadro'),
  (466, 6, 'Habilidades comunes (Common abilities)', 'Train a dog', 'Entrenar a un perro'),
  (467, 6, 'Habilidades comunes (Common abilities)', 'Make a cake', 'Hacer un pastel'),
  (468, 6, 'Habilidades comunes (Common abilities)', 'Cook something', 'Cocinar algo'),
  (469, 6, 'Habilidades comunes (Common abilities)', 'Design a logo', 'Diseñar un logo'),
  (470, 6, 'Habilidades comunes (Common abilities)', 'Draw a landscape', 'Dibujar un paisaje'),
  (471, 6, 'Habilidades comunes (Common abilities)', 'Write a poem', 'Escribir un poema'),
  (472, 6, 'Habilidades comunes (Common abilities)', 'Speak English', 'Hablar inglés'),
  (473, 6, 'Habilidades comunes (Common abilities)', 'Jump high', 'Saltar alto'),
  (474, 6, 'Demostrativos (Demonstratives)', 'This (singular, near)', 'Este / Esta / Esto (cerca)'),
  (475, 6, 'Demostrativos (Demonstratives)', 'That (singular, far)', 'Ese / Esa / Eso (lejos)'),
  (476, 6, 'Demostrativos (Demonstratives)', 'These (plural, near)', 'Estos / Estas (cerca)'),
  (477, 6, 'Demostrativos (Demonstratives)', 'Those (plural, far)', 'Esos / Esas (lejos)'),
  (478, 7, 'Lugares en la ciudad (Places around town)', 'Bakery', 'Panadería'),
  (479, 7, 'Lugares en la ciudad (Places around town)', 'Bank', 'Banco'),
  (480, 7, 'Lugares en la ciudad (Places around town)', 'Barber shop', 'Barbería'),
  (481, 7, 'Lugares en la ciudad (Places around town)', 'Gas Station', 'Gasolinera'),
  (482, 7, 'Lugares en la ciudad (Places around town)', 'Convenience Store', 'Tienda de conveniencia'),
  (483, 7, 'Lugares en la ciudad (Places around town)', 'Coffee Shop', 'Cafetería'),
  (484, 7, 'Lugares en la ciudad (Places around town)', 'Bus Station', 'Terminal de buses'),
  (485, 7, 'Lugares en la ciudad (Places around town)', 'Furniture Store', 'Mueblería'),
  (486, 7, 'Lugares en la ciudad (Places around town)', 'Electronics Store', 'Tienda de electrónica'),
  (487, 7, 'Lugares en la ciudad (Places around town)', 'Drug Store', 'Farmacia'),
  (488, 7, 'Lugares en la ciudad (Places around town)', 'Clinic', 'Clínica'),
  (489, 7, 'Lugares en la ciudad (Places around town)', 'Eye-care Center', 'Centro de óptica'),
  (490, 7, 'Lugares en la ciudad (Places around town)', 'Hotel', 'Hotel'),
  (491, 7, 'Lugares en la ciudad (Places around town)', 'Hospital', 'Hospital'),
  (492, 7, 'Lugares en la ciudad (Places around town)', 'Movie Theater', 'Cine'),
  (493, 7, 'Lugares en la ciudad (Places around town)', 'Pet Shop', 'Tienda de mascotas'),
  (494, 7, 'Lugares en la ciudad (Places around town)', 'School', 'Escuela'),
  (495, 7, 'Lugares en la ciudad (Places around town)', 'Restaurant', 'Restaurante'),
  (496, 7, 'Lugares en la ciudad (Places around town)', 'City Hall', 'Alcaldía'),
  (497, 7, 'Lugares en la ciudad (Places around town)', 'Police Station', 'Estación de policía'),
  (498, 7, 'Preposiciones de lugar', 'In', 'En, dentro de'),
  (499, 7, 'Preposiciones de lugar', 'On', 'Sobre, encima de'),
  (500, 7, 'Preposiciones de lugar', 'Under', 'Debajo de'),
  (501, 7, 'Preposiciones de lugar', 'Near', 'Cerca de'),
  (502, 7, 'Preposiciones de lugar', 'Next to', 'Al lado de'),
  (503, 7, 'Preposiciones de lugar', 'In front of', 'Frente a'),
  (504, 7, 'Preposiciones de lugar', 'Behind', 'Detrás de'),
  (505, 7, 'Preposiciones de lugar', 'Opposite', 'Frente a, opuesto a'),
  (506, 7, 'Preposiciones de lugar', 'Across from', 'Al otro lado de, enfrente de'),
  (507, 7, 'Preposiciones de lugar', 'Between', 'Entre (dos)'),
  (508, 7, 'Preposiciones de lugar', 'Among', 'Entre (varios)'),
  (509, 7, 'Preposiciones de lugar', 'Over', 'Encima de, sobre'),
  (510, 7, 'Preposiciones de lugar', 'Above', 'Por encima de'),
  (511, 7, 'Preposiciones de lugar', 'On the left', 'A la izquierda'),
  (512, 7, 'Preposiciones de lugar', 'On the right', 'A la derecha'),
  (513, 7, 'Preposiciones de lugar', 'At', 'En (un punto)'),
  (514, 7, 'Verbos de acción', 'Dig', 'Excavar'),
  (515, 7, 'Verbos de acción', 'Grow', 'Crecer / Cultivar'),
  (516, 7, 'Verbos de acción', 'Bribe', 'Sobornar'),
  (517, 7, 'Verbos de acción', 'Bet', 'Apostar'),
  (518, 7, 'Verbos de acción', 'Fracture', 'Fracturar'),
  (519, 7, 'Verbos de acción', 'Clean', 'Limpiar'),
  (520, 7, 'Verbos de acción', 'Explain', 'Explicar'),
  (521, 7, 'Verbos de acción', 'Overdo', 'Exagerar'),
  (522, 7, 'Verbos de acción', 'Dive', 'Bucear'),
  (523, 7, 'Verbos de acción', 'Flirt', 'Coquetear'),
  (524, 7, 'Verbos de acción', 'Take', 'Tomar'),
  (525, 7, 'Verbos de acción', 'Analyze', 'Analizar'),
  (526, 7, 'Verbos de acción', 'Change', 'Cambiar'),
  (527, 7, 'Verbos de acción', 'Stare', 'Mirar fijamente'),
  (528, 7, 'Verbos de acción', 'Forbid', 'Prohibir'),
  (529, 7, 'Verbos de acción', 'Bury', 'Enterrar'),
  (530, 7, 'Verbos de acción', 'Mop', 'Trapear'),
  (531, 7, 'Verbos de acción', 'Turn', 'Girar'),
  (532, 7, 'Verbos de acción', 'Hug', 'Abrazar'),
  (533, 7, 'Verbos de acción', 'Start', 'Empezar'),
  (534, 7, 'Verbos de acción', 'Push', 'Empujar'),
  (535, 7, 'Verbos de acción', 'Pull', 'Jalar'),
  (536, 7, 'Verbos de acción', 'Redo', 'Rehacer'),
  (537, 7, 'Verbos de acción', 'Spoil', 'Echar a perder, malcriar'),
  (538, 7, 'Verbos de acción', 'Believe', 'Creer'),
  (539, 8, 'Palabras Wh- (Wh-questions)', 'What', 'Qué (para cosas)'),
  (540, 8, 'Palabras Wh- (Wh-questions)', 'Where', 'Dónde (para lugares)'),
  (541, 8, 'Palabras Wh- (Wh-questions)', 'When', 'Cuándo (para tiempo)'),
  (542, 8, 'Palabras Wh- (Wh-questions)', 'Who', 'Quién (para personas)'),
  (543, 8, 'Palabras Wh- (Wh-questions)', 'Which', 'Cuál (para elegir)'),
  (544, 8, 'Palabras Wh- (Wh-questions)', 'Why', 'Por qué (para razones)'),
  (545, 8, 'Palabras Wh- (Wh-questions)', 'How', 'Cómo (para el modo)'),
  (546, 8, 'Tiempo (Past/Present/Future)', 'Yesterday / Last night / Last week', 'Ayer / Anoche / La semana pasada'),
  (547, 8, 'Tiempo (Past/Present/Future)', 'Today / This week / At the moment', 'Hoy / Esta semana / En este momento'),
  (548, 8, 'Tiempo (Past/Present/Future)', 'Tomorrow / Next week / By 2023', 'Mañana / La próxima semana / Para el 2023'),
  (549, 9, 'Verbo TO BE en pasado', 'I / He / She / It + WAS', 'Yo / Él / Ella / Eso + estaba, era, fui'),
  (550, 9, 'Verbo TO BE en pasado', 'You / We / They + WERE', 'Tú / Nosotros / Ellos + estaban, eran, fueron'),
  (551, 9, 'Gramática: modal DID', 'S + DIDN''T + verb (base form) + C', 'Estructura negativa en pasado simple'),
  (552, 9, 'Gramática: modal DID', 'Did + S + verb (base form) + C?', 'Estructura de pregunta en pasado simple'),
  (553, 10, 'Comida y bebidas (Food and drinks)', 'Meat', 'Carne'),
  (554, 10, 'Comida y bebidas (Food and drinks)', 'Pork', 'Cerdo'),
  (555, 10, 'Comida y bebidas (Food and drinks)', 'Chicken', 'Pollo'),
  (556, 10, 'Comida y bebidas (Food and drinks)', 'Fish', 'Pescado'),
  (557, 10, 'Comida y bebidas (Food and drinks)', 'Rice', 'Arroz'),
  (558, 10, 'Comida y bebidas (Food and drinks)', 'Pasta / Noodles', 'Pasta / Fideos'),
  (559, 10, 'Comida y bebidas (Food and drinks)', 'French fries', 'Papas fritas'),
  (560, 10, 'Comida y bebidas (Food and drinks)', 'Salad', 'Ensalada'),
  (561, 10, 'Comida y bebidas (Food and drinks)', 'Eggs', 'Huevos'),
  (562, 10, 'Comida y bebidas (Food and drinks)', 'Soup', 'Sopa'),
  (563, 10, 'Comida y bebidas (Food and drinks)', 'Fruit', 'Fruta'),
  (564, 10, 'Comida y bebidas (Food and drinks)', 'Oat', 'Avena'),
  (565, 10, 'Comida y bebidas (Food and drinks)', 'Cheese', 'Queso'),
  (566, 10, 'Comida y bebidas (Food and drinks)', 'Bread', 'Pan'),
  (567, 10, 'Comida y bebidas (Food and drinks)', 'Cookies', 'Galletas'),
  (568, 10, 'Comida y bebidas (Food and drinks)', 'Butter', 'Mantequilla'),
  (569, 10, 'Comida y bebidas (Food and drinks)', 'Soda', 'Gaseosa'),
  (570, 10, 'Comida y bebidas (Food and drinks)', 'Coffee', 'Café'),
  (571, 10, 'Comida y bebidas (Food and drinks)', 'Tea', 'Té'),
  (572, 10, 'Comida y bebidas (Food and drinks)', 'Infusion', 'Infusión'),
  (573, 10, 'Comida y bebidas (Food and drinks)', 'Chocolate', 'Chocolate'),
  (574, 10, 'Comida y bebidas (Food and drinks)', 'Juice', 'Jugo'),
  (575, 10, 'Comida y bebidas (Food and drinks)', 'Milk', 'Leche'),
  (576, 10, 'Comida y bebidas (Food and drinks)', 'Water', 'Agua'),
  (577, 10, 'Gramática: modal WILL / BE GOING TO', 'S + WILL + verb (base form) + C', 'Estructura para predicción / decisión espontánea de futuro'),
  (578, 10, 'Gramática: modal WILL / BE GOING TO', 'S + BE GOING TO + verb (base form) + C', 'Estructura para plan futuro ya decidido'),
  (579, 9, 'Verbos regulares', 'Accept', 'Aceptar'),
  (580, 9, 'Verbos regulares', 'Act', 'Actuar'),
  (581, 9, 'Verbos regulares', 'Add', 'Agregar'),
  (582, 9, 'Verbos regulares', 'Admire', 'Admirar'),
  (583, 9, 'Verbos regulares', 'Agree', 'Estar de acuerdo'),
  (584, 9, 'Verbos regulares', 'Answer', 'Responder'),
  (585, 9, 'Verbos regulares', 'Arrive', 'Llegar'),
  (586, 9, 'Verbos regulares', 'Ask', 'Preguntar'),
  (587, 9, 'Verbos regulares', 'Attempt', 'Intentar'),
  (588, 9, 'Verbos regulares', 'Bake', 'Hornear'),
  (589, 9, 'Verbos regulares', 'Behave', 'Comportarse'),
  (590, 9, 'Verbos regulares', 'Believe', 'Creer'),
  (591, 9, 'Verbos regulares', 'Call', 'Llamar'),
  (592, 9, 'Verbos regulares', 'Carry', 'Llevar'),
  (593, 9, 'Verbos regulares', 'Clean', 'Limpiar'),
  (594, 9, 'Verbos regulares', 'Close', 'Cerrar'),
  (595, 9, 'Verbos regulares', 'Cook', 'Cocinar'),
  (596, 9, 'Verbos regulares', 'Count', 'Contar'),
  (597, 9, 'Verbos regulares', 'Cry', 'Llorar'),
  (598, 9, 'Verbos regulares', 'Dance', 'Bailar'),
  (599, 9, 'Verbos regulares', 'Decide', 'Decidir'),
  (600, 9, 'Verbos regulares', 'Define', 'Definir'),
  (601, 9, 'Verbos regulares', 'Discover', 'Descubrir'),
  (602, 9, 'Verbos regulares', 'Discuss', 'Discutir'),
  (603, 9, 'Verbos regulares', 'End', 'Terminar'),
  (604, 9, 'Verbos regulares', 'Enter', 'Entrar'),
  (605, 9, 'Verbos regulares', 'Enjoy', 'Disfrutar'),
  (606, 9, 'Verbos regulares', 'Explain', 'Explicar'),
  (607, 9, 'Verbos regulares', 'Expect', 'Esperar (anticipar algo)'),
  (608, 9, 'Verbos regulares', 'Fill', 'Llenar'),
  (609, 9, 'Verbos regulares', 'Finish', 'Terminar'),
  (610, 9, 'Verbos regulares', 'Follow', 'Seguir'),
  (611, 9, 'Verbos regulares', 'Gather', 'Recoger'),
  (612, 9, 'Verbos regulares', 'Guess', 'Adivinar'),
  (613, 9, 'Verbos regulares', 'Hate', 'Odiar'),
  (614, 9, 'Verbos regulares', 'Help', 'Ayudar'),
  (615, 9, 'Verbos regulares', 'Hope', 'Esperar'),
  (616, 9, 'Verbos regulares', 'Improve', 'Mejorar'),
  (617, 9, 'Verbos regulares', 'Include', 'Incluir'),
  (618, 9, 'Verbos regulares', 'Inform', 'Informar'),
  (619, 9, 'Verbos regulares', 'Introduce', 'Presentar'),
  (620, 9, 'Verbos regulares', 'Jump', 'Saltar'),
  (621, 9, 'Verbos regulares', 'Keep', 'Mantener'),
  (622, 9, 'Verbos regulares', 'Kick', 'Patear'),
  (623, 9, 'Verbos regulares', 'Kiss', 'Besar'),
  (624, 9, 'Verbos regulares', 'Laugh', 'Reír'),
  (625, 9, 'Verbos regulares', 'Learn', 'Aprender'),
  (626, 9, 'Verbos regulares', 'Like', 'Gustar'),
  (627, 9, 'Verbos regulares', 'Listen', 'Escuchar'),
  (628, 9, 'Verbos regulares', 'Live', 'Vivir'),
  (629, 9, 'Verbos regulares', 'Look', 'Mirar'),
  (630, 9, 'Verbos regulares', 'Love', 'Amar'),
  (631, 9, 'Verbos regulares', 'Manage', 'Gestionar'),
  (632, 9, 'Verbos regulares', 'Move', 'Mover'),
  (633, 9, 'Verbos regulares', 'Need', 'Necesitar'),
  (634, 9, 'Verbos regulares', 'Open', 'Abrir'),
  (635, 9, 'Verbos regulares', 'Paint', 'Pintar'),
  (636, 9, 'Verbos regulares', 'Play', 'Jugar'),
  (637, 9, 'Verbos regulares', 'Prepare', 'Preparar'),
  (638, 9, 'Verbos regulares', 'Pull', 'Tirar (hacia ti)'),
  (639, 9, 'Verbos regulares', 'Push', 'Empujar'),
  (640, 9, 'Verbos regulares', 'Reach', 'Alcanzar'),
  (641, 9, 'Verbos regulares', 'Remember', 'Recordar'),
  (642, 9, 'Verbos regulares', 'Repair', 'Reparar'),
  (643, 9, 'Verbos regulares', 'Return', 'Regresar'),
  (644, 9, 'Verbos regulares', 'Shout', 'Gritar'),
  (645, 9, 'Verbos regulares', 'Smile', 'Sonreír'),
  (646, 9, 'Verbos regulares', 'Start', 'Empezar'),
  (647, 9, 'Verbos regulares', 'Study', 'Estudiar'),
  (648, 9, 'Verbos regulares', 'Succeed', 'Tener éxito'),
  (649, 9, 'Verbos regulares', 'Talk', 'Hablar'),
  (650, 9, 'Verbos regulares', 'Travel', 'Viajar'),
  (651, 9, 'Verbos regulares', 'Try', 'Intentar'),
  (652, 9, 'Verbos regulares', 'Turn', 'Girar'),
  (653, 9, 'Verbos regulares', 'Use', 'Usar'),
  (654, 9, 'Verbos regulares', 'Visit', 'Visitar'),
  (655, 9, 'Verbos regulares', 'Wait', 'Esperar'),
  (656, 9, 'Verbos regulares', 'Walk', 'Caminar'),
  (657, 9, 'Verbos regulares', 'Want', 'Querer'),
  (658, 9, 'Verbos regulares', 'Watch', 'Mirar'),
  (659, 9, 'Verbos regulares', 'Work', 'Trabajar'),
  (660, 9, 'Verbos regulares', 'Yell', 'Gritar'),
  (661, 9, 'Verbos irregulares', 'Arise', 'Surgir'),
  (662, 9, 'Verbos irregulares', 'Awake', 'Despertar'),
  (663, 9, 'Verbos irregulares', 'Be', 'Ser/Estar'),
  (664, 9, 'Verbos irregulares', 'Bear', 'Soportar/Parir'),
  (665, 9, 'Verbos irregulares', 'Beat', 'Golpear/Vencer'),
  (666, 9, 'Verbos irregulares', 'Become', 'Llegar a ser'),
  (667, 9, 'Verbos irregulares', 'Begin', 'Empezar'),
  (668, 9, 'Verbos irregulares', 'Bend', 'Doblar/Curvarse'),
  (669, 9, 'Verbos irregulares', 'Bet', 'Apostar'),
  (670, 9, 'Verbos irregulares', 'Bind', 'Atar'),
  (671, 9, 'Verbos irregulares', 'Bite', 'Morder'),
  (672, 9, 'Verbos irregulares', 'Bleed', 'Sangrar'),
  (673, 9, 'Verbos irregulares', 'Blow', 'Soplar'),
  (674, 9, 'Verbos irregulares', 'Break', 'Romper'),
  (675, 9, 'Verbos irregulares', 'Bring', 'Traer'),
  (676, 9, 'Verbos irregulares', 'Build', 'Construir'),
  (677, 9, 'Verbos irregulares', 'Burn', 'Quemar'),
  (678, 9, 'Verbos irregulares', 'Buy', 'Comprar'),
  (679, 9, 'Verbos irregulares', 'Cast', 'Echar/Lanzar'),
  (680, 9, 'Verbos irregulares', 'Catch', 'Atrapar'),
  (681, 9, 'Verbos irregulares', 'Choose', 'Elegir'),
  (682, 9, 'Verbos irregulares', 'Come', 'Venir'),
  (683, 9, 'Verbos irregulares', 'Cost', 'Costar'),
  (684, 9, 'Verbos irregulares', 'Creep', 'Arrastrarse'),
  (685, 9, 'Verbos irregulares', 'Cut', 'Cortar'),
  (686, 9, 'Verbos irregulares', 'Deal', 'Tratar/Repartir'),
  (687, 9, 'Verbos irregulares', 'Dig', 'Cavar'),
  (688, 9, 'Verbos irregulares', 'Do', 'Hacer'),
  (689, 9, 'Verbos irregulares', 'Draw', 'Dibujar/Tirar de'),
  (690, 9, 'Verbos irregulares', 'Dream', 'Soñar'),
  (691, 9, 'Verbos irregulares', 'Drink', 'Beber'),
  (692, 9, 'Verbos irregulares', 'Drive', 'Conducir'),
  (693, 9, 'Verbos irregulares', 'Eat', 'Comer'),
  (694, 9, 'Verbos irregulares', 'Fall', 'Caer'),
  (695, 9, 'Verbos irregulares', 'Feed', 'Alimentar'),
  (696, 9, 'Verbos irregulares', 'Feel', 'Sentir'),
  (697, 9, 'Verbos irregulares', 'Fight', 'Pelear'),
  (698, 9, 'Verbos irregulares', 'Find', 'Encontrar'),
  (699, 9, 'Verbos irregulares', 'Fly', 'Volar'),
  (700, 9, 'Verbos irregulares', 'Forbid', 'Prohibir'),
  (701, 9, 'Verbos irregulares', 'Forget', 'Olvidar'),
  (702, 9, 'Verbos irregulares', 'Forgive', 'Perdonar'),
  (703, 9, 'Verbos irregulares', 'Freeze', 'Congelar'),
  (704, 9, 'Verbos irregulares', 'Get', 'Obtener'),
  (705, 9, 'Verbos irregulares', 'Give', 'Dar'),
  (706, 9, 'Verbos irregulares', 'Go', 'Ir'),
  (707, 9, 'Verbos irregulares', 'Grow', 'Crecer'),
  (708, 9, 'Verbos irregulares', 'Hang', 'Colgar'),
  (709, 9, 'Verbos irregulares', 'Have', 'Tener'),
  (710, 9, 'Verbos irregulares', 'Hear', 'Oír'),
  (711, 9, 'Verbos irregulares', 'Hide', 'Esconder'),
  (712, 9, 'Verbos irregulares', 'Hit', 'Golpear'),
  (713, 9, 'Verbos irregulares', 'Hold', 'Sostener'),
  (714, 9, 'Verbos irregulares', 'Hurt', 'Herir'),
  (715, 9, 'Verbos irregulares', 'Keep', 'Mantener'),
  (716, 9, 'Verbos irregulares', 'Know', 'Saber/Conocer'),
  (717, 9, 'Verbos irregulares', 'Lay', 'Colocar/Poner'),
  (718, 9, 'Verbos irregulares', 'Lead', 'Liderar/Guiar'),
  (719, 9, 'Verbos irregulares', 'Learn', 'Aprender'),
  (720, 9, 'Verbos irregulares', 'Leave', 'Dejar/Salir'),
  (721, 9, 'Verbos irregulares', 'Lend', 'Prestar'),
  (722, 9, 'Verbos irregulares', 'Let', 'Permitir'),
  (723, 9, 'Verbos irregulares', 'Lie', 'Mentir/Reclinarse'),
  (724, 9, 'Verbos irregulares', 'Lose', 'Perder'),
  (725, 9, 'Verbos irregulares', 'Make', 'Hacer/Fabricar'),
  (726, 9, 'Verbos irregulares', 'Mean', 'Significar/Querer decir'),
  (727, 9, 'Verbos irregulares', 'Meet', 'Conocer/Encontrarse'),
  (728, 9, 'Verbos irregulares', 'Pay', 'Pagar'),
  (729, 9, 'Verbos irregulares', 'Put', 'Poner'),
  (730, 9, 'Verbos irregulares', 'Read', 'Leer'),
  (731, 9, 'Verbos irregulares', 'Ride', 'Montar'),
  (732, 9, 'Verbos irregulares', 'Ring', 'Sonar/Llamar'),
  (733, 9, 'Verbos irregulares', 'Rise', 'Levantarse/Surgir'),
  (734, 9, 'Verbos irregulares', 'Run', 'Correr'),
  (735, 9, 'Verbos irregulares', 'Say', 'Decir'),
  (736, 9, 'Verbos irregulares', 'See', 'Ver'),
  (737, 9, 'Verbos irregulares', 'Seek', 'Buscar'),
  (738, 9, 'Verbos irregulares', 'Sell', 'Vender'),
  (739, 9, 'Verbos irregulares', 'Send', 'Enviar'),
  (740, 9, 'Verbos irregulares', 'Set', 'Poner/Fijar/Acomodar'),
  (741, 9, 'Verbos irregulares', 'Shake', 'Sacudir'),
  (742, 9, 'Verbos irregulares', 'Shine', 'Brillar'),
  (743, 9, 'Verbos irregulares', 'Shoot', 'Disparar'),
  (744, 9, 'Verbos irregulares', 'Show', 'Mostrar'),
  (745, 9, 'Verbos irregulares', 'Shut', 'Cerrar'),
  (746, 9, 'Verbos irregulares', 'Sing', 'Cantar'),
  (747, 9, 'Verbos irregulares', 'Sink', 'Hundir'),
  (748, 9, 'Verbos irregulares', 'Sit', 'Sentarse'),
  (749, 9, 'Verbos irregulares', 'Sleep', 'Dormir'),
  (750, 9, 'Verbos irregulares', 'Speak', 'Hablar'),
  (751, 9, 'Verbos irregulares', 'Spend', 'Gastar'),
  (752, 9, 'Verbos irregulares', 'Stand', 'Pararse'),
  (753, 9, 'Verbos irregulares', 'Steal', 'Robar'),
  (754, 9, 'Verbos irregulares', 'Swear', 'Jurar'),
  (755, 9, 'Verbos irregulares', 'Sweep', 'Barrer'),
  (756, 9, 'Verbos irregulares', 'Swim', 'Nadar'),
  (757, 9, 'Verbos irregulares', 'Swing', 'Columpiar'),
  (758, 9, 'Verbos irregulares', 'Take', 'Tomar/Agarrar'),
  (759, 9, 'Verbos irregulares', 'Teach', 'Enseñar'),
  (760, 9, 'Verbos irregulares', 'Tear', 'Romper (rasgar)'),
  (761, 9, 'Verbos irregulares', 'Tell', 'Decir/Contar'),
  (762, 9, 'Verbos irregulares', 'Think', 'Pensar'),
  (763, 9, 'Verbos irregulares', 'Throw', 'Arrojar/Lanzar'),
  (764, 9, 'Verbos irregulares', 'Understand', 'Entender'),
  (765, 9, 'Verbos irregulares', 'Wake', 'Despertar'),
  (766, 9, 'Verbos irregulares', 'Wear', 'Vestir/Usar (ropa)'),
  (767, 9, 'Verbos irregulares', 'Weep', 'Llorar'),
  (768, 9, 'Verbos irregulares', 'Win', 'Ganar'),
  (769, 9, 'Verbos irregulares', 'Write', 'Escribir')
on conflict (id) do update set lesson_id = excluded.lesson_id, categoria = excluded.categoria,
  ingles = excluded.ingles, espanol = excluded.espanol;

-- Los ids nuevos siguen después del más alto cargado.
select setval(pg_get_serial_sequence('public.vocabulary', 'id'), (select coalesce(max(id), 1) from public.vocabulary));

commit;

-- Comprobación: debería mostrar 2 | 10 | 769
select (select count(*) from public.books) as libros,
       (select count(*) from public.lessons) as lecciones,
       (select count(*) from public.vocabulary) as palabras;
