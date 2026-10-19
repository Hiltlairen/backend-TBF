// ============================================================
// activityScenes.js — RELACIÓN actividad ↔ escenario
// ============================================================
// Cada actividad queda "marcada" con:
//   escenario        : escenario canónico (el que mejor le queda)
//   escenariosAlt    : alternativas válidas (para que la ruta no se repita)
//   interaccion      : hereda del escenario, pero se declara explícito
//   presencia        : ninguna | fisica | remota_telefono | remota_audio
//   dificultad       : 1..5  (ordena la ruta troncal Y el catálogo)
//   destreza         : vocabulario | gramatica | dialogo | escucha | escritura | produccion
//   apto             : dónde puede aparecer en la ruta
//                      'troncal' | 'refuerzo' | 'remediacion' | 'final'
//
// ── ORDEN DEL ARCHIVO ───────────────────────────────────────
// Las entradas están escritas EN ORDEN DE DIFICULTAD CRECIENTE
// (1 → 5), agrupadas en 5 bloques comentados. Es la misma
// organización que ve el docente en "Crear actividad" (el panel
// agrupa el catálogo en las mismas 5 franjas — ver
// CreateActivityPage.jsx). Si agregas una actividad nueva,
// insértala en el bloque que le corresponde según su dificultad;
// así el archivo y la pantalla del docente cuentan la misma historia.
//
// LAS 10 PRIMERAS (01–10) ya existían en el proyecto original.
// 11–14 se sumaron para cerrar huecos de coherencia (ver
// NOTAS_COHERENCIA). 15–19 son las 5 actividades NUEVAS tipo
// "juego" que se agregaron en esta vuelta — ver el bloque final
// de notas para el porqué de cada una. 20 (básquetbol) se sumó
// después, también como minijuego de vocabulario.
// ============================================================

