// ============================================================
// prompts.js — Prompts COMPACTOS para el grafo de generación
// ============================================================
// Estrategia de ahorro de tokens:
//
//   ANTES (tu versión):  6 actividades = 6 llamadas.
//                        Cada llamada reenvía TODO el vocabulario
//                        (~700–1500 tokens) + el esquema completo.
//                        ≈ 6 × 2.000 = 12.000 tokens de entrada.
//
//   AHORA:  1) NODO CONTEXTO  → 1 llamada con el vocabulario completo.
//              Devuelve un "story bible" de ~250 tokens.
//           2) NODO LOTE      → 1 llamada que genera las 6 actividades
//              usando SOLO el bible (no el vocabulario crudo).
//           3) NODO REPARAR   → solo si alguna falló, y solo esa.
//           ≈ 1.800 + 1.400 = ~3.200 tokens de entrada.
//
//   Recorte aproximado: 70–75 % de tokens de entrada.
// ============================================================

/** Agrupa vocabulario por categoría (solo se usa una vez, en el nodo contexto). */
function vocabBlock(vocabulario) {
  const porCat = {}
  for (const v of vocabulario) (porCat[v.categoria] ||= []).push(`${v.ingles}=${v.espanol}`)
  return Object.entries(porCat).map(([c, w]) => `[${c}] ${w.join(', ')}`).join('\n')
}

// ── Versiones alternativas ─────────────────────────────────
// El docente puede pedir otra VERSIÓN de la misma actividad (mismas
// lecciones y tipos). Sin esta instrucción el modelo tiende a repetir
// la historia y las palabras "obvias" de la primera. La versión 1 no
// lleva nada: su prompt es idéntico al de siempre.
function notaVariante(variante, que) {
  if (!variante || variante <= 1) return ''
  return `
VARIANT #${variante}: this is an ALTERNATIVE version for a teacher who already has ${variante - 1} other version(s). ${que}
`
}

// ── 1. STORY BIBLE ─────────────────────────────────────────
export function buildBiblePrompt({ vocabulario, lecciones, nivel = 'A2', escenarios = [], variante = 1 }) {
  const tema = lecciones.map((l) => `L${l.numero}: ${l.titulo}`).join(' / ')
  return `You are designing a short interactive English story for CEFR ${nivel} learners.

LESSONS: ${tema}
${notaVariante(variante, 'Choose a DIFFERENT storyline, different character names and a different selection of words than the most obvious first choice.')}
FULL VOCABULARY (source of truth — never invent words outside this):
${vocabBlock(vocabulario)}

SCENES the story will pass through: ${escenarios.join(', ')}

Produce a COMPACT "story bible" that will be the ONLY context for generating the
activities later. Be economical: no prose, no explanations.

Return EXACTLY this JSON:
{
  "tema": "one short line describing the storyline",
  "protagonista": "first name",
  "npc": "first name of the person the learner talks to",
  "nivel": "${nivel}",
  "lexico": [{"en":"word","es":"palabra","cat":"category"}],
  "lexico_verbos": ["base form verbs from the list, max 10"],
  "frases_clave": ["max 6 useful chunks the learner should reuse"],
  "notas_escena": {"scene_id": "one line of what happens there"}
}

Rules:
- "lexico": pick EXACTLY 16 words, spread across categories, the most useful ones.
- "lexico_verbos": only verbs that actually appear in the vocabulary.
- Output JSON only. No markdown fences.`
}

