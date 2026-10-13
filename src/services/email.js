// ============================================================
// email.js — Capa de abstracción de correo transaccional
// ============================================================
// El resto del sistema nunca habla con el proveedor directamente:
// solo llama a `enviarCorreo({ to, subject, html, texto })`. Cambiar
// de proveedor (Resend → Postmark/SES/SendGrid, el día que haga
// falta) es tocar SOLO este archivo.
//
// Modo sandbox: sin EMAIL_PROVIDER=resend (o sin RESEND_API_KEY),
// el "envío" es imprimir el correo en la consola del servidor. Así
// se puede probar todo el flujo de verificación/reset en local sin
// gastar cupo de un proveedor real ni exponer credenciales.
//
// Dominio: para que Resend (o cualquier proveedor) no mande los
// correos a spam, el dominio en EMAIL_FROM necesita sus registros
// SPF, DKIM y DMARC publicados en el DNS — eso se configura en el
// panel del proveedor + tu proveedor de DNS, no en este código. Ver
// server/.env.example y el README para los pasos.
// ============================================================
import { config } from '../config.js'

function comoTexto(html) {
  return html.replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, '').replace(/\n{3,}/g, '\n\n').trim()
}

async function enviarConResend({ to, subject, html, texto }) {
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.resendApiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ from: config.emailDesde, to, subject, html, text: texto ?? comoTexto(html) }),
  })
  if (!res.ok) {
    const cuerpo = await res.text().catch(() => '')
    throw new Error(`Resend respondió ${res.status}: ${cuerpo.slice(0, 300)}`)
  }
}

function enviarPorConsola({ to, subject, html, texto }) {
  console.log(
    '\n  ✉️  [correo — modo sandbox, no se mandó de verdad] ' +
    '\n      Define EMAIL_PROVIDER=resend + RESEND_API_KEY para mandarlo real.' +
    `\n      Para:    ${to}` +
    `\n      Asunto:  ${subject}` +
    `\n      ${'-'.repeat(50)}\n${(texto ?? comoTexto(html)).split('\n').map((l) => '      ' + l).join('\n')}` +
    `\n      ${'-'.repeat(50)}\n`
  )
}

/**
 * Manda un correo transaccional. Nunca lanza hacia arriba si el
 * proveedor falla — lo registra y sigue (un correo que no salió no
 * debe tumbar la petición HTTP que lo disparó); quien llama puede
 * revisar el valor de retorno si necesita saberlo.
 */
// Solo en tests: los correos "enviados" quedan acá para leerlos (por
// ejemplo, el código de inicio de sesión).
export const bandejaDePrueba = []

export async function enviarCorreo({ to, subject, html, texto }) {
  if (config.entorno === 'test') { bandejaDePrueba.push({ to, subject, html }); return true }
  try {
    if (config.emailProveedor === 'resend' && config.resendApiKey) {
      await enviarConResend({ to, subject, html, texto })
    } else {
      enviarPorConsola({ to, subject, html, texto })
    }
    return true
  } catch (e) {
    console.error('  [email] no se pudo enviar:', e.message)
    return false
  }
}

// ── Plantillas ──────────────────────────────────────────────
const envoltorio = (titulo, cuerpoHtml) => `
  <div style="font-family:sans-serif;max-width:480px;margin:0 auto;color:#142843">
    <h2 style="margin-bottom:4px">${titulo}</h2>
    ${cuerpoHtml}
    <p style="color:#94a3b8;font-size:12px;margin-top:32px">
      English Lessons — Plataforma. Si no esperabas este correo, puedes ignorarlo.
    </p>
  </div>`

const boton = (href, etiqueta) => `
  <p style="margin:24px 0">
    <a href="${href}" style="background:#ef8312;color:#fff;padding:10px 18px;border-radius:8px;
      text-decoration:none;font-weight:600;display:inline-block">${etiqueta}</a>
  </p>
  <p style="font-size:12px;color:#475569">Si el botón no funciona, copia este enlace:<br>${href}</p>`