export const ACTIVITY_SCENES = {

  // ══════════════════════════════════════════════════════
  // NIVEL 1 · BÁSICO — reconocer, sin producir lenguaje
  // ══════════════════════════════════════════════════════

  '01-emparejar': {
    titulo: 'Match the words',
    escenario: 'biblioteca',
    escenariosAlt: ['aula'],
    interaccion: 'ninguna',
    presencia: 'ninguna',
    dificultad: 1,
    destreza: 'vocabulario',
    apto: ['troncal', 'remediacion'],
    guion: 'Camina desde la puerta hasta el estante y saca el celular para revisar sus apuntes.',
  },

  '04-sopa-letras': {
    titulo: 'Word Search',
    escenario: 'parque',
    escenariosAlt: ['aula'],
    interaccion: 'ninguna',
    presencia: 'ninguna',
    dificultad: 1,
    destreza: 'vocabulario',
    apto: ['troncal', 'remediacion'],
    guion: 'Camina hasta la banca, se sienta y juega en el celular.',
  },

  // ══════════════════════════════════════════════════════
  // NIVEL 2 · ELEMENTAL — vocabulario con una sola decisión
  // ══════════════════════════════════════════════════════

  '06-diccionario': {
    titulo: 'Translate it!',
    escenario: 'biblioteca',
    escenariosAlt: ['aula'],
    interaccion: 'ninguna',
    presencia: 'ninguna',
    dificultad: 2,
    destreza: 'vocabulario',
    apto: ['troncal', 'remediacion'],
    guion: 'Consulta el diccionario del celular junto al estante.',
  },

  // Reemplaza a la antigua 07 (Pronunciation Guide). Las actividades que
  // ya se guardaron como '07-pronunciacion' se siguen pudiendo abrir.
  '07-direcciones': {
    titulo: 'Find the way',
    nuevo: true,
    escenario: 'calle',
    escenariosAlt: ['estacion', 'casa_llamada', 'parque'],
    interaccion: 'dialogo_remoto',
    presencia: 'remota_audio',
    dificultad: 3,
    destreza: 'escucha',
    apto: ['troncal', 'refuerzo'],
    requiereRevision: false,
    // Ruta REAL de La Paz (domain/rutasMapa.js): la IA solo escribe las
    // indicaciones y sus 3 opciones, sobre giros y lugares que existen.
    requiereMapa: true,
    guion: 'Se sube al auto y en el celular aparece el mapa real de La Paz, con el auto al centro. Según la lección, sigue las indicaciones que le dan o se las da al conductor, hasta llegar (a la casa de la abuela, a la clase de matemáticas…).',
    formato: 'Una ruta real de 2–6 tramos; en cada esquina 3 opciones (la indicación correcta y dos distractores).',
  },

  '13-pedido': {
    titulo: 'Order at the counter',
    nuevo: true,
    escenario: 'restaurante',
    escenariosAlt: ['recepcion'],
    interaccion: 'transaccion',
    presencia: 'fisica',
    dificultad: 2,
    destreza: 'dialogo',
    apto: ['troncal', 'remediacion'],
    guion: 'Se acerca al mostrador; el mesero espera. Arma el pedido con frases correctas.',
    formato: 'Elegir la frase funcional correcta en 4–6 turnos cortos.',
  },

  '17-emparejar-imagenes': {
    titulo: 'Picture match',
    nuevo: true,
    escenario: 'biblioteca',
    escenariosAlt: ['aula'],
    interaccion: 'ninguna',
    presencia: 'ninguna',
    dificultad: 2,
    destreza: 'vocabulario',
    apto: ['troncal', 'remediacion'],
    guion: 'Revisa las tarjetas ilustradas del estante y empareja cada imagen (o palabra) con su traducción.',
    formato: 'Emparejar dos columnas donde la izquierda puede ser imagen o texto y la derecha es la traducción. ' +
      'Reutiliza la primitiva "Emparejar" de 01-emparejar, con soporte de tarjetas gráficas.',
  },

  '19-impostor': {
    titulo: 'Find the impostor',
    nuevo: true,
    escenario: 'aula',
    escenariosAlt: ['biblioteca'],
    interaccion: 'ninguna',
    presencia: 'ninguna',
    dificultad: 2,
    destreza: 'vocabulario',
    apto: ['troncal', 'remediacion'],
    guion: 'En la pizarra hay tarjetas con imagen y traducción: una de cada seis está mal traducida.',
    formato: 'Matriz fija de 3×2 (6 tarjetas: imagen + traducción). El estudiante identifica la única ' +
      'traducción incorrecta. Varias rondas seguidas, cada una con una matriz nueva.',
  },

  '20-basquetbol': {
    titulo: 'Shoot the hoop',
    nuevo: true,
    escenario: 'cancha',
    escenariosAlt: ['parque'],
    interaccion: 'ninguna',
    presencia: 'ninguna',
    dificultad: 2,
    destreza: 'vocabulario',
    apto: ['troncal', 'remediacion'],
    guion: 'En la cancha, la palabra a traducir está en el tablero del aro. Desde abajo hay 3 posiciones de tiro, ' +
      'cada una con una traducción posible: elige desde dónde lanzar.',
    formato: 'Cada tiro = 1 palabra en el tablero + EXACTAMENTE 3 opciones (1 correcta). Al elegir, el balón sale ' +
      'desde esa posición: si es la correcta encesta; si no, rebota en el aro y se va a un lado.',
  },

  // ══════════════════════════════════════════════════════
  // NIVEL 3 · INTERMEDIO — interacción o secuencia corta
  // ══════════════════════════════════════════════════════

  '02-conversacion-completar': {
    titulo: 'Complete the conversation',
    escenario: 'cafeteria',
    escenariosAlt: ['casa_llamada'], // versión "por celular" si ya se usó la cafetería
    interaccion: 'dialogo_directo',
    presencia: 'fisica',
    dificultad: 3,
    destreza: 'dialogo',
    apto: ['troncal', 'refuerzo'],
    guion: 'Se acerca a la mesa donde lo espera un amigo. La conversación ocurre en el celular como chat.',
  },

  '03-conversation-selection': {
    titulo: 'Pick the right answer',
    escenario: 'calle',
    escenariosAlt: ['recepcion', 'pasillo_llamada'],
    interaccion: 'dialogo_directo',
    presencia: 'fisica',
    dificultad: 3,
    destreza: 'dialogo',
    apto: ['troncal', 'refuerzo'],
    guion: 'Cruza la calle hacia un transeúnte y elige qué responder.',
  },

  '08-inflexion': {
    titulo: 'Change the word!',
    escenario: 'aula',
    escenariosAlt: ['biblioteca'],
    interaccion: 'ninguna',
    presencia: 'ninguna',
    dificultad: 3,
    destreza: 'gramatica',
    apto: ['troncal', 'refuerzo'],
    guion: 'Se para frente a la pizarra y resuelve las transformaciones en el celular.',
  },

  '11-indicaciones': {
    titulo: 'Give directions',
    nuevo: true,
    escenario: 'calle',
    escenariosAlt: ['estacion'],
    interaccion: 'dialogo_directo',
    presencia: 'fisica',
    dificultad: 3,
    destreza: 'dialogo',
    apto: ['troncal', 'refuerzo'],
    guion: 'Un turista lo detiene y le pide cómo llegar. Ordena las instrucciones correctas.',
    formato: 'Ordenar 5–7 pasos de una ruta (turn left, go straight, it\'s on your right…).',
  },

  '14-anuncios': {
    titulo: 'Listen and choose',
    nuevo: true,
    escenario: 'estacion',
    escenariosAlt: ['estudio_radio'],
    interaccion: 'escucha',
    presencia: 'remota_audio',
    dificultad: 3,
    destreza: 'escucha',
    apto: ['refuerzo', 'remediacion'],
    guion: 'Escucha el anuncio del altavoz y elige el andén/hora correctos.',
    formato: 'Texto-a-voz del navegador + 4 preguntas de opción múltiple.',
  },

  '18-armar-escenario': {
    titulo: 'Set the scene',
    nuevo: true,
    escenario: 'taller',
    escenariosAlt: ['dormitorio'],
    interaccion: 'ninguna',
    presencia: 'ninguna',
    dificultad: 3,
    destreza: 'vocabulario',
    apto: ['troncal', 'refuerzo'],
    guion: 'Sobre la mesa del taller hay objetos sueltos: acomoda cada uno en su lugar dentro de la escena y descarta los que no pertenecen.',
    formato: 'Escenario prestablecido con "zonas" marcadas. El estudiante toca un objeto y luego la zona donde va ' +
      '(o lo descarta si no pertenece a la escena). No necesita al personaje/agente: es una vista fija dentro del celular.',
  },

  // ══════════════════════════════════════════════════════
  // NIVEL 4 · AVANZADO — producción guiada o varias reglas
  // ══════════════════════════════════════════════════════

  '09-describir': {
    titulo: 'What do you see?',
    escenario: 'galeria',
    escenariosAlt: ['parque'],
    interaccion: 'ninguna',
    presencia: 'ninguna',
    dificultad: 4,
    destreza: 'produccion',
    apto: ['troncal', 'final'],
    guion: 'Se detiene frente a un cuadro y describe lo que ve.',
  },

  '10-canciones': {
    titulo: 'Fill in the lyrics!',
    escenario: 'karaoke',
    escenariosAlt: [],            // ← bloqueado a propósito: karaoke o nada
    escenarioObligatorio: true,
    interaccion: 'performance',
    presencia: 'ninguna',
    dificultad: 4,
    destreza: 'escucha',
    apto: ['troncal', 'final'],
    // Ya no la escribe la IA: es una canción REAL (letra de LRCLIB) con
    // huecos que se arman en código (domain/cancionHuecos.js) y se
    // califica sola. El docente elige la canción y el audio.
    requiereRevision: false,
    requiereCancion: true,
    guion: 'Sube al escenario, toma el micrófono: suena la canción y completas la letra.',
  },

  '12-llamada': {
    titulo: 'Answer the call',
    nuevo: true,
    escenario: 'casa_llamada',
    escenariosAlt: ['pasillo_llamada'],
    interaccion: 'dialogo_remoto',
    presencia: 'remota_telefono',
    dificultad: 4,
    destreza: 'dialogo',
    apto: ['troncal', 'refuerzo'],
    guion: 'El celular suena. Contesta y responde a un interlocutor que NO está en escena.',
    formato: 'Diálogo por turnos con opciones; el avatar del interlocutor vive dentro del celular.',
  },

  '16-rompecabezas-oracion': {
    titulo: 'Sentence jigsaw',
    nuevo: true,
    escenario: 'taller',
    escenariosAlt: ['biblioteca'],
    interaccion: 'ninguna',
    presencia: 'ninguna',
    dificultad: 4,
    destreza: 'gramatica',
    apto: ['troncal', 'refuerzo'],
    guion: 'Sobre la mesa hay piezas de rompecabezas: arma la oración encajando cada pieza en su lugar.',
    formato: 'Cada palabra es una pieza con forma de rompecabezas (patrón abstracto de color/forma). ' +
      'El estudiante se guía por cómo encajan las piezas Y por la gramática de la oración.',
  },

  // ══════════════════════════════════════════════════════
  // NIVEL 5 · EXPERTO — producción libre o mecánica compleja
  // ══════════════════════════════════════════════════════

  '05-redaccion': {
    titulo: 'My Writing',
    escenario: 'dormitorio',
    // Puede caer en CUALQUIER ambiente de la aventura: la consigna se
    // adapta a lo que pasa ahí (escribirle a alguien, contar lo que leyó…).
    escenariosAlt: [
      'biblioteca', 'cafeteria', 'parque', 'aula', 'galeria', 'calle', 'restaurante',
      'recepcion', 'estacion', 'casa_llamada', 'pasillo_llamada', 'estudio_radio',
    ],
    interaccion: 'ninguna',
    presencia: 'ninguna',
    dificultad: 5,
    destreza: 'escritura',
    apto: ['final'],
    // El agente la califica (solo contexto y escritura correcta) y el
    // docente confirma o ajusta la nota en curaduría.
    requiereRevision: true,
    guion: 'Se detiene y escribe sobre lo que está pasando. Una IA revisa el texto y el docente confirma la nota.',
  },

  '15-laberinto-palabras': {
    titulo: 'Word Maze',
    nuevo: true,
    escenario: 'torre',
    escenariosAlt: [],
    escenarioObligatorio: true,
    interaccion: 'ninguna',
    presencia: 'ninguna',
    dificultad: 5,
    destreza: 'gramatica',
    apto: ['troncal', 'refuerzo'],
    guion: 'Sube a la torre de acertijos: en cada piso debe pisar las palabras en el orden correcto de la ' +
      'oración antes de quedarse sin pasos o sin tiempo.',
    formato: 'Inspirado en Helltaker. Cuadrícula de hasta 20 casillas construida por algoritmo (nunca por Gemini): ' +
      'coloca al personaje en un punto de partida estratégico y calcula los pasos justos para recorrer cada ' +
      'palabra en orden. Pasos limitados por piso; si se acaba el tiempo, se pasa al siguiente piso perdiendo una vida.',
  },
}

