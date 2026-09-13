import { createContactApp } from './server.js';

const HOST = '127.0.0.1';
const portText = process.env.BTS_CONTACT_PORT || '3001';
const PORT = Number(portText);

if (!Number.isInteger(PORT) || PORT < 1 || PORT > 65535) {
  throw new Error('BTS_CONTACT_PORT must be an integer from 1 through 65535');
}

createContactApp().listen(PORT, HOST, () => {
  console.log(`Contact API is listening on http://${HOST}:${PORT}`);
});
