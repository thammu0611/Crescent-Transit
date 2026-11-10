import nodemailer from 'nodemailer';

/**
 * Outgoing email (verification codes). Configured with SMTP_* settings; without
 * them nothing is sent and the caller decides what to do (in development the
 * code is returned in the response instead, so the flow can still be tried).
 */
export function createMailer(config) {
  const smtp = config.smtp;
  if (!smtp.host) return { configured: false, send: async () => false };
  const transport = nodemailer.createTransport({
    host: smtp.host,
    port: smtp.port,
    secure: smtp.secure,
    auth: smtp.user ? { user: smtp.user, pass: smtp.pass } : undefined,
  });
  return {
    configured: true,
    async send({ to, subject, text, html }) {
      await transport.sendMail({ from: smtp.from, to, subject, text, html });
      return true;
    },
  };
}
