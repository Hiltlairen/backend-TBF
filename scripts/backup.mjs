// ============================================================
// backup.mjs — Backup manual desde la línea de comandos
// ============================================================
//   node scripts/backup.mjs
//
// Hace lo mismo que el job automático (services/backups.js) pero a
// demanda: útil antes de un cambio riesgoso, o corrido desde un cron
// del sistema operativo si se prefiere eso al job en memoria del
// propio servidor (ver README, "Backups y plan de recuperación").
// ============================================================
import { respaldarAhora, listarBackups } from '../src/services/backups.js'

const { nombre, manifest, podados } = respaldarAhora({ motivo: 'manual (cli)' })

console.log(`\n✔ Backup creado: ${nombre}`)
console.log(`  colecciones JSON respaldadas: ${manifest.colecciones_json.length}`)
console.log(`  dump de Postgres: ${manifest.postgres_dump ?? 'no incluido (sin DATABASE_URL, o falló pg_dump)'}`)
if (podados) console.log(`  se podaron ${podados} backup(s) viejo(s) por retención.`)
console.log(`\nTotal de backups guardados ahora: ${listarBackups().length}\n`)
