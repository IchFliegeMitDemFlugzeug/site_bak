import express from 'express';
import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import nodemailer from 'nodemailer';
import { pathToFileURL } from 'node:url';

const HOST = '127.0.0.1';
const PORT = 3001;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function normalizeClientIp(value) {
  if (typeof value !== 'string') return '';

  const ip = value.trim();

  const ipv4WithPort = ip.match(/^(\d{1,3}(?:\.\d{1,3}){3}):\d+$/);
  if (ipv4WithPort) return ipv4WithPort[1];

  const bracketedIpv6WithPort = ip.match(/^\[([0-9a-fA-F:]+)\]:\d+$/);
  if (bracketedIpv6WithPort) return bracketedIpv6WithPort[1];

  return ip;
}

export function createContactApp({ transport } = {}) {
  const app = express();
  const smtpHost = process.env.SMTP_HOST;
  const smtpPort = Number(process.env.SMTP_PORT);
  const smtpUser = process.env.SMTP_USER;
  const smtpPass = process.env.SMTP_PASS;
  const contactTo = process.env.CONTACT_TO;
  if (!transport && (!smtpHost || !smtpPort || !smtpUser || !smtpPass || !contactTo)) {
    throw new Error('Required SMTP environment is incomplete');
  }
  const mailTransport = transport || nodemailer.createTransport({
    host: smtpHost,
    port: smtpPort,
    secure: false,
    requireTLS: true,
    auth: { user: smtpUser, pass: smtpPass },
  });
  const limiter = rateLimit({
    keyGenerator: request => ipKeyGenerator(normalizeClientIp(request.ip || request.socket.remoteAddress || '127.0.0.1')),
    windowMs: 15 * 60 * 1000,
    limit: 5,
    standardHeaders: true,
    legacyHeaders: false,
    handler: (_request, response) => response.status(429).json({ ok: false, error: 'rate_limit' }),
  });

  app.disable('x-powered-by');
  app.set('trust proxy', ip => ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1');
  app.use(express.json({ limit: '16kb' }));
  app.get('/api/health', (_request, response) => response.status(200).json({ ok: true }));
  app.post('/api/contact', limiter, async (request, response) => {
    const body = request.body;
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return response.status(400).json({ ok: false, error: 'validation' });
    }

    if (typeof body.website === 'string' && body.website.trim()) {
      return response.status(200).json({ ok: true });
    }

    const name = typeof body.name === 'string' ? body.name.trim() : null;
    const email = typeof body.email === 'string' ? body.email.trim() : null;
    const company = body.company === undefined ? '' : typeof body.company === 'string' ? body.company.trim() : null;
    const message = typeof body.message === 'string' ? body.message.trim() : null;
    const valid = name && name.length <= 100
      && email && email.length <= 254 && EMAIL_PATTERN.test(email)
      && company !== null && company.length <= 150
      && message && message.length <= 5000;

    if (!valid) return response.status(400).json({ ok: false, error: 'validation' });

    try {
      const sender = smtpUser;
      const recipient = contactTo;
      const text = `Новая заявка с сайта btsys.ru\n\nИмя:\n${name}\n\nЭлектронная почта:\n${email}\n\nКомпания / организация:\n${company || 'не указана'}\n\nСообщение:\n${message}`;
      await mailTransport.sendMail({
        to: recipient,
        from: sender,
        replyTo: email,
        subject: `Заявка с сайта btsys.ru — ${name}`,
        text,
      });
      return response.status(200).json({ ok: true });
    } catch (error) {
      console.error('Contact form delivery failed:', error);
      return response.status(500).json({ ok: false, error: 'server' });
    }
  });

  app.use((_error, _request, response, _next) => response.status(400).json({ ok: false, error: 'validation' }));
  return app;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  createContactApp().listen(PORT, HOST, () => console.log(`Contact API is listening on http://${HOST}:${PORT}`));
}