// ── Actividades que NO necesitan a la IA ───────────────────
// Se arman solo con pares palabra ↔ traducción del vocabulario de la
// lección: no hay que redactar texto alrededor de la palabra clave
// (diálogos, letras, anuncios, oraciones…). Son las únicas que se
// ofrecen cuando Gemini no está disponible (sin cuota, saturado, sin
// internet): las construye services/generadorLocal.js, a 0 tokens.
// Pronunciación NO entra: el generador local no sabe separar sílabas
// ni dar IPA, y un dato de pronunciación inventado enseña mal.
export const SOLO_VOCABULARIO = new Set([
  '01-emparejar', '04-sopa-letras', '06-diccionario',
  '17-emparejar-imagenes', '19-impostor', '20-basquetbol',
])
// La canción (10) tampoco necesita IA: la letra viene de LRCLIB y los
// huecos se arman en código.
export const requiereIA = (codigo) => !SOLO_VOCABULARIO.has(codigo) && !ACTIVITY_SCENES[codigo]?.requiereCancion

// ── Redacción (05): tipos de texto que puede pedir la consigna ──
export const TIPOS_TEXTO = {
  auto:        'Lo decide la IA según el ambiente',
  mensaje:     'Mensaje a alguien (chat, nota)',
  correo:      'Correo electrónico',
  descripcion: 'Descripción de un lugar, persona u objeto',
  opinion:     'Opinión o reseña',
  relato:      'Relato breve de lo que pasó',
  respuesta:   'Respuesta a algo que leyó o escuchó',
}

