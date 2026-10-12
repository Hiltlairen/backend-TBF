// ============================================================
// backups.test.js — backup/restore de los datos JSON (punto 6)
// ============================================================
// Test unitario, sin la app HTTP: opera directo sobre config.dataDir
// / config.backupDir, con carpetas temporales propias fijadas ANTES
// de importar el servicio (mismo patrón de aislamiento que appTest.mjs).
// ============================================================
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { mkdtempSync, rmSync, existsSync, writeFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

let dataDir, backupDir
let respaldarAhora, listarBackups, restaurarDesde

beforeAll(async () => {
  dataDir = mkdtempSync(path.join(tmpdir(), 'el-bkp-data-'))
  backupDir = mkdtempSync(path.join(tmpdir(), 'el-bkp-store-'))
  process.env.DATA_DIR = dataDir
  process.env.BACKUP_DIR = backupDir
  process.env.BACKUP_RETAIN_COUNT = '3'
  process.env.DATABASE_URL = ''
  ;({ respaldarAhora, listarBackups, restaurarDesde } = await import('../../src/services/backups.js'))

  // Simula un par de colecciones con datos, como las dejaría el store real.
  writeFileSync(path.join(dataDir, 'usuarios.json'), JSON.stringify([{ id: '1', email: 'a@b.com' }]), 'utf8')
  writeFileSync(path.join(dataDir, 'clases.json'), JSON.stringify([{ id: 'c1', nombre: 'Test' }]), 'utf8')
})

afterAll(() => {
  rmSync(dataDir, { recursive: true, force: true })
  rmSync(backupDir, { recursive: true, force: true })
})

describe('respaldarAhora / listarBackups', () => {
  it('copia todas las colecciones JSON existentes a una carpeta con timestamp', () => {
    const { nombre, ruta, manifest } = respaldarAhora({ motivo: 'test' })
    expect(existsSync(path.join(ruta, 'usuarios.json'))).toBe(true)
    expect(existsSync(path.join(ruta, 'clases.json'))).toBe(true)
    expect(existsSync(path.join(ruta, 'manifest.json'))).toBe(true)
    expect(manifest.colecciones_json.sort()).toEqual(['clases.json', 'usuarios.json'])
    expect(manifest.postgres_dump).toBeNull() // sin DATABASE_URL
    expect(nombre).toMatch(/^\d{4}-\d{2}-\d{2}T/)
  })

  it('el contenido copiado es idéntico al original', () => {
    const { ruta } = respaldarAhora({ motivo: 'test' })
    const original = readFileSync(path.join(dataDir, 'usuarios.json'), 'utf8')
    const copiado = readFileSync(path.join(ruta, 'usuarios.json'), 'utf8')
    expect(copiado).toBe(original)
  })

  it('listarBackups devuelve más nuevo primero', async () => {
    const a = respaldarAhora({ motivo: 'uno' })
    await new Promise((r) => setTimeout(r, 5))
    const b = respaldarAhora({ motivo: 'dos' })
    const lista = listarBackups()
    expect(lista[0].nombre).toBe(b.nombre)
    expect(lista.map((x) => x.nombre)).toContain(a.nombre)
  })

  it('poda los backups más viejos según BACKUP_RETAIN_COUNT', async () => {
    // Ya van varios de los tests anteriores; genera más para pasar el límite de 3.
    for (let i = 0; i < 4; i++) {
      respaldarAhora({ motivo: `extra-${i}` })
      await new Promise((r) => setTimeout(r, 5))
    }
    expect(listarBackups().length).toBeLessThanOrEqual(3)
  })
})

describe('restaurarDesde', () => {
  it('trae de vuelta el contenido de un backup, sobreescribiendo lo que haya ahora', () => {
    // 1. Backup con el contenido "bueno" de usuarios.json.
    const original = readFileSync(path.join(dataDir, 'usuarios.json'), 'utf8')
    const { nombre } = respaldarAhora({ motivo: 'antes-de-un-cambio-riesgoso' })

    // 2. Simula un cambio destructivo posterior (el escenario que un
    //    restore está pensado para revertir).
    writeFileSync(path.join(dataDir, 'usuarios.json'), JSON.stringify([]), 'utf8')
    expect(readFileSync(path.join(dataDir, 'usuarios.json'), 'utf8')).not.toBe(original)

    // 3. Restaura ese backup — debe traer de vuelta el contenido original.
    const { restaurados, archivos } = restaurarDesde(nombre)
    expect(restaurados).toBeGreaterThan(0)
    expect(archivos).toContain('usuarios.json')
    expect(readFileSync(path.join(dataDir, 'usuarios.json'), 'utf8')).toBe(original)
  })

  it('lanza un error claro si el backup no existe', () => {
    expect(() => restaurarDesde('no-existe-este-backup')).toThrow(/No existe el backup/)
  })
})
