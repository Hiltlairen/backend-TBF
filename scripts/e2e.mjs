// ============================================================
// e2e.mjs — Prueba de extremo a extremo SIN gastar tokens
// ============================================================
// Intercepta las llamadas a generativelanguage.googleapis.com y
// devuelve actividades fabricadas que cumplen los esquemas. Sirve
// para verificar el grafo, las rutas, los roles y el flujo del
// estudiante sin necesitar una API Key real.
//
//   node scripts/e2e.mjs
// ============================================================
process.env.GEMINI_API_KEY = 'fake-para-pruebas'
process.env.DATA_DIR = './data-e2e'
process.env.PORT = '4111'
process.env.DEEPSEEK_API_KEY = ''       // el e2e usa Gemini simulado
process.env.LOGIN_CODIGO_EMAIL = 'false' // login directo (el de 2 pasos tiene su propio test)
process.env.TURNSTILE_SECRET_KEY = ''
process.env.GEMINI_ESPERA_MIN_MS = '0'  // Gemini es un mock: sin pausa entre llamadas
process.env.GEMINI_ESPERA_MAX_MS = '0'

// Empieza siempre de cero: si quedara la caché de una corrida anterior,
// el conteo de llamadas a Gemini daría 0 y la prueba mentiría.
const { rmSync } = await import('node:fs')
rmSync(process.env.DATA_DIR, { recursive: true, force: true })

const realFetch = globalThis.fetch
let llamadasGemini = 0

// ── Fábricas de actividades válidas ────────────────────────
const META = (id, titulo, spec) => ({
  id, titulo, instrucciones: 'Test instructions.', nivel: 'A2', leccion: 'L1',
  tiempo_limite: spec.tiempo, puntuacion_maxima: 100, penalizacion_por_error: spec.penalizacion,
  escenario: spec.escenario, interaccion: spec.interaccion, presencia: spec.presencia,
})

const FABRICA = {
  '01-emparejar': (s) => ({
    actividad: META('01-emparejar', 'Match the words', s),
    columna_izquierda: { tipo: 'texto', items: [1, 2, 3, 4].map((n) => ({ id: `L${n}`, tipo: 'texto', contenido: `clue ${n}` })) },
    columna_derecha:   { tipo: 'texto', items: [1, 2, 3, 4].map((n) => ({ id: `R${n}`, tipo: 'texto', contenido: `word ${n}` })) },
    pares_correctos: [
      { izquierda: 'L1', derecha: 'R3' }, { izquierda: 'L2', derecha: 'R1' },
      { izquierda: 'L3', derecha: 'R4' }, { izquierda: 'L4', derecha: 'R2' },
    ],
  }),
  '04-sopa-letras': (s) => ({
    actividad: META('04-sopa-letras', 'Word Search', s),
    configuracion: { filas: 10, columnas: 10, direcciones: ['horizontal', 'vertical'], mayusculas: true },
    palabras: ['BOOK', 'TABLE', 'CHAIR', 'WATER', 'HOUSE'].map((w) => ({ palabra: w, pista: `A ${w.toLowerCase()}` })),
  }),
  '06-diccionario': (s) => ({
    actividad: META('06-diccionario', 'Translate it!', s),
    entradas: [['libro', 'book'], ['mesa', 'table'], ['agua', 'water'], ['casa', 'house']].map(([es, en], i) => ({
      id: `D${i + 1}`, tipo_entrada: 'texto', contenido: es, idioma_entrada: 'es',
      respuesta_correcta: en, alternativas_aceptadas: [],
    })),
  }),
  '02-conversacion-completar': (s) => ({
    actividad: META('02-conversacion-completar', 'Complete the conversation', s),
    conversacion: [
      { id: 't1', hablante: 'Tom', avatar: null, tipo: 'fijo', texto: 'Where do you live?' },
      { id: 't2', hablante: 'You', avatar: null, tipo: 'opciones', plantilla: 'I live in a {blank}.',
        opciones: [{ id: 'o1', texto: 'house', correcta: true }, { id: 'o2', texto: 'water', correcta: false }, { id: 'o3', texto: 'book', correcta: false }] },
      { id: 't3', hablante: 'Tom', avatar: null, tipo: 'fijo', texto: 'Do you read a lot?' },
      { id: 't4', hablante: 'You', avatar: null, tipo: 'opciones', plantilla: 'Yes, I love every {blank}.',
        opciones: [{ id: 'o4', texto: 'book', correcta: true }, { id: 'o5', texto: 'chair', correcta: false }, { id: 'o6', texto: 'table', correcta: false }] },
    ],
    audio_conversacion: null,
  }),
  '12-llamada': (s) => ({
    actividad: META('12-llamada', 'Answer the call', s),
    llamante: { nombre: 'Sarah', motivo: 'She wants to meet.' },
    turnos: [
      { id: 'C1', hablante: 'caller', texto: 'Hi! Are you free today?' },
      { id: 'C2', hablante: 'You', tipo: 'opciones', opciones: [
        { id: 'C2A', texto: 'Yes, I am free after five.', correcta: true },
        { id: 'C2B', texto: 'I am a table.', correcta: false },
        { id: 'C2C', texto: 'Water house book.', correcta: false }] },
      { id: 'C3', hablante: 'caller', texto: 'Great, where do we meet?' },
      { id: 'C4', hablante: 'You', tipo: 'opciones', opciones: [
        { id: 'C4A', texto: 'At my house, please.', correcta: true },
        { id: 'C4B', texto: 'Chair the water.', correcta: false },
        { id: 'C4C', texto: 'Book table now.', correcta: false }] },
    ],
  }),
}