// ── 2. MINI-ESQUEMAS por actividad (versión corta) ─────────
// Se envía solo el esquema de las actividades pedidas, nada más.
export const MINI_SCHEMAS = {
  '01-emparejar': `"01-emparejar": {"actividad":{...meta},"columna_izquierda":{"tipo":"texto","items":[{"id":"L1","tipo":"texto","contenido":"clue"}]},"columna_derecha":{"tipo":"texto","items":[{"id":"R1","tipo":"texto","contenido":"word"}]},"pares_correctos":[{"izquierda":"L1","derecha":"R3"}]}  // N pares, columna derecha BARAJADA`,

  '02-conversacion-completar': `"02-conversacion-completar": {"actividad":{...meta},"conversacion":[{"id":"t1","hablante":"<npc>","avatar":null,"tipo":"fijo","texto":"..."},{"id":"t2","hablante":"You","avatar":null,"tipo":"opciones","plantilla":"... {blank} ...","opciones":[{"id":"o1","texto":"w","correcta":true},{"id":"o2","texto":"w","correcta":false},{"id":"o3","texto":"w","correcta":false}]}],"audio_conversacion":null}  // N turnos PAR, alterna npc→You`,

  '03-conversation-selection': `"03-conversation-selection": {"actividad":{...meta},"conversacion":[{"id":"turn1","hablante":"<npc>","avatar":null,"texto":"...","tipo":"fijo"},{"id":"turn2","hablante":"You","avatar":null,"tipo":"pregunta","pregunta_id":"Q1"}],"preguntas":[{"id":"Q1","opciones":[{"id":"Q1A","texto":"full sentence","correcta":true},{"id":"Q1B","texto":"...","correcta":false},{"id":"Q1C","texto":"...","correcta":false}]}],"audio_conversacion":null}`,

  '04-sopa-letras': `"04-sopa-letras": {"actividad":{...meta},"configuracion":{"filas":12,"columnas":12,"direcciones":["horizontal","vertical","diagonal"],"mayusculas":true},"palabras":[{"palabra":"UPPERCASE","pista":"short clue"}]}  // solo A-Z, 3..12 letras, sin espacios`,

  '05-redaccion': `"05-redaccion": {"actividad":{...meta,"puntuacion_maxima":100},"consigna":"prompt in English","minimo_palabras":40,"criterios":[{"id":"C1","nombre":"Vocabulary","descripcion":"...","peso":40}]}  // se corrige a mano`,

  '06-diccionario': `"06-diccionario": {"actividad":{...meta},"entradas":[{"id":"D1","tipo_entrada":"texto","contenido":"palabra en español","idioma_entrada":"es","respuesta_correcta":"english word","alternativas_aceptadas":[]}]}`,

  '07-pronunciacion': `"07-pronunciacion": {"actividad":{...meta},"items":[{"id":"P1","palabra":"word","silabas":["wo","rd"],"acento":1,"ipa":"/wɜːd/","consejo":"short tip in Spanish"}]}  // sin puntaje`,

  '08-inflexion': `"08-inflexion": {"actividad":{...meta},"reglas_mostradas":[{"id":"R1","titulo":"Add -ING","ejemplo":"run → running","color":"#ef8312"},{"id":"R2","titulo":"Add -ES / -IES","ejemplo":"wash → washes","color":"#142843"}],"ejercicios":[{"id":"E1","tipo":"completar","instruccion":"Add -ING","regla_id":"R1","plantilla":"She is {blank} her homework.","palabra_base":"do","respuesta_correcta":"doing","pista":"do + ing"}]}  // solo R1 y R2`,

  '09-describir': `"09-describir": {"actividad":{...meta},"items":[{"id":"I1","tipo_estimulo":"texto","contenido":"1-2 sentences","opciones":[{"id":"I1A","texto":"...","correcta":true},{"id":"I1B","texto":"...","correcta":false},{"id":"I1C","texto":"...","correcta":false}]}]}`,

  '10-canciones': `"10-canciones": {"actividad":{...meta},"cancion":{"titulo":"original title","artista":"Original","tempo":"slow"},"lineas":[{"id":"S1","texto":"line with {blank} inside","respuesta_correcta":"word","opciones":["w1","w2","w3"]}]}  // letra ORIGINAL escrita por ti, NO copies canciones reales`,

  '11-indicaciones': `"11-indicaciones": {"actividad":{...meta},"destino":"the library","pasos_desordenados":[{"id":"S1","texto":"Turn left at the corner."}],"orden_correcto":["S3","S1","S2"]}  // 5-7 pasos`,

  '12-llamada': `"12-llamada": {"actividad":{...meta},"llamante":{"nombre":"<npc>","motivo":"one line"},"turnos":[{"id":"C1","hablante":"caller","texto":"..."},{"id":"C2","hablante":"You","tipo":"opciones","opciones":[{"id":"C2A","texto":"...","correcta":true},{"id":"C2B","texto":"...","correcta":false},{"id":"C2C","texto":"...","correcta":false}]}]}  // el interlocutor NO está presente físicamente`,

  '13-pedido': `"13-pedido": {"actividad":{...meta},"lugar":"cafe counter","menu":[{"item":"coffee","precio":"$2"}],"turnos":[{"id":"T1","hablante":"staff","texto":"..."},{"id":"T2","hablante":"You","tipo":"opciones","opciones":[{"id":"T2A","texto":"...","correcta":true},{"id":"T2B","texto":"...","correcta":false},{"id":"T2C","texto":"...","correcta":false}]}]}`,

  '14-anuncios': `"14-anuncios": {"actividad":{...meta},"anuncio":{"texto":"announcement to be read by text-to-speech","voz":"en-US"},"preguntas":[{"id":"A1","texto":"question","opciones":[{"id":"A1A","texto":"...","correcta":true},{"id":"A1B","texto":"...","correcta":false},{"id":"A1C","texto":"...","correcta":false}]}]}`,

  // ── 15–19: actividades nuevas tipo minijuego ──────────────
  '15-laberinto-palabras': `"15-laberinto-palabras": {"actividad":{...meta},"vidas_iniciales":3,"tiempo_por_nivel":40,"niveles":[{"id":"N1","oracion":"I go to school every day.","traduccion":"Voy a la escuela todos los días.","palabras_en_orden":["I","go","to","school","every","day"],"distractores":["run","house"]}]}  // 4-8 palabras por nivel EN EL ORDEN CORRECTO de la oración (nunca las mezcles), 0-4 distractores por nivel; el laberinto/cuadrícula lo construye el cliente, tú SOLO eliges la oración`,

  '16-rompecabezas-oracion': `"16-rompecabezas-oracion": {"actividad":{...meta},"rompecabezas":[{"id":"R1","oracion":"She reads a book every night.","traduccion":"Ella lee un libro todas las noches.","piezas_en_orden":["She","reads","a","book","every","night."]}]}  // 3-8 piezas EN ORDEN; las piezas y su forma de rompecabezas las genera el cliente`,

  '17-emparejar-imagenes': `"17-emparejar-imagenes": {"actividad":{...meta},"columna_izquierda":{"tipo":"mixta","items":[{"id":"L1","tipo":"imagen","contenido":"apple.png","alt":"apple"},{"id":"L2","tipo":"texto","contenido":"the dog"}]},"columna_derecha":{"tipo":"texto","items":[{"id":"R1","tipo":"texto","contenido":"manzana"}]},"pares_correctos":[{"izquierda":"L1","derecha":"R3"}]}  // items de la izquierda alternan tipo "imagen" (usa un nombre de archivo descriptivo en inglés, ej. "apple.png") y "texto"; columna derecha SIEMPRE en español y barajada`,

  '18-armar-escenario': `"18-armar-escenario": {"actividad":{...meta},"escenario_interior":{"nombre":"kitchen","imagen":"cocina.png","zonas":[{"id":"Z1","nombre":"stove"},{"id":"Z2","nombre":"table"}]},"objetos":[{"id":"O1","nombre":"pan","imagen":"sarten.png","zona_correcta":"Z1"},{"id":"O2","nombre":"plate","imagen":"plato.png","zona_correcta":"Z2"},{"id":"O3","nombre":"car","imagen":"auto.png","zona_correcta":null}]}  // "zona_correcta":null = objeto DISTRACTOR que no pertenece a la escena y debe descartarse; incluye al menos 1`,

  '19-impostor': `"19-impostor": {"actividad":{...meta},"rondas":[{"id":"RD1","tarjetas":[{"id":"T1","imagen":"dog.png","palabra_en":"dog","traduccion_mostrada":"perro","correcta":true},{"id":"T2","imagen":"cat.png","palabra_en":"cat","traduccion_mostrada":"gato","correcta":true},{"id":"T3","imagen":"house.png","palabra_en":"house","traduccion_mostrada":"casa","correcta":true},{"id":"T4","imagen":"book.png","palabra_en":"book","traduccion_mostrada":"libro","correcta":true},{"id":"T5","imagen":"water.png","palabra_en":"water","traduccion_mostrada":"agua","correcta":true},{"id":"T6","imagen":"apple.png","palabra_en":"apple","traduccion_mostrada":"perro","correcta":false}]}]}  // cada ronda tiene EXACTAMENTE 6 tarjetas (matriz 3x2) y EXACTAMENTE 1 con "correcta":false (traducción incorrecta a propósito)`,

  '20-basquetbol': `"20-basquetbol": {"actividad":{...meta},"tiros":[{"id":"B1","palabra":"perro","idioma":"es","opciones":[{"id":"B1A","texto":"dog","correcta":true},{"id":"B1B","texto":"cat","correcta":false},{"id":"B1C","texto":"bird","correcta":false}]}]}  // "palabra" en español (sale en el tablero del aro); EXACTAMENTE 3 opciones en inglés, 1 sola correcta, distractores plausibles del mismo léxico; textos cortos (máx. 24 caracteres)`,
}

