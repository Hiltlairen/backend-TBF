import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.test.js'],
    // Aislamiento por archivo (default de vitest, explícito acá a
    // propósito): cada archivo de test importa src/index.js de cero,
    // así que las variables de entorno que fija appTest.mjs no se
    // mezclan entre archivos que corren en paralelo.
    pool: 'forks',
    isolate: true,
    testTimeout: 15_000,
    hookTimeout: 15_000,
  },
})