// La canción (10) no la escribe la IA: sale de LRCLIB (simulado aquí).
const LETRA = { id: 77, trackName: 'Morning Light', artistName: 'Original', albumName: null, duration: 90, instrumental: false,
  plainLyrics: 'x', syncedLyrics: [
    '[00:05.00]Open the window and read your book', '[00:10.00]Morning light is coming home',
    '[00:15.00]Open the window and read your book', '[00:20.00]Morning light is coming home',
  ].join('\n') }
const CANCION = { fuente: 'lrclib', id: '77', audio: { tipo: 'youtube', ref: 'https://youtu.be/dQw4w9WgXcQ' } }

const BIBLE = {
  tema: 'A day in the city', protagonista: 'Ana', npc: 'Tom', nivel: 'A2',
  lexico: [{ en: 'book', es: 'libro', cat: 'objects' }, { en: 'house', es: 'casa', cat: 'places' }],
  lexico_verbos: ['read', 'live'], frases_clave: ['I live in…'], notas_escena: {},
}

// ── Interceptor ────────────────────────────────────────────
globalThis.fetch = async (url, opciones) => {
  const u = String(url)
  if (u.startsWith('https://lrclib.net/api/get/77')) return Response.json(LETRA)
  if (!u.includes('generativelanguage.googleapis.com')) return realFetch(url, opciones)

  llamadasGemini += 1
  const prompt = JSON.parse(opciones.body).contents[0].parts[0].text

  let payload
  if (prompt.includes('tutor de inglés')) {
    payload = { resumen: 'Confundes palabras parecidas.', consejos: [{ tema: 'Repasa', explicacion: 'book = libro' }], animo: '¡Sigue así!' }
  } else if (prompt.includes('story bible')) {
    payload = BIBLE
  } else {
    // Extrae los códigos y su spec de la sección "REQUESTED:"
    const pedidos = [...prompt.matchAll(
      /- (\S+) → (\d+) items \| scene "([^"]+)" \| interaction "([^"]+)" \| presence "([^"]+)" \| tiempo_limite (\d+) \| penalizacion_por_error (\d+)/g
    )]
    const actividades = {}
    for (const [, codigo, , escenario, interaccion, presencia, tiempo, penalizacion] of pedidos) {
      const fab = FABRICA[codigo]
      if (fab) actividades[codigo] = fab({ escenario, interaccion, presencia, tiempo: +tiempo, penalizacion: +penalizacion })
    }
    payload = { actividades }
  }

  return new Response(JSON.stringify({
    candidates: [{ content: { parts: [{ text: JSON.stringify(payload) }] } }],
    usageMetadata: { promptTokenCount: 1200, candidatesTokenCount: 2400 },
  }), { status: 200, headers: { 'Content-Type': 'application/json' } })
}

