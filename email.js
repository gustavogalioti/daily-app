const nodemailer = require('nodemailer');

function createTransporter() {
  return nodemailer.createTransport({
    host:   process.env.SMTP_HOST   || 'smtp-relay.brevo.com',
    port:   parseInt(process.env.SMTP_PORT || '587'),
    secure: process.env.SMTP_SECURE === 'true',
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
    connectionTimeout: 10000,
    greetingTimeout: 10000,
    socketTimeout: 15000
  });
}

async function sendWelcomeEmail({ to, name, username }) {
  const siteUrl = process.env.SITE_URL || 'http://localhost:3000';
  const t = createTransporter();
  const html = `
  <body style="margin:0;padding:0;background:#f5f0e8;font-family:Georgia,serif;">
    <table width="100%" cellpadding="0" cellspacing="0" style="background:#f5f0e8;padding:40px 0;">
      <tr><td align="center">
        <table width="560" cellpadding="0" cellspacing="0" style="background:#0f0e0d;border-radius:20px;overflow:hidden;max-width:560px;">
          <tr><td style="padding:40px 48px 32px;text-align:center;">
            <div style="font-size:48px;font-style:italic;font-weight:900;color:#f5f0e8;">Daily</div>
            <div style="font-size:11px;letter-spacing:4px;text-transform:uppercase;color:#c9a84c;">compartilhe seu momento com o mundo</div>
          </td></tr>
          <tr><td style="padding:36px 48px;">
            <p style="font-size:22px;font-weight:bold;color:#f5f0e8;margin:0 0 16px;">Bem-vindo(a), ${name}! 🎉</p>
            <p style="font-size:15px;color:#8a8070;line-height:1.7;margin:0 0 28px;">
              Sua conta no <strong style="color:#c9a84c;">DAILY</strong> foi criada. Seu usuário é <strong style="color:#c9a84c;font-family:monospace;">@${username}</strong>.
            </p>
            <table cellpadding="0" cellspacing="0" style="margin:0 auto 32px;">
              <tr><td style="background:#c9a84c;border-radius:10px;">
                <a href="${siteUrl}" style="display:block;padding:16px 40px;font-family:sans-serif;font-size:15px;font-weight:600;color:#0f0e0d;text-decoration:none;">Acessar o DAILY →</a>
              </td></tr>
            </table>
          </td></tr>
        </table>
      </td></tr>
    </table>
  </body>`;
  await t.sendMail({ from: process.env.EMAIL_FROM || 'DAILY <noreply@daily.app>', to, subject: 'Bem-vindo(a) ao DAILY 🗓️', html });
}

async function sendNotificationEmail({ to, name, notificationId, siteUrl }) {
  const t = createTransporter();
  const url = `${siteUrl || process.env.SITE_URL || 'http://localhost:3000'}/?notif=${notificationId}`;
  const html = `
  <body style="margin:0;padding:0;background:#0f0e0d;font-family:Georgia,serif;">
    <table width="100%" cellpadding="0" cellspacing="0" style="padding:40px 0;">
      <tr><td align="center">
        <table width="500" cellpadding="0" cellspacing="0" style="background:#1a1a1a;border-radius:20px;overflow:hidden;max-width:500px;border:2px solid #c9a84c;">
          <tr><td style="padding:40px 40px 20px;text-align:center;">
            <div style="font-size:60px;margin-bottom:16px;">📷</div>
            <div style="font-size:28px;font-weight:900;color:#c9a84c;margin-bottom:8px;">Hora da foto!</div>
            <p style="font-size:16px;color:#8a8070;line-height:1.6;margin:0 0 30px;">
              Olá, <strong style="color:#f5f0e8;">${name}</strong>!<br>
              Você tem <strong style="color:#c9a84c;">1 minuto</strong> para postar sua foto agora.
            </p>
            <table cellpadding="0" cellspacing="0" style="margin:0 auto;">
              <tr><td style="background:#c9a84c;border-radius:12px;">
                <a href="${url}" style="display:block;padding:18px 50px;font-family:sans-serif;font-size:18px;font-weight:700;color:#0f0e0d;text-decoration:none;">📷 Postar agora →</a>
              </td></tr>
            </table>
            <p style="font-size:12px;color:#5a5248;margin-top:24px;font-family:sans-serif;">Este link expira em 1 minuto.</p>
          </td></tr>
        </table>
      </td></tr>
    </table>
  </body>`;
  await t.sendMail({ from: process.env.EMAIL_FROM || 'DAILY <noreply@daily.app>', to, subject: '📷 Hora da foto! Você tem 1 minuto — DAILY', html });
}

module.exports = { sendWelcomeEmail, sendNotificationEmail, sendPasswordResetEmail };

async function sendPasswordResetEmail({ to, name, resetLink }) {
  const t = createTransporter();
  const html = `
    <div style="font-family:Arial,sans-serif;max-width:520px;margin:0 auto;background:#fff;border-radius:16px;overflow:hidden;border:1px solid #eee;">
      <div style="background:linear-gradient(135deg,#f97316,#ff6b35);padding:32px;text-align:center;">
        <div style="font-family:Georgia,serif;font-size:32px;font-weight:900;color:#fff;letter-spacing:-1px;">D<span style="color:#fff3e0;">.</span>AILY</div>
      </div>
      <div style="padding:32px;">
        <h2 style="color:#1a1a1a;margin:0 0 12px;">Redefinição de senha 🔑</h2>
        <p style="color:#555;line-height:1.6;margin:0 0 24px;">Olá, <strong>${name}</strong>! Recebemos uma solicitação para redefinir a senha da sua conta DAILY.</p>
        <p style="color:#555;line-height:1.6;margin:0 0 24px;">Clique no botão abaixo para criar uma nova senha. O link é válido por <strong>1 hora</strong>.</p>
        <div style="text-align:center;margin:28px 0;">
          <a href="${resetLink}" style="background:#f97316;color:#fff;text-decoration:none;padding:14px 32px;border-radius:10px;font-weight:700;font-size:15px;display:inline-block;">Redefinir minha senha →</a>
        </div>
        <p style="color:#999;font-size:12px;line-height:1.6;margin:0;">Se você não solicitou isso, ignore este e-mail. Sua senha permanecerá a mesma.<br><br>Link direto: <a href="${resetLink}" style="color:#f97316;">${resetLink}</a></p>
      </div>
      <div style="background:#f9f9f9;padding:16px;text-align:center;">
        <p style="color:#bbb;font-size:11px;margin:0;">© DAILY · yourdaily.com.br</p>
      </div>
    </div>
  `;
  await t.sendMail({
    from: process.env.EMAIL_FROM || 'DAILY <noreply@yourdaily.com.br>',
    to,
    subject: '🔑 Redefinição de senha — DAILY',
    html,
  });
}