export const codigosActividad = () => Object.keys(ACTIVITY_SCENES)
export const getActivityScene = (codigo) => ACTIVITY_SCENES[codigo] ?? null

/**
 * Elige un escenario para una actividad evitando repetir los ya usados.
 * Si la actividad tiene `escenarioObligatorio` (karaoke, torre), lo respeta siempre.
 */
export function elegirEscenario(codigo, usados = []) {
  const a = getActivityScene(codigo)
  if (!a) return null
  if (a.escenarioObligatorio) return a.escenario
  if (!usados.includes(a.escenario)) return a.escenario
  const alt = (a.escenariosAlt || []).find((e) => !usados.includes(e))
  return alt ?? a.escenario
}

// ============================================================
// DIFICULTAD — las mismas 5 franjas que agrupan este archivo
// ============================================================
export const NIVELES_DIFICULTAD = {
  1: 'Básico',
  2: 'Elemental',
  3: 'Intermedio',
  4: 'Avanzado',
  5: 'Experto',
}

export const etiquetaDificultad = (n) => NIVELES_DIFICULTAD[n] ?? `Nivel ${n}`

/** Catálogo completo ordenado de menor a mayor dificultad (lo que ya hace el panel del docente). */
// ============================================================
// QUÉ HACE EL ESTUDIANTE — una línea por actividad, para el panel
// ============================================================
// Lo que ve el docente en cada tarjeta del catálogo (en vez de una
// animación de muestra): qué hace el estudiante, en una frase.
export const RESUMEN_ACTIVIDAD = {
  '01-emparejar':              'Une cada palabra en inglés con su traducción.',
  '04-sopa-letras':            'Busca las palabras de la lección escondidas en una sopa de letras.',
  '06-diccionario':            'Traduce oraciones cortas escribiendo la respuesta.',
  '17-emparejar-imagenes':     'Une cada imagen con su palabra en inglés.',
  '19-impostor':               'Encuentra la única tarjeta mal traducida entre seis.',
  '20-basquetbol':             'Lanza al aro eligiendo la traducción correcta entre tres opciones.',
  '18-armar-escenario':        'Coloca cada objeto en su lugar de la escena y descarta los que no van.',
  '08-inflexion':              'Cambia la forma de la palabra (plural, pasado, -ing…) siguiendo una regla.',
  '16-rompecabezas-oracion':   'Arma oraciones encajando las palabras como piezas de rompecabezas.',
  '15-laberinto-palabras':     'Recorre una cuadrícula pisando las palabras en el orden correcto de la oración.',
  '13-pedido':                 'Pide en un mostrador eligiendo la frase correcta en cada turno.',
  '02-conversacion-completar': 'Completa una conversación eligiendo la frase que falta en cada hueco.',
  '03-conversation-selection': 'Elige la respuesta adecuada en cada turno de un diálogo cara a cara.',
  '11-indicaciones':           'Ordena los pasos para explicarle a un turista cómo llegar a un lugar.',
  '12-llamada':                'Contesta una llamada y responde por turnos a quien habla.',
  '07-direcciones':            'En un mapa real de La Paz, sigue o da indicaciones en inglés para llegar a un lugar.',
  '14-anuncios':               'Escucha un anuncio (estación, aeropuerto…) y responde preguntas.',
  '10-canciones':              'Escucha una canción real y escribe las palabras que faltan en la letra.',
  '09-describir':              'Mira una escena y elige la descripción correcta de lo que ve.',
  '05-redaccion':              'Escribe un texto corto según una situación; la IA lo evalúa y tú confirmas la nota.',
}

