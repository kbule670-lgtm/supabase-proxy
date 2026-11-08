// Minimal reverse proxy: forwards every request to the Supabase project.
// No dependencies, Node 18+ (uses global fetch). Deployed on Render free tier.
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

// 响应头里必须剥掉的：fetch 拿到的是已解压的 body（undici 会自动解 gzip），
// 再原样转发上游的 content-encoding: gzip，客户端就会拿明文 JSON 当 gzip 解，
// Dart 直接报 FormatException: Filter error, bad data（2026-11-08 V7 实测）。
// content-length 也剥掉，让 Node 按实际 buf 长度重算。
const STRIP_RES = new Set([...HOP, 'content-encoding', 'content-length']);

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
        if (!STRIP_RES.has(k.toLowerCase())) outHeaders[k] = v;
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
