// Mini-framework HTTP sem dependências (substitui o Express): rotas, JSON, formulário, helpers de resposta.
const http = require('http');
function createApp() {
  const routes = [], mws = []; let notFound = null, onErr = null;
  const app = {
    disable() {}, set() {},
    use(fn) { if (fn.length === 4) onErr = fn; else if (fn.length === 3) mws.push(fn); else notFound = fn; },
    get: (p, h) => routes.push(['GET', p, h]), post: (p, h) => routes.push(['POST', p, h]), all: (p, h) => routes.push(['*', p, h]),
    listen(port, cb) { return http.createServer(handle).listen(port, cb); }
  };
  function decorate(req, res) {
    const u = new URL(req.url, 'http://x'); req.path = u.pathname; req.query = Object.fromEntries(u.searchParams);
    req.protocol = req.headers['x-forwarded-proto'] || 'http';
    res.status = (c) => { res.statusCode = c; return res; };
    res.type = (t) => { res.setHeader('Content-Type', ({ html: 'text/html; charset=utf-8', text: 'text/plain; charset=utf-8', json: 'application/json' })[t] || t); return res; };
    res.send = (b) => { if (!res.getHeader('Content-Type')) res.type('html'); res.end(b); return res; };
    res.json = (o) => { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(o)); return res; };
    res.redirect = (l) => { res.statusCode = 302; res.setHeader('Location', l); res.end(); };
  }
  function body(req, limit) {
    return new Promise((ok, no) => {
      if (req.method === 'GET' || req.method === 'HEAD') return ok({});
      const chunks = []; let n = 0;
      req.on('data', c => { n += c.length; if (n > limit) { const e = new Error('too large'); e.status = 413; req.destroy(); no(e); } else chunks.push(c); });
      req.on('end', () => {
        const raw = Buffer.concat(chunks).toString('utf8'), ct = String(req.headers['content-type'] || '');
        try {
          if (ct.includes('application/json')) return ok(raw ? JSON.parse(raw) : {});
          if (ct.includes('application/x-www-form-urlencoded')) return ok(Object.fromEntries(new URLSearchParams(raw)));
          ok({});
        } catch (e) { e.status = 400; no(e); }
      });
      req.on('error', no);
    });
  }
  async function handle(req, res) {
    try {
      decorate(req, res);
      const lim = req.path === '/api/db' || req.path === '/api/ai' ? 9e6 : 8e3;
      req.body = await body(req, lim);
      for (const m of mws) await new Promise((ok) => m(req, res, ok));
      const r = routes.find(x => (x[0] === req.method || x[0] === '*') && x[1] === req.path);
      if (r) return await r[2](req, res);
      if (notFound) return notFound(req, res);
      res.statusCode = 404; res.end('Not found');
    } catch (e) {
      if (onErr) return onErr(e, req, res, () => {});
      res.statusCode = e.status || 500; res.end('error');
    }
  }
  return app;
}
module.exports = createApp;
