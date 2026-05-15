// email.js — serviço de envio de email
const nodemailer = require('nodemailer');

function createTransporter() {
  return nodemailer.createTransport({
    host:   process.env.SMTP_HOST   || 'smtp.gmail.com',
    port:   parseInt(process.env.SMTP_PORT || '587'),
    secure: process.env.SMTP_SECURE === 'true',
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
  });
}

async function sendWelcomeEmail({ to, name, username }) {
  const siteUrl = process.env.SITE_URL || 'http://localhost:3000';
  const loginUrl = `${siteUrl}/`;

  const transporter = createTransporter();

  const html = `
<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>Bem-vindo(a) ao DAILY</title>
</head>
<body style="margin:0;padding:0;background:#f5f0e8;font-family:'Georgia',serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f5f0e8;padding:40px 0;">
    <tr><td align="center">
      <table width="560" cellpadding="0" cellspacing="0" style="background:#0f0e0d;border-radius:20px;overflow:hidden;max-width:560px;">
        <!-- Header -->
        <tr>
          <td style="padding:40px 48px 32px;text-align:center;background:linear-gradient(135deg,#0f0e0d 0%,#1a1528 100%);">
            <div style="font-size:48px;font-style:italic;font-weight:900;color:#f5f0e8;letter-spacing:-1px;margin-bottom:6px;">Daily</div>
            <div style="font-size:11px;letter-spacing:4px;text-transform:uppercase;color:#c9a84c;">sua vida · seu tempo</div>
          </td>
        </tr>
        <!-- Body -->
        <tr>
          <td style="padding:36px 48px;">
            <p style="font-size:22px;font-weight:bold;color:#f5f0e8;margin:0 0 16px;">Bem-vindo(a), ${name}! 🎉</p>
            <p style="font-size:15px;color:#8a8070;line-height:1.7;margin:0 0 12px;">
              Sua conta no <strong style="color:#c9a84c;">DAILY</strong> foi criada com sucesso.
              A partir de agora você tem um espaço só seu para registrar sua vida, dia após dia.
            </p>
            <p style="font-size:15px;color:#8a8070;line-height:1.7;margin:0 0 28px;">
              Seu nome de usuário é <strong style="color:#c9a84c;font-family:monospace;">@${username}</strong> — guarde esse dado.
            </p>
            <!-- CTA -->
            <table cellpadding="0" cellspacing="0" style="margin:0 auto 32px;">
              <tr>
                <td style="background:#c9a84c;border-radius:10px;padding:0;">
                  <a href="${loginUrl}" style="display:block;padding:16px 40px;font-family:sans-serif;font-size:15px;font-weight:600;color:#0f0e0d;text-decoration:none;border-radius:10px;">
                    Acessar o DAILY →
                  </a>
                </td>
              </tr>
            </table>
            <p style="font-size:12px;color:#5a5248;text-align:center;margin:0;">
              Ou acesse diretamente: <a href="${loginUrl}" style="color:#c9a84c;">${loginUrl}</a>
            </p>
          </td>
        </tr>
        <!-- Footer -->
        <tr>
          <td style="padding:20px 48px;border-top:1px solid rgba(245,240,232,0.08);text-align:center;">
            <p style="font-size:11px;color:#5a5248;margin:0;font-family:sans-serif;">
              Você recebeu este email porque se cadastrou no DAILY.<br>
              Se não foi você, ignore esta mensagem.
            </p>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;

  await transporter.sendMail({
    from:    process.env.EMAIL_FROM || 'DAILY <noreply@daily.app>',
    to,
    subject: 'Bem-vindo(a) ao DAILY — sua vida, seu tempo 🗓️',
    html,
    text: `Bem-vindo(a) ao DAILY, ${name}!\n\nSeu usuário: @${username}\n\nAcesse: ${loginUrl}`,
  });
}

module.exports = { sendWelcomeEmail };
