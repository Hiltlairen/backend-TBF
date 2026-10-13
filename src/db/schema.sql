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