// Tipos de actividad (por destreza), en el orden en que se muestran.
// Producción y escritura van juntas: son las dos que piden producir texto.
export const TIPOS_ACTIVIDAD = [
  { id: 'vocabulario', etiqueta: 'Vocabulario', icono: '🔤', descripcion: 'Las palabras de la lección y su traducción.', destrezas: ['vocabulario'] },
  { id: 'gramatica',   etiqueta: 'Gramática',   icono: '🧩', descripcion: 'Formar y transformar oraciones.',             destrezas: ['gramatica'] },
  { id: 'dialogo',     etiqueta: 'Conversación', icono: '💬', descripcion: 'Diálogos de la vida diaria.',                destrezas: ['dialogo'] },
  { id: 'escucha',     etiqueta: 'Escucha',     icono: '🎧', descripcion: 'Entender lo que se oye.',                     destrezas: ['escucha'] },
  { id: 'escritura',   etiqueta: 'Escritura y descripción', icono: '✍️', descripcion: 'Describir y escribir textos propios.', destrezas: ['produccion', 'escritura'] },
]

export function catalogoOrdenadoPorDificultad() {
  return Object.entries(ACTIVITY_SCENES)
    .map(([codigo, a]) => ({ codigo, ...a, resumen: RESUMEN_ACTIVIDAD[codigo] ?? null, requiereIA: requiereIA(codigo) }))
    .sort((a, b) => a.dificultad - b.dificultad || a.titulo.localeCompare(b.titulo))
}