/** meta = bloque "actividad" común; se describe UNA vez para todas. */
const META_SPEC = `"actividad" (same shape in every activity) =
{"id":"<activity code>","titulo":"<title>","instrucciones":"<one line, English>","nivel":"<level>","leccion":"<lessons>","tiempo_limite":<seconds>,"puntuacion_maxima":100,"penalizacion_por_error":<pts>,"escenario":"<scene_id>","interaccion":"<interaction>","presencia":"<presence>"}`

// ── 3. LOTE (la llamada que hace el trabajo pesado) ────────
/**
 * @param {object} bible  salida del nodo contexto
 * @param {Array}  specs  [{codigo, escenario, interaccion, presencia, cantidad, tiempo, penalizacion}]
 */
export function buildBatchPrompt(bible, specs, variante = 1) {
  const esquemas = specs.map((s) => MINI_SCHEMAS[s.codigo]).filter(Boolean).join('\n\n')
  const pedido = specs.map((s) =>
    `- ${s.codigo} → ${s.cantidad} items | scene "${s.escenario}" | interaction "${s.interaccion}" | presence "${s.presencia}" | tiempo_limite ${s.tiempo} | penalizacion_por_error ${s.penalizacion}`
  ).join('\n')

  return `Generate ${specs.length} English activities at once, as ONE JSON object.

STORY BIBLE (this is your ONLY vocabulary source — never use words outside "lexico"/"lexico_verbos"):
${JSON.stringify(bible)}

REQUESTED:
${pedido}
${notaVariante(variante, 'Write different items, sentences and situations than a standard version would; avoid the most predictable examples.')}
${META_SPEC}

SCHEMAS (one key per activity, keyed by its code):
${esquemas}

HARD RULES:
- Top level = {"actividades": { "<code>": {...}, ... }} with EXACTLY the codes requested.
- Every "actividad.escenario"/"interaccion"/"presencia" must copy the values given above.
- When presence is "remota_telefono" or "remota_audio" the other person is NOT physically
  present: write the dialogue as a phone call / a voice, never as face-to-face.
- Use the npc name from the bible as the speaker in dialogues.
- Never invent vocabulary. Reuse "frases_clave" where natural.
- No markdown fences, no comments, no text outside the JSON.`
}

// ── 4. REPARACIÓN (solo la actividad que falló) ────────────
export function buildRepairPrompt(bible, spec, motivo) {
  return `The activity "${spec.codigo}" you generated was rejected. Reason: ${motivo}

STORY BIBLE:
${JSON.stringify({ lexico: bible.lexico, lexico_verbos: bible.lexico_verbos, npc: bible.npc, nivel: bible.nivel })}

Regenerate ONLY that activity: ${spec.cantidad} items, scene "${spec.escenario}",
tiempo_limite ${spec.tiempo}, penalizacion_por_error ${spec.penalizacion}.

${META_SPEC}

SCHEMA:
${MINI_SCHEMAS[spec.codigo]}

Return ONLY {"${spec.codigo}": {...}}. No fences, no extra text.`
}