// ── Arranca el servidor ────────────────────────────────────
// index.js YA NO se auto-arranca solo por importarse (punto 6: así
// los tests automatizados de test/ pueden traer `app` sin abrir un
// puerto real) — así que acá se llama a `arrancar()` explícito.
const { arrancar } = await import('../src/index.js')
await arrancar()
await new Promise((r) => setTimeout(r, 600))

// ── Utilidades HTTP ────────────────────────────────────────
const BASE = 'http://127.0.0.1:4111'
const req = async (metodo, ruta, cuerpo, token) => {
  const res = await realFetch(BASE + ruta, {
    method: metodo,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: cuerpo ? JSON.stringify(cuerpo) : undefined,
  })
  return { estado: res.status, datos: await res.json().catch(() => null) }
}

let fallos = 0
const check = (etiqueta, condicion, extra = '') => {
  console.log(`${condicion ? '  ok  ' : '  FALLO'} ${etiqueta}${extra ? ` — ${extra}` : ''}`)
  if (!condicion) fallos++
}

console.log('\n════ PRUEBA END-TO-END ════\n')

// 1. Autenticación y roles
console.log('1) Autenticación y roles')
const docente = await req('POST', '/api/auth/login', { email: 'docente@englishlessons.edu', password: 'Docente*2026' })
check('login docente', docente.estado === 200 && docente.datos.usuario.rol === 'docente')
const tokDoc = docente.datos.token

const curador = await req('POST', '/api/auth/login', { email: 'curaduria@englishlessons.edu', password: 'Curador*2026' })
check('login curador', curador.estado === 200 && curador.datos.usuario.rol === 'curador')
const tokCur = curador.datos.token

const admin = await req('POST', '/api/auth/login', { email: 'admin@englishlessons.edu', password: 'Admin*2026' })
check('login admin', admin.estado === 200)
const tokAdm = admin.datos.token

check('contraseña incorrecta → 401', (await req('POST', '/api/auth/login', { email: 'docente@englishlessons.edu', password: 'x' })).estado === 401)
check('sin token → 401', (await req('GET', '/api/library/libros')).estado === 401)
check('curador no puede generar → 403', (await req('POST', '/api/activities/generar', { codigo: '01-emparejar', lecciones: [1] }, tokCur)).estado === 403)
check('docente no entra a admin → 403', (await req('GET', '/api/admin/usuarios', null, tokDoc)).estado === 403)
check('admin sí entra', (await req('GET', '/api/admin/usuarios', null, tokAdm)).estado === 200)

// La clase del docente: el curso de las actividades es su nombre, y de
// sus 30 estudiantes sale cuántas variantes se generan (con IA, 10).
const docentes = await req('GET', '/api/clases/docentes', null, tokAdm)
const idDocente = docentes.datos.docentes.find((d) => d.email === 'docente@englishlessons.edu').id
const clase = await req('POST', '/api/clases', { nombre: '3° B - Mañana', docenteId: idDocente, bookId: 1 }, tokAdm)
const claseId = clase.datos.clase.id
const roster = await req('POST', `/api/clases/${claseId}/estudiantes`,
  { filas: Array.from({ length: 30 }, (_, i) => ({ nombre: `Estudiante ${i + 1}` })) }, tokAdm)
check('el admin crea la clase con 30 estudiantes', roster.estado === 201 && roster.datos.estudiantes.length === 30)
// Cada estudiante entra con su doble código: el de la sala y su matrícula.
const matriculas = roster.datos.estudiantes.map((e) => e.codigo_matricula)
const VARIANTES = 10

// 2. Modo simple
console.log('\n2) Modo simple (una actividad, sin juego)')
llamadasGemini = 0
check('sin clase no se puede generar → 400',
  (await req('POST', '/api/activities/generar', { codigo: '01-emparejar', lecciones: [1, 2] }, tokDoc)).estado === 400)
const simple = await req('POST', '/api/activities/generar', {
  codigo: '01-emparejar', lecciones: [1, 2], claseId,
}, tokDoc)
check('genera actividad simple', simple.estado === 201, `${llamadasGemini} llamada(s)`)
check('contenido válido', Boolean(simple.datos?.actividad?.contenido?.pares_correctos?.length))
check('el curso es el nombre de la clase', simple.datos?.actividad?.curso === '3° B - Mañana')
check(`${VARIANTES} variantes para 30 estudiantes`, simple.datos?.actividad?.variantes?.length === VARIANTES)
check('bible una vez + un lote por variante', llamadasGemini === 1 + VARIANTES, `fueron ${llamadasGemini}`)