/** Igual que arriba, pero agrupado por franja — listo para pintar secciones en la UI. */
export function catalogoPorFranjas() {
  const plano = catalogoOrdenadoPorDificultad()
  const franjas = [1, 2, 3, 4, 5].map((n) => ({
    dificultad: n,
    etiqueta: etiquetaDificultad(n),
    actividades: plano.filter((a) => a.dificultad === n),
  }))
  return franjas.filter((f) => f.actividades.length > 0)
}

/** Agrupado por tipo de actividad (destreza) y, dentro, de más fácil a más difícil. */
export function catalogoPorTipos() {
  const plano = catalogoOrdenadoPorDificultad()
  return TIPOS_ACTIVIDAD
    .map(({ destrezas, ...t }) => ({ ...t, actividades: plano.filter((a) => destrezas.includes(a.destreza)) }))
    .filter((t) => t.actividades.length > 0)
}

// ============================================================
// PREGUNTAS_CONFIG — cuántos ítems admite cada actividad
// ============================================================
// El docente elige la cantidad SOLO donde tiene sentido. Las
// actividades de formato fijo (una canción, una redacción) no
// se pueden "alargar": su cantidad viene dada por el contenido.
//   configurable : el docente puede mover la cantidad
//   min/max/def  : rango permitido y valor por defecto
//   unidad       : cómo se llama cada ítem (para la UI)
//   motivoFijo   : por qué NO es configurable (si aplica)
// ============================================================
export const PREGUNTAS_CONFIG = {
  '01-emparejar':             { configurable: true,  min: 4, max: 10, def: 6, unidad: 'pares' },
  '02-conversacion-completar':{ configurable: true,  min: 3, max: 8,  def: 6, unidad: 'huecos' },
  '03-conversation-selection':{ configurable: true,  min: 3, max: 8,  def: 4, unidad: 'preguntas' },
  '04-sopa-letras':           { configurable: true,  min: 6, max: 12, def: 8, unidad: 'palabras' },
  '05-redaccion':             { configurable: false, min: 1, max: 1,  def: 1, unidad: 'texto',
                                motivoFijo: 'Es una sola redacción abierta.' },
  '06-diccionario':           { configurable: true,  min: 4, max: 10, def: 6, unidad: 'palabras' },
  '07-direcciones':           { configurable: false, min: 1, max: 1,  def: 1, unidad: 'ruta',
                                motivoFijo: 'La cantidad de indicaciones la fija la ruta: más tramos en los niveles altos del libro.' },
  '08-inflexion':             { configurable: true,  min: 4, max: 10, def: 6, unidad: 'ejercicios' },
  '09-describir':             { configurable: true,  min: 3, max: 8,  def: 4, unidad: 'imágenes' },
  '10-canciones':             { configurable: false, min: 1, max: 1,  def: 1, unidad: 'canción',
                                motivoFijo: 'Los huecos los definen la canción, el tramo elegido y el nivel del libro.' },
  '11-indicaciones':          { configurable: true,  min: 4, max: 8,  def: 6, unidad: 'pasos' },
  '12-llamada':               { configurable: true,  min: 4, max: 8,  def: 6, unidad: 'turnos' },
  '13-pedido':                { configurable: true,  min: 4, max: 8,  def: 6, unidad: 'turnos' },
  '14-anuncios':              { configurable: true,  min: 3, max: 6,  def: 4, unidad: 'preguntas' },
  '15-laberinto-palabras':    { configurable: true,  min: 3, max: 6,  def: 4, unidad: 'pisos' },
  '16-rompecabezas-oracion':  { configurable: true,  min: 3, max: 8,  def: 5, unidad: 'oraciones' },
  '17-emparejar-imagenes':    { configurable: true,  min: 4, max: 10, def: 6, unidad: 'pares' },
  '18-armar-escenario':       { configurable: true,  min: 4, max: 8,  def: 6, unidad: 'objetos' },
  '19-impostor':              { configurable: true,  min: 3, max: 8,  def: 4, unidad: 'rondas' },
  '20-basquetbol':            { configurable: true,  min: 4, max: 10, def: 6, unidad: 'tiros' },
}

