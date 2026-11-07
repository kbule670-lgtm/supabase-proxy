// Minimal reverse proxy: forwards every request to the Supabase project.
// No dependencies, Node 18+ (uses global fetch). Deployed on Zeabur free tier.
// The app points SUPABASE_URL at this proxy instead of *.supabase.co,
// so phones without a VPN can reach Supabase. Auth/RLS still enforced by
// Supabase itself; this proxy adds no auth and stores nothing.
const UPSTREAM = 'https://bcgtsaspoegdvxyfarxg.supabase.co';
const PORT = process.env.PORT || 8080;
const http = require('http');

const HOP = new Set([
  'connection',
  'keep-alive',
  'transfer-encoding',
  'te',
  'trailer',
  'proxy-authorization',
  'proxy-authenticate',
  'upgrade',
]);

const server = http.createServer((req, res) => {
  if (req.url === '/' || req.url === '/health') {
    res.writeHead(200, { 'content-type': 'text/plain' });
    res.end('ok');
    return;
  }
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'access-control-allow-origin': '*',
      'access-control-allow-headers': '*',
      'access-control-allow-methods': '*',
    });
    res.end();
    return;
  }
  const chunks = [];
  req.on('data', (c) => chunks.push(c));
  req.on('end', async () => {
    const body = chunks.length ? Buffer.concat(chunks) : undefined;
    const headers = {};
    for (const [k, v] of Object.entries(req.headers)) {
      const lk = k.toLowerCase();
      if (!HOP.has(lk) && lk !== 'host') headers[k] = v;
    }
    try {
      const upstream = await fetch(UPSTREAM + req.url, {
        method: req.method,
        headers,
        body:
          body && req.method !== 'GET' && req.method !== 'HEAD'
            ? body
            : undefined,
        redirect: 'manual',
      });
      const outHeaders = {};
      upstream.headers.forEach((v, k) => {
        if (!HOP.has(k.toLowerCase())) outHeaders[k] = v;
      });
      outHeaders['access-control-allow-origin'] = '*';
      const buf = Buffer.from(await upstream.arrayBuffer());
      res.writeHead(upstream.status, outHeaders);
      res.end(buf);
    } catch (e) {
      res.writeHead(502, { 'content-type': 'text/plain' });
      res.end('upstream error');
    }
  });
});

server.listen(PORT, () => console.log('proxy listening on ' + PORT));
