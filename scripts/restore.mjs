// ============================================================
// restore.mjs — Restaurar un backup desde la línea de comandos
// ============================================================
//   node scripts/restore.mjs              → lista los backups disponibles
//   node scripts/restore.mjs <nombre>     → restaura ese backup
//
// Sobreescribe config.dataDir con los *.json del backup elegido.
// Pensado para correr con el servidor APAGADO. Si el backup incluye
// un dump de Postgres (postgres.sql), ese paso queda aparte a
// propósito — restaurar una base de verdad no es algo para
// automatizar sin que una persona lo confirme.
// ============================================================
import { listarBackups, restaurarDesde } from '../src/services/backups.js'

const arg = process.argv[2]

if (!arg) {
  const backups = listarBackups()
  if (!backups.length) {
    console.log('\nNo hay backups todavía. Corré primero: node scripts/backup.mjs\n')
  } else {
    console.log('\nBackups disponibles (más nuevo primero):\n')
    for (const b of backups) {
      const extra = b.postgres_dump ? ', + dump de Postgres' : ''
      console.log(`  ${b.nombre}   (${b.motivo}, ${b.colecciones_json.length} colecciones${extra})`)
    }
    console.log('\nPara restaurar uno: node scripts/restore.mjs <nombre>\n')
  }
  process.exit(0)
}

console.log(`\n⚠️  Esto sobreescribe los datos actuales en DATA_DIR con el backup "${arg}".`)
console.log('   Confirmá que el servidor está apagado antes de restaurar.\n')

try {
  const { restaurados, archivos } = restaurarDesde(arg)
  console.log(`✔ Restaurados ${restaurados} archivo(s): ${archivos.join(', ')}`)
  console.log('\nSi ese backup también tiene un dump de Postgres, restauralo aparte con:')
  console.log(`  psql "$DATABASE_URL" -f backups/${arg}/postgres.sql\n`)
} catch (e) {
  console.error(`\n✘ ${e.message}\n`)
  process.exit(1)
}
