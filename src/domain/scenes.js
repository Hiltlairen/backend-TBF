// ============================================================
// scenes.js — Catálogo de ESCENARIOS
// ============================================================
// Por ahora NINGÚN escenario tiene imagen de fondo (fondo: null).
// Cada uno trae `paleta` (degradado CSS) para que la escena se vea
// distinta aunque todavía no exista el arte. Cuando tengas los PNG,
// solo pones el nombre del archivo en `fondo` y el motor lo usa.
//
// Parámetros que marcan cada escenario (los que pediste):
//   interaccion : ninguna | dialogo_directo | dialogo_remoto |
//                 escucha | performance | transaccion
//   presencia   : ninguna | fisica | remota_telefono | remota_audio
//   ambito      : interior | exterior
//   ruido       : silencioso | moderado | alto   (afecta actividades de audio)
// ============================================================

export const INTERACCIONES = {
  ninguna:         'El estudiante trabaja solo, sin interlocutor.',
  dialogo_directo: 'Conversación cara a cara con un NPC presente en escena.',
  dialogo_remoto:  'Conversación por celular: el interlocutor NO está en escena.',
  escucha:         'El estudiante escucha a alguien sin responder (anuncios, indicaciones).',
  performance:     'El estudiante produce lenguaje frente a otros (cantar, presentar).',
  transaccion:     'Intercambio funcional corto (pedir, pagar, reservar).',
}

export const PRESENCIAS = {
  ninguna:          { npc: false, canal: null,        nota: 'No se dibuja segundo personaje.' },
  fisica:           { npc: true,  canal: 'presencial', nota: 'Se dibuja NPC en el punto B.' },
  remota_telefono:  { npc: false, canal: 'telefono',   nota: 'El NPC aparece como avatar dentro del celular.' },
  remota_audio:     { npc: false, canal: 'audio',      nota: 'Solo voz: se muestra onda de audio, sin avatar.' },
}

