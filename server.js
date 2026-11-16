'use strict';
// Render（Web Service）/ 本機執行用：node server.js
const http = require('http');
const webhook = require('./api/webhook');
const admin = require('./api/admin');
const health = require('./api/health');

const port = process.env.PORT || 3000;
const run = (fn, req, res) => fn(req, res).catch((e) => { console.error(e); res.statusCode = 500; res.end('error'); });

http
  .createServer((req, res) => {
    const p = req.url.split('?')[0];
    if (p === '/' || p.startsWith('/healthz')) { res.end('ok'); return; }
    if (p.startsWith('/webhook') || p.startsWith('/api/webhook')) return run(webhook, req, res);
    if (p.startsWith('/api/health')) return run(health, req, res);
    if (p.startsWith('/admin') || p.startsWith('/api/admin')) return run(admin, req, res);
    res.statusCode = 404;
    res.end('not found');
  })
  .listen(port, () => console.log('listening on', port));
