// ============================================================
// backups.js — Backups y plan de recuperación (punto 6)
// ============================================================
// Qué se respalda, en cada corrida:
//   · El espejo JSON completo (config.dataDir/*.json) — es la fuente
//     de verdad cuando no hay Postgres, y el espejo write-through
//     cuando sí lo hay (útil igual: es lo que lee el store al
//     arrancar si Postgres no responde).
//   · Si hay Postgres (DATABASE_URL), además un dump con `pg_dump` —
//     ahí sí es la fuente de verdad real.
// Cada backup es una carpeta con timestamp bajo config.backupDir;
// nunca se sobreescribe uno viejo. La retención (config.backupRetener)
// poda los más antiguos después de cada corrida, automática o manual.
//
// Por qué esto es más crítico ahora que antes (ver README, punto 6):
// hay un job de purga automática corriendo (services/purga.js) que
// anonimiza identidades sin vuelta atrás pasada la ventana de
// retención. Un backup es la única red de seguridad ante un borrado
// accidental, un bug, o una purga disparada antes de tiempo.
// ============================================================
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { config, tieneDB } from '../config.js'
import { logger } from './logger.js'
import { enviarAlerta } from './alertas.js'

function marcaDeTiempo(d = new Date()) {
  return d.toISOString().replace(/[:.]/g, '-')
}

function archivosDeDatos() {
  if (!fs.existsSync(config.dataDir)) return []
  return fs.readdirSync(config.dataDir).filter((f) => f.endsWith('.json'))
}

/** Corre un backup ahora mismo. Devuelve la carpeta creada y su manifest. */
export function respaldarAhora({ motivo = 'manual' } = {}) {
  const nombre = marcaDeTiempo()
  const destino = path.join(config.backupDir, nombre)
  fs.mkdirSync(destino, { recursive: true })

  const archivos = archivosDeDatos()
  for (const archivo of archivos) {
    fs.copyFileSync(path.join(config.dataDir, archivo), path.join(destino, archivo))
  }

  // El dump de Postgres es best-effort: si el cliente `pg_dump` no
  // está instalado en este host, el backup del JSON (arriba) ya se
  // guardó igual — nunca se pierde ese, aunque falte el de la BD.
  let postgresDump = null
  if (tieneDB()) {
    try {
      execFileSync('pg_dump', [config.databaseUrl, '-f', path.join(destino, 'postgres.sql')], {
        stdio: ['ignore', 'ignore', 'pipe'],
      })
      postgresDump = 'postgres.sql'
    } catch (e) {
      logger.error({ err: e.message }, '[backup] pg_dump falló (¿está instalado el cliente de Postgres en este host?)')
    }
  }

  const manifest = {
    creado_en: new Date().toISOString(),
    motivo,
    colecciones_json: archivos,
    postgres_dump: postgresDump,
  }
  fs.writeFileSync(path.join(destino, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf8')

  const podados = podarViejos()
  return { nombre, ruta: destino, manifest, podados }
}

/** Lista los backups existentes, más nuevo primero. */
export function listarBackups() {
  if (!fs.existsSync(config.backupDir)) return []
  return fs.readdirSync(config.backupDir)
    .filter((nombre) => fs.existsSync(path.join(config.backupDir, nombre, 'manifest.json')))
    .sort()
    .reverse()
    .map((nombre) => {
      const manifest = JSON.parse(fs.readFileSync(path.join(config.backupDir, nombre, 'manifest.json'), 'utf8'))
      return { nombre, ...manifest }
    })
}

/** Borra los backups más viejos que exceden config.backupRetener. Devuelve cuántos podó. */
function podarViejos() {
  const sobran = listarBackups().slice(Math.max(0, config.backupRetener))
  for (const b of sobran) fs.rmSync(path.join(config.backupDir, b.nombre), { recursive: true, force: true })
  return sobran.length
}

/**
 * Restaura un backup: copia sus *.json de vuelta a config.dataDir,
 * sobreescribiendo lo que hay. NO reinicia Postgres automáticamente
 * —eso es una decisión operativa, no algo para automatizar sin
 * confirmación humana—; el comando de `psql` para ese paso está
 * documentado en el README junto al resto del plan de recuperación.
 * Pensado para correr con el servidor apagado.
 */
export function restaurarDesde(nombre) {
  const origen = path.join(config.backupDir, nombre)
  if (!fs.existsSync(path.join(origen, 'manifest.json'))) {
    throw new Error(`No existe el backup "${nombre}" (o le falta manifest.json).`)
  }
  fs.mkdirSync(config.dataDir, { recursive: true })
  const archivos = fs.readdirSync(origen).filter((f) => f.endsWith('.json') && f !== 'manifest.json')
  for (const archivo of archivos) {
    fs.copyFileSync(path.join(origen, archivo), path.join(config.dataDir, archivo))
  }
  return { restaurados: archivos.length, archivos }
}

function fallo(e, momento) {
  logger.error({ err: e.message, momento }, 'backup automático falló')
  enviarAlerta('backup-fallo', `El job de backup (${momento}) falló: ${e.message}`, { momento }).catch(() => {})
}

let temporizador = null

/** Arranca el job periódico. Llamar una sola vez al iniciar el servidor. */
export function iniciarProgramadorBackups() {
  if (temporizador) return
  // Mismo límite de Node que en services/purga.js: no dejar que un
  // BACKUP_INTERVAL_HOURS grande desborde el máximo de setInterval.
  const intervaloMs = Math.min(Math.max(1, config.backupIntervaloHoras) * 60 * 60 * 1000, 2_147_483_647)

  // Primer backup poco después de arrancar (deja que termine la
  // hidratación desde Postgres, si aplica) y luego cada intervalo.
  const primero = setTimeout(() => {
    try { respaldarAhora({ motivo: 'automatico' }) } catch (e) { fallo(e, 'inicial') }
  }, 60_000)
  primero.unref?.()

  temporizador = setInterval(() => {
    try { respaldarAhora({ motivo: 'automatico' }) } catch (e) { fallo(e, 'periódico') }
  }, intervaloMs)
  temporizador.unref?.()

  console.log(`  [backup] job de respaldo activo: cada ${config.backupIntervaloHoras}h, retiene los últimos ${config.backupRetener}.`)
}