export const ESCENARIOS = {
  // ── Sin interlocutor ────────────────────────────────────
  aula: {
    id: 'aula', nombre: 'Aula de clases',
    ambito: 'interior', ruido: 'silencioso',
    interaccion: 'ninguna', presencia: 'ninguna',
    fondo: null, paleta: ['#1e293b', '#334155'],
    props: ['pizarra', 'pupitre'],
    descripcion: 'Escenario neutro de repaso. El personaje se sienta y saca el celular.',
  },
  biblioteca: {
    id: 'biblioteca', nombre: 'Biblioteca',
    ambito: 'interior', ruido: 'silencioso',
    interaccion: 'ninguna', presencia: 'ninguna',
    fondo: null, paleta: ['#2a1f14', '#4a3524'],
    props: ['estante', 'libro'],
    descripcion: 'Punto A: puerta. Punto B: estante. Ideal para buscar/traducir palabras.',
  },
  parque: {
    id: 'parque', nombre: 'Parque',
    ambito: 'exterior', ruido: 'moderado',
    interaccion: 'ninguna', presencia: 'ninguna',
    fondo: null, paleta: ['#14311f', '#2d6a4f'],
    props: ['banca', 'arbol'],
    descripcion: 'Descanso entre etapas. Buen sitio para actividades largas y tranquilas.',
  },
  dormitorio: {
    id: 'dormitorio', nombre: 'Habitación / escritorio',
    ambito: 'interior', ruido: 'silencioso',
    interaccion: 'ninguna', presencia: 'ninguna',
    fondo: null, paleta: ['#241a33', '#3f2d59'],
    props: ['escritorio', 'lampara'],
    descripcion: 'Escenario de escritura. El personaje se sienta a redactar.',
  },
  galeria: {
    id: 'galeria', nombre: 'Galería / museo',
    ambito: 'interior', ruido: 'silencioso',
    interaccion: 'ninguna', presencia: 'ninguna',
    fondo: null, paleta: ['#1a1a2e', '#3a3a5c'],
    props: ['cuadro', 'placa'],
    descripcion: 'Escenario visual: se describe lo que se ve. Encaja con "What do you see?".',
  },

  // ── Con interlocutor físico ─────────────────────────────
  cafeteria: {
    id: 'cafeteria', nombre: 'Cafetería',
    ambito: 'interior', ruido: 'moderado',
    interaccion: 'dialogo_directo', presencia: 'fisica',
    fondo: null, paleta: ['#3a2418', '#6b4423'],
    props: ['mesa', 'npc'],
    descripcion: 'El personaje camina hasta la mesa donde lo espera un amigo (NPC).',
  },
  calle: {
    id: 'calle', nombre: 'Calle / esquina',
    ambito: 'exterior', ruido: 'alto',
    interaccion: 'dialogo_directo', presencia: 'fisica',
    fondo: null, paleta: ['#1c2733', '#425466'],
    props: ['semaforo', 'npc'],
    descripcion: 'Se acerca a un transeúnte para preguntar o pedir indicaciones.',
  },
  restaurante: {
    id: 'restaurante', nombre: 'Restaurante',
    ambito: 'interior', ruido: 'moderado',
    interaccion: 'transaccion', presencia: 'fisica',
    fondo: null, paleta: ['#2e1b1b', '#5c3030'],
    props: ['mesa', 'menu', 'npc_mesero'],
    descripcion: 'El mesero (NPC) espera el pedido. Diálogo funcional corto.',
  },
  recepcion: {
    id: 'recepcion', nombre: 'Recepción de hotel',
    ambito: 'interior', ruido: 'moderado',
    interaccion: 'transaccion', presencia: 'fisica',
    fondo: null, paleta: ['#1b2a2e', '#2f5560'],
    props: ['mostrador', 'npc_recepcionista'],
    descripcion: 'Check-in: registrar datos, pedir habitación, preguntar horarios.',
  },

  // ── Performance / audio ─────────────────────────────────
  karaoke: {
    id: 'karaoke', nombre: 'Bar de karaoke',
    ambito: 'interior', ruido: 'alto',
    interaccion: 'performance', presencia: 'ninguna',
    fondo: null, paleta: ['#2b0f3a', '#6d1f78'],
    props: ['microfono', 'pantalla_letra', 'luces'],
    descripcion: 'OBLIGATORIO para actividades de canciones. Escenario con micrófono.',
    obligatorioPara: ['10-canciones'],
  },
  estudio_radio: {
    id: 'estudio_radio', nombre: 'Estudio de radio',
    ambito: 'interior', ruido: 'silencioso',
    interaccion: 'escucha', presencia: 'remota_audio',
    fondo: null, paleta: ['#101a2b', '#22334f'],
    props: ['microfono_estudio', 'onda_audio'],
    descripcion: 'Pronunciación y escucha. La "otra persona" es solo voz.',
  },
  estacion: {
    id: 'estacion', nombre: 'Estación / terminal',
    ambito: 'exterior', ruido: 'alto',
    interaccion: 'escucha', presencia: 'remota_audio',
    fondo: null, paleta: ['#1d2430', '#3d4a5c'],
    props: ['panel_horarios', 'altavoz'],
    descripcion: 'Anuncios por altavoz: comprensión auditiva sin interlocutor visible.',
  },

  // ── Conversación por celular (el caso que pediste marcar) ──
  casa_llamada: {
    id: 'casa_llamada', nombre: 'Casa — llamada telefónica',
    ambito: 'interior', ruido: 'silencioso',
    interaccion: 'dialogo_remoto', presencia: 'remota_telefono',
    fondo: null, paleta: ['#1a2419', '#33502f'],
    props: ['sofa', 'avatar_en_pantalla'],
    descripcion: 'NO se dibuja NPC: el interlocutor vive dentro del celular como avatar.',
  },
  pasillo_llamada: {
    id: 'pasillo_llamada', nombre: 'Pasillo — videollamada',
    ambito: 'interior', ruido: 'moderado',
    interaccion: 'dialogo_remoto', presencia: 'remota_telefono',
    fondo: null, paleta: ['#22202e', '#453f5c'],
    props: ['ventana', 'avatar_en_pantalla'],
    descripcion: 'Variante rápida de llamada, usada en ramas de refuerzo.',
  },

  // ── Escenarios de las actividades nuevas tipo minijuego ─
  torre: {
    id: 'torre', nombre: 'Torre de acertijos',
    ambito: 'interior', ruido: 'silencioso',
    interaccion: 'ninguna', presencia: 'ninguna',
    fondo: null, paleta: ['#161225', '#352a52'],
    props: ['losas', 'antorcha'],
    descripcion: 'Exclusivo de 15-laberinto-palabras: cada piso es una cuadrícula de casillas al estilo Helltaker.',
  },
  taller: {
    id: 'taller', nombre: 'Taller / mesa de trabajo',
    ambito: 'interior', ruido: 'silencioso',
    interaccion: 'ninguna', presencia: 'ninguna',
    fondo: null, paleta: ['#2b2013', '#5a4326'],
    props: ['mesa_trabajo', 'piezas'],
    descripcion: 'Mesa donde se arman rompecabezas de oraciones (16) y se ordenan objetos en escenarios (18).',
  },
  cancha: {
    id: 'cancha', nombre: 'Cancha de básquetbol',
    ambito: 'exterior', ruido: 'moderado',
    interaccion: 'ninguna', presencia: 'ninguna',
    fondo: null, paleta: ['#3b1d0b', '#9a4a14'],
    props: ['aro', 'balon'],
    descripcion: 'Canasta con la palabra en el tablero y 3 posiciones de tiro (20-basquetbol).',
  },
}

export const listarEscenarios = () => Object.values(ESCENARIOS)
export const getEscenario = (id) => ESCENARIOS[id] ?? null

/** Devuelve el escenario ya resuelto con sus flags de render para el frontend. */
export function resolverEscenario(id) {
  const e = getEscenario(id)
  if (!e) return null
  const p = PRESENCIAS[e.presencia]
  return {
    ...e,
    render: {
      dibujarNpc: p.npc,
      canal: p.canal,
      usarFondo: Boolean(e.fondo),
      gradiente: `linear-gradient(180deg, ${e.paleta[0]}, ${e.paleta[1]})`,
    },
  }
}