export function enviarVerificacionCuenta({ email, nombre, token, esReenvio = false }) {
  const href = `${config.appUrl}/activar-cuenta?token=${token}`
  return enviarCorreo({
    to: email,
    subject: esReenvio ? 'Tu enlace para activar tu cuenta (nuevo)' : 'Activa tu cuenta — English Lessons',
    html: envoltorio('Activa tu cuenta', `
      <p>Hola ${nombre},</p>
      <p>Se creó una cuenta de staff para ti en English Lessons — Plataforma. Para activarla,
      confirma tu correo y elige tu contraseña:</p>
      ${boton(href, 'Activar mi cuenta')}
      <p>Este enlace vale por ${config.tokenTtlMin} minutos y solo se puede usar una vez.</p>
    `),
  })
}

export function enviarCodigoLogin({ email, nombre, codigo, minutos }) {
  return enviarCorreo({
    to: email,
    subject: `${codigo} es tu código para entrar — English Lessons`,
    html: envoltorio('Tu código para entrar', `
      <p>Hola ${nombre},</p>
      <p>Para terminar de iniciar sesión, escribe este código:</p>
      <p style="font-size:32px;font-weight:800;letter-spacing:8px;margin:20px 0;color:#142843">${codigo}</p>
      <p>Vale por ${minutos} minutos y solo sirve una vez.</p>
      <p>Si <strong>no</strong> intentaste entrar, alguien conoce tu contraseña: cámbiala y avisa a tu administrador.</p>
    `),
  })
}

export function enviarResetPassword({ email, nombre, token }) {
  const href = `${config.appUrl}/restablecer-password?token=${token}`
  return enviarCorreo({
    to: email,
    subject: 'Restablecer tu contraseña — English Lessons',
    html: envoltorio('Restablecer tu contraseña', `
      <p>Hola ${nombre},</p>
      <p>Pediste restablecer tu contraseña. Si no fuiste tú, ignora este correo — tu
      contraseña actual sigue funcionando.</p>
      ${boton(href, 'Elegir nueva contraseña')}
      <p>Este enlace vale por ${config.tokenTtlMin} minutos y solo se puede usar una vez.</p>
    `),
  })
}

export function enviarAvisoCambioPassword({ email, nombre }) {
  return enviarCorreo({
    to: email,
    subject: 'Tu contraseña cambió — English Lessons',
    html: envoltorio('Tu contraseña cambió', `
      <p>Hola ${nombre},</p>
      <p>Te escribimos para avisarte que la contraseña de tu cuenta (${email}) acaba de
      cambiar. Si fuiste tú, no necesitas hacer nada.</p>
      <p>Si <strong>no</strong> fuiste tú, contacta a tu administrador de inmediato.</p>
    `),
  })
}

export function enviarConfirmacionCambioEmail({ emailNuevo, nombre, token }) {
  const href = `${config.appUrl}/confirmar-email?token=${token}`
  return enviarCorreo({
    to: emailNuevo,
    subject: 'Confirma tu nuevo correo — English Lessons',
    html: envoltorio('Confirma tu nuevo correo', `
      <p>Hola ${nombre},</p>
      <p>Pediste cambiar el correo de tu cuenta a esta dirección. Confírmalo para que el
      cambio tome efecto — mientras tanto, tu cuenta sigue usando el correo anterior:</p>
      ${boton(href, 'Confirmar este correo')}
      <p>Este enlace vale por ${config.tokenTtlMin} minutos y solo se puede usar una vez.</p>
    `),
  })
}

export function enviarAvisoCambioEmail({ emailAnterior, emailNuevo, nombre }) {
  return enviarCorreo({
    to: emailAnterior,
    subject: 'El correo de tu cuenta cambió — English Lessons',
    html: envoltorio('El correo de tu cuenta cambió', `
      <p>Hola ${nombre},</p>
      <p>El correo de tu cuenta cambió de <strong>${emailAnterior}</strong> a
      <strong>${emailNuevo}</strong>. Si fuiste tú, no necesitas hacer nada.</p>
      <p>Si <strong>no</strong> fuiste tú, contacta a tu administrador de inmediato — esta
      dirección ya no podrá usarse para entrar a la cuenta.</p>
    `),
  })
}
