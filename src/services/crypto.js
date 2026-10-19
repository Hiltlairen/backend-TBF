// ============================================================
// crypto.js — Cifrado en reposo para datos de identidad
// ============================================================
// Se usa SOLO sobre el campo `nombre` de la tabla `estudiantes`
// (la "identidad"). Los "hechos" (puntajes, resultados) nunca
// pasan por aquí: no son datos personales por sí solos.
//
// AES-256-GCM: cada valor cifrado lleva su propio IV al frente
// (nunca se reutiliza) y un tag de autenticación que detecta
// manipulación. Formato de salida: "v1:<iv>:<tag>:<datos>" en
// base64url, para poder rotar el esquema en el futuro sin romper
// lo que ya está guardado.
// ============================================================
import crypto from 'node:crypto'
import { config } from '../config.js'

const ALGORITMO = 'aes-256-gcm'
const PREFIJO = 'v1'

let avisoLlaveMostrado = false

/**
 * Deriva una llave de 32 bytes a partir de ENCRYPTION_KEY.
 * Sin ENCRYPTION_KEY en el .env, usa una llave DETERMINÍSTICA de
 * desarrollo (misma en cada arranque, para no perder los datos ya
 * guardados en modo demo) pero avisa fuerte en consola. En producción
 * hay que definir ENCRYPTION_KEY o los datos quedan cifrados con
 * una llave conocida públicamente en este código.
 */
// La llave se deriva UNA vez por proceso: scryptSync tarda decenas de ms
// y antes se recalculaba en cada cifrar()/descifrar() — con cientos de
// resultados, la lista del docente tardaba segundos (prueba de carga, 3.7).
let llaveCache = null
function llave() {
  return (llaveCache ??= derivarLlave())
}

function derivarLlave() {
  const material = config.encryptionKey?.trim()
  if (!material) {
    if (!avisoLlaveMostrado) {
      console.warn(
        '\n  ⚠️  ENCRYPTION_KEY no está definida: la tabla de identidad se cifra con una' +
        '\n      llave de DESARROLLO fija (NO segura). Define ENCRYPTION_KEY en tu .env antes' +
        '\n      de desplegar a producción:\n' +
        '      node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"\n'
      )
      avisoLlaveMostrado = true
    }
    return crypto.scryptSync('llave-demo-NO-usar-en-produccion', 'sal-fija-demo', 32)
  }
  // Acepta hex de 64 chars (32 bytes) o cualquier passphrase (se deriva con scrypt).
  if (/^[0-9a-fA-F]{64}$/.test(material)) return Buffer.from(material, 'hex')
  return crypto.scryptSync(material, 'english-lessons-platform', 32)
}

/** Cifra un texto plano. Devuelve null si la entrada es null/undefined. */
export function cifrar(texto) {
  if (texto === null || texto === undefined) return null
  const iv = crypto.randomBytes(12)
  const cipher = crypto.createCipheriv(ALGORITMO, llave(), iv)
  const datos = Buffer.concat([cipher.update(String(texto), 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return [PREFIJO, iv.toString('base64url'), tag.toString('base64url'), datos.toString('base64url')].join(':')
}

/** Descifra un valor producido por cifrar(). Si no tiene el formato esperado, lo devuelve tal cual
 *  (compatibilidad con datos sembrados antes de activar el cifrado). */
export function descifrar(valor) {
  if (valor === null || valor === undefined) return null
  const partes = String(valor).split(':')
  if (partes.length !== 4 || partes[0] !== PREFIJO) return valor
  try {
    const [, ivB64, tagB64, datosB64] = partes
    const decipher = crypto.createDecipheriv(ALGORITMO, llave(), Buffer.from(ivB64, 'base64url'))
    decipher.setAuthTag(Buffer.from(tagB64, 'base64url'))
    const texto = Buffer.concat([decipher.update(Buffer.from(datosB64, 'base64url')), decipher.final()])
    return texto.toString('utf8')
  } catch (e) {
    console.error('  [crypto] no se pudo descifrar un valor de identidad:', e.message)
    return '(no se pudo leer)'
  }
}

/** true si el valor ya está en formato cifrado (para no cifrar dos veces). */
export function estaCifrado(valor) {
  return typeof valor === 'string' && valor.split(':').length === 4 && valor.startsWith(`${PREFIJO}:`)
}
