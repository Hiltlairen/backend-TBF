// ============================================================
// avisoPrivacidad.js — Aviso de privacidad para el STAFF
// ============================================================
// Aceptación ACTIVA (no es solo informativo, como el del estudiante):
// se guarda qué versión aceptó cada cuenta y cuándo. Cambiar el
// texto de forma sustancial → subir VERSION para que se vuelva a
// pedir la aceptación a todo el staff.
//
// (El aviso del ESTUDIANTE es distinto: es informativo, sin
// aceptación, y vive directamente en StudentHome.jsx del frontend
// porque el estudiante no tiene cuenta que pueda "aceptar" nada.)
// ============================================================
export const VERSION_ACTUAL = 1

export const TEXTO_ACTUAL = `
Como parte de tu cuenta en English Lessons — Plataforma vas a acceder a datos
de estudiantes menores de edad (nombre y resultados de actividades) que tu
institución nos confía para dar el servicio.

Frente a esos datos, la plataforma actúa como ENCARGADA del tratamiento:
procesamos la información solo para operar el servicio educativo, nunca para
fines propios. Tu institución sigue siendo la dueña del registro oficial.

Lo que esto implica para tu cuenta:
· Solo debes ver o usar los datos de estudiantes para dar clase, calificar o
  dar seguimiento pedagógico — nunca para otro fin.
· La identidad de cada estudiante (nombre) se elimina automáticamente un
  tiempo después de que termina el curso o el estudiante se retira; los
  resultados numéricos quedan de forma anónima para estadísticas.
· Como curador de contenido, por diseño no ves el nombre real detrás de una
  entrega que revisas — solo un identificador.
· No debes exportar, copiar o compartir datos de estudiantes fuera de la
  plataforma salvo que tu institución lo autorice explícitamente.

Al aceptar, confirmas que entendiste estos puntos y que tratarás los datos de
los estudiantes de acuerdo con ellos.
`.trim()

export function avisoPendiente(usuario) {
  return (usuario.aviso_privacidad_version ?? 0) < VERSION_ACTUAL
}
