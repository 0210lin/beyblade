'use strict';
const fs = require('fs');
const path = require('path');

let cache = null;
/** 後台頁面（assets/admin.html；Vercel 會隨 includeFiles 一起打包） */
function html() {
  if (!cache) cache = fs.readFileSync(path.join(__dirname, '..', 'assets', 'admin.html'), 'utf8');
  return cache;
}

module.exports = { html };