const salaSimple = await req('POST', '/api/rooms', { modo: 'simple', actividadId: simple.datos.actividad.id }, tokDoc)
check('crea sala simple', salaSimple.estado === 201 && /^\d{5}$/.test(salaSimple.datos.sala.codigo),
  `código ${salaSimple.datos?.sala?.codigo}`)

// 3. Modo aventura
console.log('\n3) Modo aventura (LangGraph)')
llamadasGemini = 0
const codigos = ['01-emparejar', '04-sopa-letras', '06-diccionario', '02-conversacion-completar', '12-llamada', '10-canciones']
const aventura = await req('POST', '/api/activities/generar-ruta', {
  actividades: codigos, lecciones: [1, 2], claseId, configs: { '10-canciones': { cancion: CANCION } },
}, tokDoc)
check('genera la aventura', aventura.estado === 201, aventura.datos?.error ?? '')
check('6 actividades generadas', Object.keys(aventura.datos?.ruta?.contenidos ?? {}).length === 6)
check(`${VARIANTES} variantes de la aventura, cada una con las 6`,
  aventura.datos?.ruta?.variantes?.length === VARIANTES &&
  aventura.datos.ruta.variantes.every((v) => Object.keys(v).length === 6))
// Las 6 actividades de cada variante van en UNA llamada (no 6), y el
// bible se pide una sola vez para todas las variantes.
check(`${1 + VARIANTES} llamadas para ${VARIANTES} variantes × 6 actividades`, llamadasGemini === 1 + VARIANTES, `fueron ${llamadasGemini}`)
check('18 nodos en el grafo', Object.keys(aventura.datos?.ruta?.ruta?.nodos ?? {}).length === 18)

// Caché: repetir la misma combinación no debe llamar a Gemini
llamadasGemini = 0
const cacheado = await req('POST', '/api/activities/generar-ruta', { actividades: codigos, lecciones: [1, 2], claseId, configs: { '10-canciones': { cancion: CANCION } } }, tokDoc)
check('la caché evita regenerar', cacheado.estado === 201 && llamadasGemini === 0, `HTTP ${cacheado.estado}, ${llamadasGemini} llamada(s)`)

const salaJuego = await req('POST', '/api/rooms', { modo: 'juego', rutaId: aventura.datos.ruta.id }, tokDoc)
check('crea sala de aventura', salaJuego.estado === 201)
const codigoSala = salaJuego.datos.sala.codigo

// 4. Estudiante sin cuenta
console.log('\n4) Estudiante (sin cuenta, con código)')
check('código inválido → 404', (await req('POST', '/api/auth/invitado', { codigo: '00000', nombre: 'X' })).estado === 404)

check('la sala pide la matrícula (no un nombre libre)',
  (await req('POST', '/api/auth/invitado', { codigo: codigoSala, nombre: 'María Pérez' })).estado === 400)
const invitado = await req('POST', '/api/auth/invitado', { codigo: codigoSala, codigoMatricula: matriculas.shift() })
check('canjea el código', invitado.estado === 200 && Boolean(invitado.datos.token))
let tokAlu = invitado.datos.token

const inicio = await req('POST', '/api/game/iniciar', { codigo: codigoSala }, tokAlu)
check('inicia la partida', inicio.estado === 200 && inicio.datos.modo === 'juego')
check('devuelve la primera escena', Boolean(inicio.datos.escena?.escena?.render))
check('escena sin fondo, con gradiente',
  inicio.datos.escena.escena.render.usarFondo === false && Boolean(inicio.datos.escena.escena.render.gradiente))
tokAlu = inicio.datos.token
const partidaId = inicio.datos.partidaId

