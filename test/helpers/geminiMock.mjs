// ============================================================
// test/helpers/geminiMock.mjs — intercepta llamadas a Gemini
// ============================================================
// Mismo truco que scripts/e2e.mjs: reemplaza global.fetch para que
// las llamadas a generativelanguage.googleapis.com respondan con
// contenido fabricado (sin gastar tokens ni necesitar una API Key
// real), y deja pasar cualquier otra URL sin tocar. `instalar()`
// devuelve un `restaurar()` para dejar todo como estaba al terminar
// el test (buena higiene si el archivo mezcla tests con y sin mock).
// ============================================================

const META = (codigo, s = {}) => ({
  id: codigo, titulo: `Test — ${codigo}`,
  instrucciones: s.instrucciones ?? 'Test instructions.',
  nivel: 'A2', leccion: 'L1',
  tiempo_limite: 120, puntuacion_maxima: 100, penalizacion_por_error: 10,
  escenario: 'aula', interaccion: 'ninguna', presencia: 'ninguna',
})

/** Payload válido para 01-emparejar — el mismo shape que espera el parser real. */
export function actividadEmparejar(codigo = '01-emparejar', overrides = {}) {
  return {
    actividad: META(codigo, overrides),
    columna_izquierda: { tipo: 'texto', items: [1, 2, 3, 4].map((n) => ({ id: `L${n}`, tipo: 'texto', contenido: `clue ${n}` })) },
    columna_derecha:   { tipo: 'texto', items: [1, 2, 3, 4].map((n) => ({ id: `R${n}`, tipo: 'texto', contenido: `word ${n}` })) },
    pares_correctos: [
      { izquierda: 'L1', derecha: 'R3' }, { izquierda: 'L2', derecha: 'R1' },
      { izquierda: 'L3', derecha: 'R4' }, { izquierda: 'L4', derecha: 'R2' },
    ],
  }
}

/**
 * Respuestas del estudiante para el emparejar de arriba, con `fallos`
 * intentos equivocados antes de resolver los 4 pares. Con la
 * penalización del mock (10), la nota que calcula el servidor es
 * 100 - 10 × fallos.
 */
export function respuestasEmparejar(fallos = 0) {
  const pares = [['L1', 'R3'], ['L2', 'R1'], ['L3', 'R4'], ['L4', 'R2']]
  const errores = Array.from({ length: fallos }, (_, k) => ({ izq: pares[k % 4][0], der: 'R-falso' }))
  return { intentos: [...errores, ...pares.map(([izq, der]) => ({ izq, der }))] }
}

/** Lo que devuelve el mock cuando el prompt es el del tutor IA. */
export const RETRO_FALSA = {
  resumen: 'Confundiste algunas pistas con palabras parecidas.',
  consejos: [{ tema: 'Lee la pista completa', explicacion: 'Antes de elegir, lee toda la pista: "clue 1" → "word 3".' }],
  animo: '¡Vas muy bien, sigue practicando!',
}

/**
 * Instala el mock. `respuestaPorCodigo(codigo, prompt) => objeto de actividad`
 * deja elegir qué devolver por cada código pedido — el prompt sirve para
 * distinguir variantes ("VARIANT #k") — (por defecto,
 * siempre el emparejar de arriba). Devuelve `{ restaurar, llamadas }`.
 */
export function instalarGeminiMock({
  respuestaPorCodigo = () => actividadEmparejar(),
  // Lo que reporta Gemini en usageMetadata por cada llamada. Los modelos
  // con "thinking" agregan thoughtsTokenCount (se cobra como salida).
  uso = { promptTokenCount: 100, candidatesTokenCount: 200 },
} = {}) {
  const original = globalThis.fetch
  const estado = { llamadas: 0, prompts: [] }

  globalThis.fetch = async (url, opciones) => {
    const u = String(url)
    if (!u.includes('generativelanguage.googleapis.com')) return original(url, opciones)

    estado.llamadas += 1
    const prompt = JSON.parse(opciones.body).contents[0].parts[0].text
    estado.prompts.push(prompt)

    let payload
    if (prompt.includes('tutor de inglés')) {
      payload = RETRO_FALSA
    } else if (prompt.includes('story bible')) {
      payload = {
        tema: 'A day in the city', protagonista: 'Ana', npc: 'Tom', nivel: 'A2',
        lexico: [{ en: 'book', es: 'libro', cat: 'objects' }],
        lexico_verbos: ['read'], frases_clave: ['I live in…'], notas_escena: {},
      }
    } else {
      const pedidos = [...prompt.matchAll(/- (\S+) →/g)].map((m) => m[1])
      const actividades = {}
      for (const codigo of pedidos) actividades[codigo] = respuestaPorCodigo(codigo, prompt)
      payload = { actividades }
    }

    return new Response(JSON.stringify({
      candidates: [{ content: { parts: [{ text: JSON.stringify(payload) }] } }],
      usageMetadata: uso,
    }), { status: 200, headers: { 'Content-Type': 'application/json' } })
  }

  return {
    llamadas: estado,
    restaurar() { globalThis.fetch = original },
  }
}
