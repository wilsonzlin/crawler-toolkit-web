#!/usr/bin/env node

const fs = require("node:fs");

const url = new URL(process.argv[2]);
const dir = __dirname + "/" + encodeURIComponent(`${url.hostname}${url.pathname}${url.search}`);
fs.mkdirSync(dir);
fetch(url).then(res => res.arrayBuffer()).then(res => fs.writeFileSync(dir + "/src.html", new Uint8Array(res)));