// 5. Ramificación por puntaje
console.log('\n5) Ramificación por puntaje')
// El servidor calcula la nota a partir de las RESPUESTAS, así que para
// forzar una ruta "buena" o "mala" hay que responder bien o mal de verdad.
function respuestasPara(codigo, d, bien) {
  const elegir = (opciones) => (opciones.find((o) => (o.correcta === true) === bien) ?? opciones[0]).texto
  switch (codigo) {
    case '01-emparejar': {
      const pares = d.pares_correctos.map((p) => ({ izq: p.izquierda, der: p.derecha }))
      const errores = bien ? [] : Array.from({ length: 7 }, () => ({ izq: pares[0].izq, der: 'R-falso' }))
      return { intentos: [...errores, ...pares] }
    }
    case '04-sopa-letras': {
      const palabras = d.palabras.map((p) => p.palabra)
      return { colocadas: palabras, encontradas: bien ? palabras : palabras.slice(0, 1) }
    }
    case '06-diccionario':
      return { items: d.entradas.map((e, i) => ({ i, texto: bien ? e.respuesta_correcta : 'no sé' })) }
    case '02-conversacion-completar':
      return { items: d.conversacion.filter((t) => t.tipo === 'opciones').map((t, i) => ({ i, opcion: elegir(t.opciones) })) }
    case '12-llamada':
      return { items: d.turnos.filter((t) => t.tipo === 'opciones').map((t, i) => ({ i, opcion: elegir(t.opciones) })) }
    case '10-canciones':
      return { huecos: Object.fromEntries(d.huecos.map((h) => [h.id, bien ? h.respuesta : 'zzz'])) }
    default:
      return {}
  }
}

async function jugar(bien) {
  const inv = await req('POST', '/api/auth/invitado', { codigo: codigoSala, codigoMatricula: matriculas.shift() })
  const ini = await req('POST', '/api/game/iniciar', { codigo: codigoSala }, inv.datos.token)
  let tok = ini.datos.token
  const recorrido = [`${ini.datos.escena.actividad.codigo}@${ini.datos.escena.escena.id}`]
  let pid = ini.datos.partidaId
  let actividad = ini.datos.escena.actividad

  for (let etapa = 0; etapa < 6; etapa++) {
    const respuestas = respuestasPara(actividad.codigo, actividad.contenido, bien)
    const r = await req('POST', '/api/game/avanzar', { partidaId: pid, respuestas }, tok)
    if (r.datos?.fin) return { recorrido, final: r.datos }
    if (!r.datos?.escena) return { recorrido, error: r.datos?.error ?? `HTTP ${r.estado}` }
    recorrido.push(`${r.datos.escena.actividad.codigo}@${r.datos.escena.escena.id}`)
    actividad = r.datos.escena.actividad
  }
  return { recorrido }
}

const bueno = await jugar(true)
const malo  = await jugar(false)
console.log('   ruta con puntajes altos:', bueno.recorrido.join(' → '))
console.log('   ruta con puntajes bajos:', malo.recorrido.join(' → '))
check('ambas rutas tienen 6 etapas', bueno.recorrido.length === 6 && malo.recorrido.length === 6)
check('las rutas son distintas', bueno.recorrido.join() !== malo.recorrido.join())
check('la aventura termina y calcula promedio', bueno.final?.puntajeTotal >= 80, `${bueno.final?.puntajeTotal}`)
check('al final trae el repaso de errores', malo.final?.repaso?.errores?.length > 0 && bueno.final?.repaso?.errores?.length === 0,
  `${malo.final?.repaso?.errores?.length} errores (malo) / ${bueno.final?.repaso?.errores?.length} (bueno)`)
check('el repaso trae una ronda de práctica', malo.final?.repaso?.ronda?.length > 0)
check('la canción siempre cae en karaoke',
  [...bueno.recorrido, ...malo.recorrido].filter((x) => x.startsWith('10-canciones')).every((x) => x.endsWith('@karaoke')))
// Verificación real de los parámetros de escena: quién está presente
const nodos = Object.values(aventura.datos.ruta.ruta.nodos)
const nodoLlamada = nodos.find((n) => n.actividad === '12-llamada')
const nodoCara = nodos.find((n) => n.actividad === '02-conversacion-completar')
check('12-llamada se marca como presencia remota por celular',
  nodoLlamada?.presencia === 'remota_telefono', nodoLlamada?.escenario)
check('02-conversacion-completar se marca como presencia física',
  nodoCara?.presencia === 'fisica', nodoCara?.escenario)

