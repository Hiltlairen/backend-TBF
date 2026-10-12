// ============================================================
// gemini.js — Cliente del backend (la API Key NUNCA sale de aquí)
// ============================================================
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
      const err = new Error(`Gemini no respondió en ${timeoutMs / 1000}s (timeout).`)
      err.saturado = true
      throw err
    }
    throw e
  } finally {
    clearTimeout(t)
  }
}

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
const MENSAJES_CAIDA = {
  cuota: 'se agotó la cuota de la API de Gemini',
  saturado: 'Gemini está saturado o no responde',
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
  if (!config.geminiApiKey) {
    return { disponible: false, motivo: 'sin_clave', mensaje: 'el servidor no tiene una API key de Gemini configurada' }
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

/**
 * Llama a Gemini y devuelve JSON parseado.
 * Reintenta con backoff exponencial (+jitter) en 429/503/timeout, y si
 * el modelo pedido sigue saturado tras agotar sus reintentos, prueba
 * los modelos de GEMINI_MODEL_FALLBACK (si hay alguno configurado)
 * antes de rendirse.
 */
export async function callGemini(prompt, {
  temperature = 0.7,
  maxOutputTokens = 8192,
  model = config.geminiModel,
  reintentos = 2,
  // true = probar aunque la IA esté en pausa (botón "Comprobar ahora")
  forzar = false,
} = {}) {
  if (!config.geminiApiKey) {
    const err = new Error('GEMINI_API_KEY no está configurada en el .env del servidor.')
    err.status = 500
    throw err
  }
  if (!forzar && Date.now() < caida.hasta) {
    const err = new Error(`La IA está en pausa: ${MENSAJES_CAIDA[caida.motivo]}.`)
    err.status = 503
    err.iaNoDisponible = true
    throw err
  }

  let ultimoError
  // Tipo del último fallo: si al final fue por cuota/saturación, se pausa la IA.
  let ultimoTipo = null
  let pausaSugerida = PAUSA_SATURADO_MS

  for (const modeloActual of modelosAProbar(model)) {
    for (let intento = 0; intento <= reintentos; intento++) {
      try {
        const res = await fetchConTimeout(`${ENDPOINT(modeloActual)}?key=${config.geminiApiKey}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: { temperature, maxOutputTokens, responseMimeType: 'application/json' },
            safetySettings: SAFETY_SETTINGS,
          }),
        }, config.geminiTimeoutMs).catch((e) => {
          if (e.saturado) return { status: 503, saturadoPorTimeout: true }
          throw e
        })

        if (res.status === 429 || res.status === 503) {
          const cuerpo = typeof res.text === 'function' ? await res.text().catch(() => '') : ''
          if (res.status === 429 && /quota|RESOURCE_EXHAUSTED/i.test(cuerpo)) {
            // Sin cuota, reintentar el MISMO modelo no sirve: se pasa
            // directo al siguiente modelo de respaldo (si hay).
            ultimoTipo = 'cuota'
            pausaSugerida = pausaPorCuota(cuerpo)
            ultimoError = new Error(`Gemini (${modeloActual}) sin cuota disponible (HTTP 429).`)
            break
          }
          ultimoTipo = 'saturado'
          pausaSugerida = PAUSA_SATURADO_MS
          ultimoError = new Error(
            res.saturadoPorTimeout
              ? `Gemini (${modeloActual}) no respondió a tiempo — probablemente saturado.`
              : `Gemini (${modeloActual}) saturado (HTTP ${res.status}).`
          )
          // Backoff exponencial con jitter: crece más rápido que el fijo
          // anterior (1.2s/2.4s) pero sigue acotado — si el proveedor está
          // saturado por minutos, más reintentos locales no lo arreglan;
          // para eso está el fallback de modelos, arriba.
          const base = Math.min(1000 * 2 ** intento, 8000)
          await new Promise((r) => setTimeout(r, base + Math.random() * 400))
          continue
        }
        if (!res.ok) {
          const cuerpo = await res.text().catch(() => '')
          const err = new Error(`Error de Gemini (HTTP ${res.status}). ${cuerpo.slice(0, 200)}`)
          err.status = 502
          throw err
        }

        // Gemini respondió: la IA está disponible (aunque esta respuesta
        // en particular después resulte inválida o bloqueada).
        marcarRecuperada()
        const data = await res.json()
        const uso = data.usageMetadata || {}
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

        // El propio Gemini pudo bloquear la solicitud o la respuesta por
        // `safetySettings` (arriba) — esto NO es un fallo transitorio, así
        // que no se reintenta: se corta con 422 y se deja que la ruta que
        // llamó decida qué hacer (routes/activities.routes.js).
        if (data.promptFeedback?.blockReason) {
          const err = new Error(`Gemini bloqueó la solicitud por seguridad (${data.promptFeedback.blockReason}).`)
          err.status = 422
          throw err
        }
        if (data.candidates?.[0]?.finishReason === 'SAFETY') {
          const err = new Error('Gemini generó contenido marcado como inseguro; se descartó automáticamente.')
          err.status = 422
          throw err
        }

        const texto = data.candidates?.[0]?.content?.parts?.[0]?.text ?? ''
        try {
          return { json: JSON.parse(limpiarJson(texto)), uso, modelo: modeloActual }
        } catch {
          ultimoError = new Error('Gemini devolvió un JSON inválido.')
          ultimoTipo = 'otro'
          continue
        }
      } catch (e) {
        if (e.status && e.status !== 502) throw e
        ultimoError = e
        // Sin status = no se pudo ni conectar (sin internet, DNS…): para
        // el docente es lo mismo que una IA saturada.
        ultimoTipo = e.status ? 'otro' : 'saturado'
      }
    }
    // Se agotaron los reintentos con este modelo — si hay un modelo de
    // respaldo, el for de afuera pasa al siguiente; si no, sigue abajo.
  }
  if (ultimoTipo === 'cuota' || ultimoTipo === 'saturado') marcarCaida(ultimoTipo, pausaSugerida)
  const err = ultimoError ?? new Error('Fallo desconocido llamando a Gemini.')
  err.status = err.status ?? 502
  throw err
}