/** Devuelve la config de preguntas de una actividad (con valores seguros). */
export function preguntasDe(codigo) {
  return PREGUNTAS_CONFIG[codigo] ?? { configurable: true, min: 3, max: 10, def: 6, unidad: 'ítems' }
}

/** Ajusta una cantidad pedida al rango permitido de la actividad. */
export function cantidadValida(codigo, cantidad) {
  const c = preguntasDe(codigo)
  if (!c.configurable) return c.def
  const n = Number(cantidad)
  if (!Number.isFinite(n)) return c.def
  return Math.max(c.min, Math.min(c.max, Math.round(n)))
}

// ============================================================
// NOTAS_COHERENCIA — problemas detectados y cómo se resolvieron
// ============================================================
export const NOTAS_COHERENCIA = [
  {
    problema: '10-canciones no tiene sentido en un aula o una calle.',
    solucion: 'Se bloqueó con `escenarioObligatorio: true` → siempre karaoke. Sin alternativas.',
  },
  {
    problema: 'La antigua 07 (pronunciación) implicaba "otra persona" pero nunca había con quién hablar, y no tenía nota.',
    solucion: 'Se reemplazó por 07-direcciones: un mapa real de La Paz donde se siguen o se dan indicaciones; la voz sale del celular (remota_audio).',
  },
  {
    problema: 'De las 10 actividades originales solo 3 tienen interlocutor, y las 3 son cara a cara. Nunca aparecía el caso "charla por celular" que pediste.',
    solucion: 'Se añadió 12-llamada (presencia remota_telefono) y se dio a 02 una variante alternativa en casa_llamada.',
  },
  {
    problema: '05-redaccion requiere revisión manual: si cae a mitad de ruta, el estudiante queda bloqueado esperando nota.',
    solucion: 'Se marcó apto: ["final"] — solo puede ser el último nodo. La ruta cierra y el puntaje queda pendiente.',
  },
  {
    problema: 'Con solo 10 actividades, una ruta de 6 etapas con ramas de refuerzo y remediación repite escenarios.',
    solucion: 'Se añadieron 11, 13 y 14 para llenar los carriles de refuerzo/remediación, y `elegirEscenario()` evita repetir fondo.',
  },
  {
    problema: 'No había ninguna actividad "transaccional" (pedir, pagar, reservar), que es lo más frecuente en A1–A2.',
    solucion: 'Se añadió 13-pedido en restaurante/recepción, dificultad 2, apta para remediación.',
  },
  {
    problema: 'El catálogo creció y no tenía un criterio de lectura visible: no se notaba qué actividad era "más fácil" que otra.',
    solucion: 'Se reordenó este archivo de menor a mayor `dificultad` (1→5), agrupado en 5 bloques comentados ' +
      '(Básico/Elemental/Intermedio/Avanzado/Experto). El panel del docente (CreateActivityPage) agrupa el ' +
      'catálogo en las mismas 5 franjas usando `catalogoPorFranjas()`, así el orden del código y el de la ' +
      'pantalla son el mismo orden.',
  },
  {
    problema: 'Todo el catálogo era "quiz / completar / ordenar": faltaban mecánicas más lúdicas (recorrido con ' +
      'riesgo, rompecabezas visual, escenografía, detección de errores) que sostengan el interés en cursos largos.',
    solucion: 'Se añadieron 5 actividades nuevas tipo minijuego: 15-laberinto-palabras (estilo Helltaker, la más ' +
      'compleja → dificultad 5), 16-rompecabezas-oracion (piezas con patrón visual → 4), 18-armar-escenario ' +
      '(arrastrar/descartar objetos en una escena fija, sin agente → 3), 17-emparejar-imagenes (variante gráfica ' +
      'de 01-emparejar → 2) y 19-impostor (matriz 3×2, encontrar la traducción incorrecta → 2). Cada una trae su ' +
      'esquema de generación (`prompts.js`), su validador (`validators.js`) y su primitiva de juego ' +
      '(`ActivityRunner.jsx`).',
  },
  {
    problema: 'Las actividades de vocabulario de opción múltiple (traducir y elegir) no tenían una versión con ' +
      'feedback "físico": acertar o fallar se veía igual que en un quiz.',
    solucion: 'Se añadió 20-basquetbol (dificultad 2) en el nuevo escenario `cancha`: la palabra va en el tablero ' +
      'y cada traducción posible es una posición de tiro; el balón encesta o rebota según la elección.',
  },
]