const escenaLlamada = await req('GET', `/api/activities/escenarios`, null, tokDoc)
const casaLlamada = escenaLlamada.datos.escenarios.find((e) => e.id === 'casa_llamada')
const cafeteria = escenaLlamada.datos.escenarios.find((e) => e.id === 'cafeteria')
check('la escena de llamada NO dibuja NPC', casaLlamada?.render?.dibujarNpc === false)
check('la escena de cafetería SÍ dibuja NPC', cafeteria?.render?.dibujarNpc === true)
check('el canal de la llamada es "telefono"', casaLlamada?.render?.canal === 'telefono')

// 6. Resultados y curaduría
console.log('\n6) Resultados y curaduría')
const resultados = await req('GET', '/api/results', null, tokDoc)
check('el docente ve los resultados', resultados.estado === 200 && resultados.datos.resultados.length >= 2,
  `${resultados.datos?.resultados?.length} filas`)
check('guarda el recorrido completo', Boolean(resultados.datos.resultados[0]?.historial?.length))

check('una categoría que la lección no tiene se rechaza',
  (await req('POST', '/api/library/vocabulario', { lesson_id: 1, categoria: 'Inventada', ingles: 'x', espanol: 'x' }, tokDoc)).estado === 400)
const vocab = await req('POST', '/api/library/vocabulario', {
  lesson_id: 1, categoria: 'útiles escolares (school stuff)', ingles: 'skyline', espanol: 'horizonte',
}, tokDoc)
check('el docente sube vocabulario', vocab.estado === 201)
check('y entra a curaduría', vocab.datos.enCuraduria === true)

const cola = await req('GET', '/api/review/cola?estado=pendiente', null, tokCur)
check('el curador ve la cola', cola.estado === 200 && cola.datos.items.length >= 1,
  `${cola.datos?.items?.length} pendiente(s)`)

const decision = await req('POST', `/api/review/${cola.datos.items[0].id}/decidir`, {
  decision: 'aprobar', comentario: 'Correcto.',
}, tokCur)
check('aprueba el item', decision.estado === 200 && decision.datos.item.estado === 'aprobado')
check('no se puede revisar dos veces',
  (await req('POST', `/api/review/${cola.datos.items[0].id}/decidir`, { decision: 'aprobar' }, tokCur)).estado === 409)

// 7. Aislamiento entre estudiantes
console.log('\n7) Seguridad')
const otro = await req('POST', '/api/auth/invitado', { codigo: codigoSala, codigoMatricula: matriculas.shift() })
check('un alumno no puede avanzar la partida de otro',
  (await req('POST', '/api/game/avanzar', { partidaId, respuestas: {} }, otro.datos.token)).estado === 403)

// La nota la pone el servidor: un puntaje inventado no sirve de nada.
const tramposo = await req('POST', '/api/auth/invitado', { codigo: salaSimple.datos.sala.codigo, codigoMatricula: matriculas.shift() })
const iniTramposo = await req('POST', '/api/game/iniciar', { codigo: salaSimple.datos.sala.codigo }, tramposo.datos.token)
const entregaTrampa = await req('POST', '/api/game/entregar-simple',
  { partidaId: iniTramposo.datos.partidaId, puntaje: 100, puntajeMaximo: 100, respuestas: {} }, iniTramposo.datos.token)
check('un puntaje inventado por el navegador se ignora', entregaTrampa.estado === 200 && entregaTrampa.datos.puntaje === 0,
  `HTTP ${entregaTrampa.estado}, nota ${entregaTrampa.datos?.puntaje}`)
const retro = await req('POST', '/api/game/retroalimentacion', { partidaId: iniTramposo.datos.partidaId }, iniTramposo.datos.token)
check('el tutor IA comenta los errores', retro.estado === 200 && retro.datos.retroalimentacion?.consejos?.length > 0,
  `HTTP ${retro.estado}`)
check('token de invitado no abre el dashboard',
  (await req('GET', '/api/activities', null, otro.datos.token)).estado === 403)

console.log(`\n════ ${fallos === 0 ? 'TODO OK' : `${fallos} FALLO(S)`} ════\n`)
process.exit(fallos === 0 ? 0 : 1)
