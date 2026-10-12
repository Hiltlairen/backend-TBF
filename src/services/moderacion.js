// ============================================================
// moderacion.js — Guardrails automáticos sobre contenido de Gemini
// ============================================================
// Punto 5 del encargo: la curaduría humana (cola de revisiones) mira
// lo que el ESTUDIANTE entrega, no lo que Gemini generó para
// mostrarle — hoy nada frena una actividad generada antes de que el
// docente la lance, aunque sea contenido para menores. Dos capas,
// ninguna reemplaza a la curaduría humana, la complementan desde ANTES:
//
//   1. `safetySettings` en la propia llamada a Gemini (ver
//      services/gemini.js) — bloquea en el proveedor, antes de que la
//      respuesta llegue siquiera a este servidor.
//   2. Este repaso léxico, de defensa en profundidad: por si el
//      modelo devuelve algo que pasó el filtro del proveedor (ningún
//      clasificador es perfecto) y porque esta capa sigue funcionando
//      si el día de mañana se cambia de proveedor de IA.
//
// Si algo se marca acá, la actividad NO se guarda (ver
// routes/activities.routes.js): se corta antes de insertar() y queda
// un rastro en `auditoria` con la CATEGORÍA y un fragmento corto —
// nunca el texto completo — para que admin pueda notar patrones
// repetidos sin que el propio registro de auditoría termine
// guardando el contenido que se quiso evitar.
// ============================================================

// Lista deliberadamente corta y de términos INEQUÍVOCOS — no palabras
// ambiguas que aparecerían en vocabulario de inglés/español legítimo
// (evita falsos positivos sobre contenido educativo normal). Pensada
// como red de defensa en profundidad, no como el único filtro: el
// filtro principal es `safetySettings` en services/gemini.js.
const PATRONES = [
  { categoria: 'sexual', regex: /\b(porn\w*|contenido sexual expl[íi]cito|desnud[oa]s?|acto sexual)\b/i },
  { categoria: 'violencia_grafica', regex: /\b(decapita\w*|tortura(r|ndo)?|mutila\w*|masacre|ensangrentad\w*)\b/i },
  { categoria: 'autolesion', regex: /\b(suicid\w*|autolesi[oó]n\w*|c[oó]mo (matarse|hacerte da[ñn]o))\b/i },
  { categoria: 'armas_peligrosas', regex: /\b(c[oó]mo fabricar (una )?bomba|explosivo casero|receta de veneno|fabricar un arma)\b/i },
  { categoria: 'discurso_odio', regex: /\b(muerte a los|exterminar a|raza inferior|deber[íi]an morir)\b/i },
  { categoria: 'groserias_graves', regex: /\b(hijo de puta|maric[oó]n de mierda)\b/i },
]

function extraerTextos(valor, acc = []) {
  if (typeof valor === 'string') { acc.push(valor); return acc }
  if (Array.isArray(valor)) { for (const v of valor) extraerTextos(v, acc); return acc }
  if (valor && typeof valor === 'object') { for (const v of Object.values(valor)) extraerTextos(v, acc); return acc }
  return acc
}

/**
 * Revisa cualquier valor (el JSON de una actividad, la "bible" de una
 * aventura, etc.) recorriéndolo recursivamente y aplicando la lista
 * de patrones a cada string que encuentra. No modifica nada — es de
 * solo lectura.
 * @returns {{ limpio: boolean, hallazgos: Array<{categoria: string, fragmento: string}> }}
 */
export function revisarContenido(valor) {
  const textos = extraerTextos(valor)
  const hallazgos = []
  for (const texto of textos) {
    for (const { categoria, regex } of PATRONES) {
      if (regex.test(texto)) hallazgos.push({ categoria, fragmento: texto.slice(0, 80) })
    }
  }
  return { limpio: hallazgos.length === 0, hallazgos }
}
