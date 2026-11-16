'use strict';
// Render（Web Service）/ 本機執行用：node server.js
const http = require('http');
const handler = require('./api/webhook');

const port = process.env.PORT || 3000;
http
  .createServer((req, res) => {
    if (req.url === '/' || req.url.startsWith('/health')) { res.end('ok'); return; }
    if (req.url.startsWith('/webhook') || req.url.startsWith('/api/webhook')) {
      handler(req, res).catch((e) => { console.error(e); res.statusCode = 500; res.end('error'); });
      return;
    }
    res.statusCode = 404;
    res.end('not found');
  })
  .listen(port, () => console.log('listening on', port));
