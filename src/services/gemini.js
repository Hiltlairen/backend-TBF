// ============================================================
// gemini.js — Cliente del servicio de IA (las API keys NUNCA salen de aquí)
// ============================================================
// Proveedores en cadena: DeepSeek primero, Gemini como última opción
// (ver callGemini, al final). El nombre del archivo y de callGemini se
// conservan para no tocar a quienes los importan.
import { AsyncLocalStorage } from 'node:async_hooks'
import { config } from '../config.js'
import { logger } from './logger.js'

const ENDPOINT = (model) =>
  `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`

// ── Guardrails de contenido (punto 5) ───────────────────────
// El contenido de esta app lo ve un estudiante menor de edad, así que
// se pide un umbral más estricto que el de Gemini por defecto en las
// 4 categorías de daño que reconoce. Esta es la PRIMERA capa (bloquea
// en el proveedor, antes de que la respuesta llegue acá); la segunda
// capa, de defensa en profundidad, es el repaso léxico en
// services/moderacion.js que corre sobre lo que SÍ pasó este filtro.
//
// OJO con subir esto a BLOCK_LOW_AND_ABOVE: se probó y generaba
// muchos falsos positivos sobre contenido narrativo/educativo normal
// (diálogos con algo de tensión, "llama a emergencias", indicaciones
// para llegar a un lugar, anuncios, etc. — justo el tipo de escenas
// que este catálogo genera). Cada bloqueo descarta TODO lo generado
// (se borra la caché, ver activities.routes.js) y obliga a reiniciar
// el grafo completo (contexto + lote, 2+ llamadas) desde cero, lo que
// dispara el consumo de tokens y, al multiplicar las llamadas en
// ráfaga, la chance de toparse con 429/503 por cuota. BLOCK_MEDIUM_AND_ABOVE
// sigue bloqueando contenido con probabilidad media/alta de daño (la
// protección real no baja) sin ese ruido de falsos positivos.
const SAFETY_SETTINGS = [
  { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_MEDIUM_AND_ABOVE' },
  { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_MEDIUM_AND_ABOVE' },
  { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_MEDIUM_AND_ABOVE' },
  { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_MEDIUM_AND_ABOVE' },
]

/** Contador global de consumo, expuesto en /api/activities/uso */
export const consumo = {
  llamadas: 0,
  tokensEntrada: 0,
  tokensSalida: 0,
  aciertosCache: 0,
  reset() { this.llamadas = 0; this.tokensEntrada = 0; this.tokensSalida = 0; this.aciertosCache = 0 },
}

/**
 * Tokens de UNA respuesta de Gemini, en las dos cifras que se facturan.
 * Los modelos con "thinking" reportan su razonamiento aparte
 * (thoughtsTokenCount) pero Google lo cobra como SALIDA: si solo se
 * contara candidatesTokenCount, el gasto real quedaría subestimado.
 */
export function tokensDe(uso = {}) {
  return {
    entrada: uso.promptTokenCount ?? 0,
    salida: (uso.candidatesTokenCount ?? 0) + (uso.thoughtsTokenCount ?? 0),
  }
}

// ── Medidor por operación ───────────────────────────────────
// `consumo` (arriba) es el total global del proceso. Para saber cuánto
// costó UNA generación en particular — aunque haya varias en paralelo
// de distintos docentes — se corre dentro de medirTokens(): cada
// llamada a Gemini que ocurra adentro (bible, lote, reparaciones,
// reintentos que sí respondieron, e incluso un intento que falla a
// mitad de camino) suma en ese medidor y solo en ese.
const medidores = new AsyncLocalStorage()

/**
 * Corre `fn` midiendo los tokens que gasta. Devuelve { resultado, tokens }.
 * Si `fn` falla, el error sale con `tokensGastados`: lo que ya se cobró
 * antes de fallar sigue contando.
 */
export async function medirTokens(fn) {
  const tokens = { entrada: 0, salida: 0, llamadas: 0 }
  try {
    const resultado = await medidores.run(tokens, fn)
    return { resultado, tokens }
  } catch (e) {
    e.tokensGastados = tokens
    throw e
  }
}

function limpiarJson(texto) {
  return texto.replace(/^```(?:json)?/gm, '').replace(/```$/gm, '').trim()
}

// ── Modelos de respaldo (defensa contra saturación real del proveedor) ──
// Un 503 "modelo saturado" en la llamada MÁS CHICA del grafo (el bible de
// contexto, 1500 tokens de salida) no es un problema de payload/tamaño de
// prompt: es que Google no tiene capacidad libre para ESE modelo en ese
// momento. Reintentar el mismo modelo unas veces más no siempre alcanza
// si la saturación dura minutos. GEMINI_MODEL_FALLBACK (.env, separado
// por comas) permite declarar otros modelos con cupo/capacidad propia
// (ej. gemini-2.5-flash-lite, gemini-2.0-flash) para probar en orden
// después de agotar los reintentos del modelo principal.
function modelosAProbar(modeloPrincipal) {
  const fallback = config.geminiModelFallback.filter((m) => m && m !== modeloPrincipal)
  return [modeloPrincipal, ...fallback]
}

/** fetch con timeout propio — sin esto, una llamada "colgada" del lado
 *  de Google puede tardar 30-40s en devolver el 503, y con 2-3
 *  reintentos eso son más de 100s de UI congelada antes de avisar nada. */
async function fetchConTimeout(url, opciones, timeoutMs) {
  const controlador = new AbortController()
  const t = setTimeout(() => controlador.abort(), timeoutMs)
  try {
    return await fetch(url, { ...opciones, signal: controlador.signal })
  } catch (e) {
    if (e.name === 'AbortError') {
      const err = new Error(`El servicio de IA no respondió en ${timeoutMs / 1000}s (timeout).`)
      err.saturado = true
      throw err
    }
    throw e
  } finally {
    clearTimeout(t)
  }
}

// ── Espaciado entre solicitudes ────────────────────────────
// El plan gratuito de Gemini limita las solicitudes por minuto. En vez
// de dispararlas todas juntas (generar 10 variantes = 11 llamadas) y
// chocar con ese límite, cada llamada pide TURNO: entre el inicio de una
// y el de la siguiente pasan entre GEMINI_ESPERA_MIN_MS y _MAX_MS (2-4 s
// por defecto, al azar para no ir a ritmo fijo). El turno se reserva
// de forma síncrona, así que también ordena las llamadas que salen en
// paralelo y los reintentos.
let proximoTurno = 0

async function esperarTurno() {
  const min = Math.max(0, config.geminiEsperaMinMs)
  const max = Math.max(min, config.geminiEsperaMaxMs)
  if (!max) return
  const ahora = Date.now()
  const mio = Math.max(ahora, proximoTurno)
  proximoTurno = mio + min + Math.random() * (max - min)
  if (mio > ahora) await new Promise((r) => setTimeout(r, mio - ahora))
}

/** Solo para tests: olvida el turno reservado. */
export function reiniciarTurnos() { proximoTurno = 0 }

// ── Disyuntor: ¿está disponible la IA? ─────────────────────
// Si Gemini se queda sin cuota (429) o saturado (503/timeout) después
// de agotar reintentos y modelos de respaldo, la IA se marca "en pausa"
// un rato: mientras tanto callGemini() falla AL INSTANTE en vez de
// hacer esperar al docente 20 s por intento, y el panel solo deja usar
// las actividades de vocabulario, que se arman sin IA (ver
// SOLO_VOCABULARIO en domain/activityScenes.js). Cualquier respuesta
// de Gemini (o un "Comprobar ahora" del docente) la vuelve a habilitar.
const PAUSA_CUOTA_MS = 10 * 60_000
const PAUSA_CUOTA_DIARIA_MS = 60 * 60_000
const PAUSA_SATURADO_MS = 2 * 60_000
// Textos que ve el docente: sin nombre de proveedor.
const MENSAJES_CAIDA = {
  cuota: 'se agotó el saldo o la cuota del servicio de IA',
  saturado: 'el servicio de IA está saturado o no responde',
}
const caida = { hasta: 0, motivo: null, desde: null }

function marcarCaida(motivo, pausaMs) {
  const ahora = Date.now()
  if (caida.hasta <= ahora) caida.desde = new Date(ahora).toISOString()
  caida.hasta = ahora + pausaMs
  caida.motivo = motivo
  logger.warn({ motivo, pausaSegundos: Math.round(pausaMs / 1000) }, '[ia] Gemini no disponible: se pausa la IA')
}

function marcarRecuperada() {
  if (!caida.hasta) return
  caida.hasta = 0; caida.motivo = null; caida.desde = null
  logger.info('[ia] Gemini volvió a responder')
}

/** Estado actual de la IA, para el panel y para decidir qué se puede generar. */
export function estadoIA() {
  if (!config.deepseekApiKey && !config.geminiApiKey) {
    return { disponible: false, motivo: 'sin_clave', mensaje: 'el servidor no tiene una API key de IA configurada' }
  }
  if (Date.now() < caida.hasta) {
    return {
      disponible: false, motivo: caida.motivo, mensaje: MENSAJES_CAIDA[caida.motivo],
      desde: caida.desde, reintentarEn: new Date(caida.hasta).toISOString(),
    }
  }
  return { disponible: true }
}

/** Cuánto esperar según la respuesta 429 de Google (RetryInfo), con un mínimo. */
function pausaPorCuota(cuerpo) {
  const seg = String(cuerpo).match(/"retryDelay"\s*:\s*"(\d+(?:\.\d+)?)s"/)
  if (seg) return Math.max(30_000, Number(seg[1]) * 1000)
  return /PerDay/i.test(cuerpo) ? PAUSA_CUOTA_DIARIA_MS : PAUSA_CUOTA_MS
}

// ============================================================
//  PROVEEDORES DE IA, en cadena
// ============================================================
// Se prueban EN ORDEN (proveedores()): DeepSeek primero y Gemini como
// última opción. Si uno se queda sin saldo/cuota, está saturado o
// falla, se pasa al siguiente; solo si fallan todos se pausa la IA (el
// disyuntor de arriba). El nombre del proveedor queda en los logs del
// servidor: lo que puede llegar a la pantalla dice "el servicio de IA".
//
// Cada proveedor devuelve lo mismo: { json, uso, modelo }, con `uso` en
// la forma de Gemini (promptTokenCount / candidatesTokenCount /
// thoughtsTokenCount) para que tokensDe() y el resto no cambien.
// Si falla, el error trae `tipo`: 'cuota' | 'saturado' | 'otro' (y
// `pausa` sugerida en ms cuando es cuota).

/** Suma una respuesta al contador global y al medidor de la operación en curso. */
function contarUso(uso) {
  const tokens = tokensDe(uso)
  consumo.llamadas += 1
  consumo.tokensEntrada += tokens.entrada
  consumo.tokensSalida += tokens.salida
  const medidor = medidores.getStore()
  if (medidor) {
    medidor.llamadas += 1
    medidor.entrada += tokens.entrada
    medidor.salida += tokens.salida
  }
}

const fallo = (mensaje, tipo, extra = {}) => Object.assign(new Error(mensaje), { tipo, ...extra })
const pausaBackoff = (intento) =>
  new Promise((r) => setTimeout(r, Math.min(1000 * 2 ** intento, 8000) + Math.random() * 400))

// ── DeepSeek (API estilo OpenAI: /chat/completions) ─────────
// Modo JSON (`response_format: json_object`, que exige que el prompt
// diga "JSON": los nuestros lo dicen) y SIN modo de razonamiento
// (`thinking: disabled`): responde más rápido, cuesta menos y respeta
// `temperature`, que es lo que hace distintas a las variantes.
async function llamarDeepSeek(prompt, { temperature, maxOutputTokens, reintentos }) {
  const modelo = config.deepseekModel
  let ultimo = fallo('El servicio de IA no respondió.', 'saturado')
  for (let intento = 0; intento <= reintentos; intento++) {
    await esperarTurno()
    let res
    try {
      res = await fetchConTimeout(`${config.deepseekBaseUrl.replace(/\/$/, '')}/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${config.deepseekApiKey}` },
        body: JSON.stringify({
          model: modelo,
          messages: [
            { role: 'system', content: 'Responde únicamente con un objeto JSON válido, sin texto adicional.' },
            { role: 'user', content: prompt },
          ],
          temperature,
          max_tokens: maxOutputTokens,
          response_format: { type: 'json_object' },
          thinking: { type: 'disabled' },
          stream: false,
        }),
      }, config.geminiTimeoutMs)
    } catch (e) {
      // Timeout o sin conexión: para el docente es lo mismo que saturado.
      ultimo = fallo('El servicio de IA no respondió a tiempo.', 'saturado')
      logger.warn({ proveedor: 'deepseek', err: e.message }, '[ia] sin respuesta')
      await pausaBackoff(intento)
      continue
    }

    if (res.status === 402) {
      // Sin saldo: reintentar no sirve, se pasa al siguiente proveedor.
      logger.warn({ proveedor: 'deepseek' }, '[ia] sin saldo (HTTP 402)')
      throw fallo('El servicio de IA se quedó sin saldo.', 'cuota', { pausa: PAUSA_CUOTA_MS })
    }
    if (res.status === 401 || res.status === 403) {
      logger.error({ proveedor: 'deepseek', status: res.status }, '[ia] API key rechazada: revisa DEEPSEEK_API_KEY')
      throw fallo('El servicio de IA rechazó la API key.', 'otro')
    }
    if (res.status === 429 || res.status >= 500) {
      logger.warn({ proveedor: 'deepseek', status: res.status, intento }, '[ia] saturado')
      ultimo = fallo('El servicio de IA está saturado.', 'saturado')
      await pausaBackoff(intento)
      continue
    }
    if (!res.ok) {
      const cuerpo = await res.text().catch(() => '')
      logger.error({ proveedor: 'deepseek', status: res.status, cuerpo: cuerpo.slice(0, 300) }, '[ia] error')
      throw fallo(`El servicio de IA respondió con un error (HTTP ${res.status}).`, 'otro')
    }

    const data = await res.json()
    const u = data.usage ?? {}
    // completion_tokens ya incluye los de razonamiento (si los hubiera).
    const uso = { promptTokenCount: u.prompt_tokens ?? 0, candidatesTokenCount: u.completion_tokens ?? 0, thoughtsTokenCount: 0 }
    contarUso(uso)

    const eleccion = data.choices?.[0]
    if (eleccion?.finish_reason === 'content_filter') {
      throw Object.assign(fallo('El contenido generado se marcó como inseguro y se descartó.', 'otro'), { status: 422 })
    }
    // El modo JSON a veces devuelve contenido vacío (aviso de DeepSeek):
    // se reintenta como un JSON inválido.
    try {
      return { json: JSON.parse(limpiarJson(eleccion?.message?.content ?? '')), uso, modelo }
    } catch {
      ultimo = fallo('El servicio de IA devolvió un JSON inválido.', 'otro')
    }
  }
  throw ultimo
}

// ── Gemini (última opción) ──────────────────────────────────
async function llamarGemini(prompt, { temperature, maxOutputTokens, reintentos, model }) {
  let ultimo = null
  for (const modeloActual of modelosAProbar(model)) {
    for (let intento = 0; intento <= reintentos; intento++) {
      await esperarTurno()
      let res
      try {
        res = await fetchConTimeout(`${ENDPOINT(modeloActual)}?key=${config.geminiApiKey}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: { temperature, maxOutputTokens, responseMimeType: 'application/json' },
            safetySettings: SAFETY_SETTINGS,
          }),
        }, config.geminiTimeoutMs)
      } catch (e) {
        ultimo = fallo('El servicio de IA no respondió a tiempo.', 'saturado', { pausa: PAUSA_SATURADO_MS })
        logger.warn({ proveedor: 'gemini', modelo: modeloActual, err: e.message }, '[ia] sin respuesta')
        await pausaBackoff(intento)
        continue
      }

      if (res.status === 429 || res.status === 503) {
        const cuerpo = typeof res.text === 'function' ? await res.text().catch(() => '') : ''
        if (res.status === 429 && /quota|RESOURCE_EXHAUSTED/i.test(cuerpo)) {
          // Sin cuota, reintentar el MISMO modelo no sirve: se pasa
          // directo al siguiente modelo de respaldo (si hay).
          logger.warn({ proveedor: 'gemini', modelo: modeloActual }, '[ia] sin cuota (HTTP 429)')
          ultimo = fallo('Se agotó la cuota del servicio de IA.', 'cuota', { pausa: pausaPorCuota(cuerpo) })
          break
        }
        logger.warn({ proveedor: 'gemini', modelo: modeloActual, status: res.status, intento }, '[ia] saturado')
        ultimo = fallo('El servicio de IA está saturado.', 'saturado', { pausa: PAUSA_SATURADO_MS })
        await pausaBackoff(intento)
        continue
      }
      if (!res.ok) {
        const cuerpo = await res.text().catch(() => '')
        logger.error({ proveedor: 'gemini', status: res.status, cuerpo: cuerpo.slice(0, 300) }, '[ia] error')
        throw fallo(`El servicio de IA respondió con un error (HTTP ${res.status}).`, 'otro')
      }

      const data = await res.json()
      const uso = data.usageMetadata || {}
      contarUso(uso)

      // El propio Gemini pudo bloquear la solicitud o la respuesta por
      // `safetySettings` (arriba) — NO es un fallo transitorio: se corta
      // con 422 y la ruta que llamó decide (routes/activities.routes.js).
      if (data.promptFeedback?.blockReason || data.candidates?.[0]?.finishReason === 'SAFETY') {
        throw Object.assign(fallo('El contenido generado se marcó como inseguro y se descartó.', 'otro'), { status: 422 })
      }

      const texto = data.candidates?.[0]?.content?.parts?.[0]?.text ?? ''
      try {
        return { json: JSON.parse(limpiarJson(texto)), uso, modelo: modeloActual }
      } catch {
        ultimo = fallo('El servicio de IA devolvió un JSON inválido.', 'otro')
      }
    }
    // Se agotaron los reintentos con este modelo: el for de afuera pasa
    // al siguiente modelo de respaldo, si hay.
  }
  throw ultimo ?? fallo('El servicio de IA no respondió.', 'saturado')
}

/** Proveedores configurados, en el orden en que se prueban. */
function proveedores() {
  const lista = []
  if (config.deepseekApiKey) lista.push({ nombre: 'deepseek', llamar: llamarDeepSeek })
  if (config.geminiApiKey) lista.push({ nombre: 'gemini', llamar: llamarGemini })
  return lista
}

/** Para logs y bitácora: "deepseek-flash → gemini-flash-latest". Nunca va a la pantalla. */
export function descripcionModelos() {
  return proveedores()
    .map((p) => (p.nombre === 'deepseek' ? config.deepseekModel : config.geminiModel))
    .join(' → ') || 'sin IA'
}

/**
 * Pide JSON al servicio de IA: prueba los proveedores en orden
 * (DeepSeek → Gemini), cada uno con sus reintentos. Devuelve
 * { json, uso, modelo }. (Se sigue llamando callGemini para no tocar a
 * quienes la usan.)
 */
export async function callGemini(prompt, {
  temperature = 0.7,
  maxOutputTokens = 8192,
  model = config.geminiModel,
  reintentos = 2,
  // true = probar aunque la IA esté en pausa (botón "Comprobar ahora")
  forzar = false,
} = {}) {
  const cadena = proveedores()
  if (!cadena.length) {
    const err = new Error('El servidor no tiene una API key de IA configurada.')
    err.status = 500
    throw err
  }
  if (!forzar && Date.now() < caida.hasta) {
    const err = new Error(`La IA está en pausa: ${MENSAJES_CAIDA[caida.motivo]}.`)
    err.status = 503
    err.iaNoDisponible = true
    throw err
  }

  let ultimo = null
  for (const p of cadena) {
    try {
      const r = await p.llamar(prompt, { temperature, maxOutputTokens, reintentos, model })
      marcarRecuperada()
      return r
    } catch (e) {
      if (e.status === 422) throw e   // contenido bloqueado: otro proveedor no lo arregla
      ultimo = e
      if (p !== cadena.at(-1)) logger.warn({ proveedor: p.nombre, err: e.message }, '[ia] falló, se prueba el siguiente proveedor')
    }
  }
  if (ultimo?.tipo === 'cuota' || ultimo?.tipo === 'saturado') {
    marcarCaida(ultimo.tipo, ultimo.pausa ?? PAUSA_SATURADO_MS)
  }
  const err = ultimo ?? new Error('Fallo desconocido del servicio de IA.')
  err.status = err.status ?? 502
  throw err
}
