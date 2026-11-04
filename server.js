'use strict';
const createApp = require('./mini');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { makeStore } = require('./store');

const ROOT = (process.env.ROOT_DOMAIN || 'kattalo.online').toLowerCase();
const APP_HOST = (process.env.APP_HOST || 'app.' + ROOT).toLowerCase();
const PORT = +process.env.PORT || 3000;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '';
const SECRET = process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex');
const MODEL = process.env.ANTHROPIC_MODEL || 'claude-sonnet-5-5';
const AI_DAILY = +process.env.AI_DAILY_LIMIT || 300;
const META_ID = process.env.META_APP_ID || '';
const META_SECRET = process.env.META_APP_SECRET || '';
const GRAPH = 'https://graph.facebook.com/' + (process.env.META_GRAPH_VERSION || 'v21.0');
const RESERVED = new Set(['app', 'www', 'api', 'admin', 'mail', 'ftp', 'cpanel', 'webmail', 'painel', 'login', 'static', 'assets', 'autopage', 'sites', 'superdelivery', 'thefull', 'adv', 'arrematekids', ...String(process.env.RESERVED_SUBS || '').split(',').map(x => x.trim().toLowerCase()).filter(Boolean)]);
const APP_HTML = fs.readFileSync(path.join(__dirname, 'public', 'app.html'), 'utf8');
const SHIM = fs.readFileSync(path.join(__dirname, 'public', 'shim.js'), 'utf8');

const sign = (s) => crypto.createHmac('sha256', SECRET).update(s).digest('base64url');
const safeEq = (a, b) => { const x = Buffer.from(String(a)), y = Buffer.from(String(b)); return x.length === y.length && crypto.timingSafeEqual(x, y); };
const mkToken = (obj, ttlMs) => { const p = Buffer.from(JSON.stringify({ ...obj, exp: Date.now() + ttlMs })).toString('base64url'); return p + '.' + sign(p); };
const readToken = (t) => { try { const [p, s] = String(t).split('.'); if (!p || !s || !safeEq(sign(p), s)) return null; const o = JSON.parse(Buffer.from(p, 'base64url').toString()); return o.exp > Date.now() ? o : null; } catch (e) { return null; } };
const cookies = (req) => Object.fromEntries(String(req.headers.cookie || '').split(';').map(c => c.trim().split('=')).filter(a => a[0]).map(a => [a[0], a.slice(1).join('=')]));
const isAdmin = (req) => !!readToken(cookies(req).ap_s);
const hostOf = (req) => String(req.headers.host || '').toLowerCase().replace(/:\d+$/, '');
function kind(host) {
  if (host === APP_HOST) return { t: 'app' };
  if (host.endsWith('.' + ROOT)) { const sub = host.slice(0, -ROOT.length - 1); if (/^[a-z0-9-]{1,40}$/.test(sub) && !RESERVED.has(sub)) return { t: 'site', slug: sub }; return { t: 'none' }; }
  return { t: 'app' }; // localhost, *.onrender.com e afins abrem o app
}
const esc = (s) => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const slugify = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 30).replace(/-+$/, '') || 'site';

// ---- limites simples em memória
const hits = new Map();
function limited(key, max, windowMs) {
  const now = Date.now(); const a = (hits.get(key) || []).filter(t => now - t < windowMs);
  if (a.length >= max) { hits.set(key, a); return true; }
  a.push(now); hits.set(key, a); return false;
}
setInterval(() => { const now = Date.now(); for (const [k, a] of hits) if (!a.some(t => now - t < 3600e3)) hits.delete(k); }, 600e3).unref();
const ipOf = (req) => String(req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim();
let aiDay = { d: '', n: 0 };

async function main() {
  if (process.env.RENDER && !process.env.DATABASE_URL) throw new Error('Defina DATABASE_URL (Postgres). Sem banco, os dados se perdem a cada reinício no Render.');
  const store = await makeStore();
  const app = createApp();
  app.disable('x-powered-by');
  app.set('trust proxy', true);
  app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    if (req.headers['x-forwarded-proto'] === 'https') res.setHeader('Strict-Transport-Security', 'max-age=31536000');
    next();
  });

  const page = (req, res, extra) => {
    const html = APP_HTML.replace('<script>', '<script>' + extra + SHIM + '</script><script>');
    res.setHeader('Cache-Control', 'no-store');
    res.type('html').send(html);
  };
  const cfg = (o) => 'window.__ROOT=' + JSON.stringify(ROOT) + ';window.__CFG=' + JSON.stringify(o).replace(/</g, '\\u003c') + ';';

  app.get('/healthz', (req, res) => res.json({ ok: true, store: store.kind }));
  app.get('/privacidade', (req, res) => res.type('html').send('<!doctype html><meta charset=utf-8><meta name=viewport content="width=device-width,initial-scale=1"><title>Política de Privacidade</title><body style="font:16px/1.6 system-ui;max-width:720px;margin:40px auto;padding:0 16px"><h1>Política de Privacidade</h1><p>O AutoPage cria sites para negócios. Quando o cliente conecta o Instagram ou o Facebook, lemos somente dados públicos do perfil comercial (nome, bio, endereço, telefone, horário e legendas recentes) para montar o site. Não publicamos nada nas suas redes, não guardamos o token de acesso e não vendemos dados.</p><p>Para pedir a exclusão dos seus dados, fale com o administrador do serviço em ' + esc(ROOT) + '.</p></body>'));
  app.all('/meta/data-deletion', (req, res) => res.json({ url: 'https://' + APP_HOST + '/privacidade', confirmation_code: crypto.randomBytes(6).toString('hex') }));

  // ---- login
  const loginPage = (msg) => '<!doctype html><html lang=pt-BR><meta charset=utf-8><meta name=viewport content="width=device-width,initial-scale=1"><title>AutoPage.ai · Entrar</title><body style="margin:0;min-height:100vh;display:grid;place-items:center;background:#0b1020;color:#e8ecff;font:16px system-ui"><form method=post action=/login style="width:min(340px,90vw);background:#141a33;padding:28px;border-radius:16px;display:grid;gap:12px"><h2 style="margin:0">🪄 AutoPage.ai</h2>' + (msg ? '<div style="color:#fca5a5">' + esc(msg) + '</div>' : '') + '<input type=password name=password placeholder=Senha autofocus required style="padding:12px;border-radius:10px;border:1px solid #2b3566;background:#0b1020;color:#fff"><button style="padding:12px;border:0;border-radius:10px;background:#4f46e5;color:#fff;font-weight:700">Entrar</button></form></html>';
  app.post('/login', (req, res) => {
    if (kind(hostOf(req)).t !== 'app') return res.status(404).end();
    if (limited('login:' + ipOf(req), 8, 15 * 60e3)) return res.status(429).type('html').send(loginPage('Muitas tentativas. Aguarde 15 minutos.'));
    if (!ADMIN_PASSWORD || !safeEq(req.body.password || '', ADMIN_PASSWORD)) return res.status(401).type('html').send(loginPage('Senha incorreta.'));
    const secure = req.headers['x-forwarded-proto'] === 'https' ? '; Secure' : '';
    res.setHeader('Set-Cookie', 'ap_s=' + mkToken({ a: 1 }, 7 * 864e5) + '; HttpOnly; SameSite=Lax; Path=/; Max-Age=' + 7 * 86400 + secure);
    res.redirect('/');
  });
  app.post('/logout', (req, res) => { res.setHeader('Set-Cookie', 'ap_s=; HttpOnly; Path=/; Max-Age=0'); res.redirect('/'); });

  // ---- páginas
  app.get('/', async (req, res) => {
    const k = kind(hostOf(req));
    if (k.t === 'none') return res.status(404).type('text').send('Não encontrado');
    if (k.t === 'app') {
      if (!ADMIN_PASSWORD) return res.status(503).type('text').send('Defina ADMIN_PASSWORD no servidor.');
      if (!isAdmin(req)) return res.type('html').send(loginPage(''));
      return page(req, res, cfg({ meta: !!(META_ID && META_SECRET), site: false }));
    }
    const ptr = await store.get('slug/' + k.slug);
    if (!ptr) return res.status(404).type('html').send('<!doctype html><meta charset=utf-8><meta name=viewport content="width=device-width,initial-scale=1"><body style="font:16px system-ui;display:grid;place-items:center;min-height:100vh;margin:0"><p>Site não encontrado.</p>');
    return page(req, res, cfg({ site: true }) + 'window.__SITE_ID=' + JSON.stringify(ptr.id) + ';');
  });

  // ---- "banco" (mesma interface que o app usa no Claude)
  const ID = /^[a-z0-9]{1,16}$/;
  app.post('/api/db', async (req, res) => {
    try {
      const b = req.body || {}; const admin = isAdmin(req); const op = b.op;
      if (op === 'get') {
        const m = /^sites\/([a-z0-9]{1,16})$/.exec(String(b.path)); if (!m) return res.status(403).json({ error: 'forbidden' });
        const d = await store.get('sites/' + m[1]);
        return res.json(d ? { exists: true, data: { j: d.j, name: d.name, at: d.at } } : { exists: false });
      }
      if (op === 'add' && b.coll === 'events') {
        if (limited('ev:' + ipOf(req), 120, 60e3)) return res.status(429).json({ error: 'rate' });
        const e = b.data || {};
        if (!ID.test(String(e.s)) || (e.t !== 'view' && e.t !== 'click')) return res.status(400).json({ error: 'bad' });
        if (!(await store.get('sites/' + e.s))) return res.status(400).json({ error: 'bad' });
        const id = crypto.randomBytes(8).toString('hex');
        await store.set('events/' + id, { s: e.s, t: e.t, b: String(e.b || '').replace(/[^a-z0-9]/gi, '').slice(0, 16), at: Date.now() });
        if (Math.random() < 0.01) store.trim('events/', 20000).catch(() => {});
        return res.json({ id });
      }
      if (!admin) return res.status(401).json({ error: 'auth' });
      if (op === 'set') {
        const m = /^sites\/([a-z0-9]{1,16})$/.exec(String(b.path)); const d = b.data || {};
        if (!m || typeof d.j !== 'string' || d.j.length > 1100000) return res.status(400).json({ error: 'bad' });
        let p; try { p = JSON.parse(d.j); } catch (e) { return res.status(400).json({ error: 'bad' }); }
        const prev = await store.get('sites/' + m[1]);
        let slug = prev && prev.slug;
        if (!slug) {
          const base = slugify(p.name); let c = base, n = 1;
          while (RESERVED.has(c) || await store.get('slug/' + c)) { n++; c = base + '-' + n; if (n > 50) { c = base + '-' + m[1]; break; } }
          slug = c;
          await store.set('slug/' + slug, { id: m[1], at: Date.now() });
        }
        await store.set('sites/' + m[1], { j: d.j, name: String(d.name || '').slice(0, 80), at: Date.now(), slug });
        return res.json({ ok: true, slug });
      }
      if (op === 'delete') {
        const m = /^(sites|events)\/([a-z0-9]{1,16})$/.exec(String(b.path)); if (!m) return res.status(400).json({ error: 'bad' });
        if (m[1] === 'sites') { const d = await store.get('sites/' + m[2]); if (d && d.slug) await store.del('slug/' + d.slug); await store.del('sites/' + m[2]); }
        else await store.del('events/' + m[2]);
        return res.json({ ok: true });
      }
      if (op === 'list' && b.coll === 'events') {
        const lim = Math.min(3000, Math.max(1, +b.limit || 500));
        const rows = await store.list('events/', lim, true);
        return res.json({ docs: rows.map(r => ({ id: r.path.slice(7), data: r.data })) });
      }
      if (op === 'all' && b.coll === 'sites') { // lista dos sites publicados (para conferência)
        const rows = await store.list('sites/', 500, true);
        return res.json({ docs: rows.map(r => ({ id: r.path.slice(6), data: { name: r.data.name, slug: r.data.slug, at: r.data.at } })) });
      }
      return res.status(400).json({ error: 'op' });
    } catch (e) { console.error('db', e.message); res.status(500).json({ error: 'server' }); }
  });

  // ---- IA (Anthropic)
  app.post('/api/ai', async (req, res) => {
    if (!isAdmin(req)) return res.status(401).json({ error: 'auth' });
    const GKEY = process.env.GEMINI_API_KEY, AKEY = process.env.ANTHROPIC_API_KEY;
    if (!GKEY && !AKEY) return res.status(503).json({ error: 'sem_chave' });
    const today = new Date().toISOString().slice(0, 10); if (aiDay.d !== today) aiDay = { d: today, n: 0 };
    if (aiDay.n >= AI_DAILY || limited('ai:' + ipOf(req), 30, 60e3)) return res.status(429).json({ error: 'limite' });
    aiDay.n++;
    try {
      const prompt = String(req.body.prompt || '').slice(0, 20000) + '\n\nResponda somente com JSON válido, sem texto extra.';
      const imgs = (Array.isArray(req.body.images) ? req.body.images : []).slice(0, 4).map(u => /^data:(image\/(?:jpeg|png|webp|gif));base64,([A-Za-z0-9+/=]+)$/.exec(String(u))).filter(Boolean).filter(m => m[2].length < 7e6);
      let txt = '';
      if (GKEY) { // Gemini (plano gratuito do Google AI Studio)
        const models = [process.env.GEMINI_MODEL, 'gemini-3.8-flash', 'gemini-flash-latest', 'gemini-2.5-flash'].filter((m, i, a) => m && a.indexOf(m) === i);
        const parts = [...imgs.map(m => ({ inline_data: { mime_type: m[1], data: m[2] } })), { text: prompt }];
        const body = JSON.stringify({ contents: [{ role: 'user', parts }], generationConfig: { responseMimeType: 'application/json', maxOutputTokens: 4000, temperature: 0.2 } });
        let lastStatus = 502;
        for (const model of models) {
          const url = process.env.GEMINI_URL || 'https://generativelanguage.googleapis.com/v1beta/models/' + model + ':generateContent';
          const r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', 'x-goog-api-key': GKEY }, body });
          const j = await r.json();
          if (r.ok) { txt = (((j.candidates || [])[0] || {}).content || { parts: [] }).parts.map(p => p.text || '').join(''); break; }
          lastStatus = r.status; console.error('gemini', model, r.status, JSON.stringify(j).slice(0, 200));
          if (r.status !== 404 && r.status !== 400) break; // só tenta o próximo modelo se este não existir
        }
        if (!txt) return res.status(lastStatus === 429 ? 429 : 502).json({ error: 'ia' });
      } else { // Anthropic (pago)
        const content = [...imgs.map(m => ({ type: 'image', source: { type: 'base64', media_type: m[1], data: m[2] } })), { type: 'text', text: prompt }];
        const r = await fetch(process.env.ANTHROPIC_URL || 'https://api.anthropic.com/v1/messages', { method: 'POST', headers: { 'content-type': 'application/json', 'x-api-key': AKEY, 'anthropic-version': '2023-06-01' }, body: JSON.stringify({ model: MODEL, max_tokens: 4000, messages: [{ role: 'user', content }] }) });
        const j = await r.json();
        if (!r.ok) { console.error('anthropic', r.status, JSON.stringify(j).slice(0, 300)); return res.status(502).json({ error: 'ia' }); }
        txt = (j.content || []).filter(c => c.type === 'text').map(c => c.text).join('');
      }
      const a = txt.indexOf('{'), z = txt.lastIndexOf('}');
      if (a < 0 || z < a) return res.status(502).json({ error: 'formato' });
      return res.json({ value: JSON.parse(txt.slice(a, z + 1)) });
    } catch (e) { console.error('ai', e.message); res.status(502).json({ error: 'ia' }); }
  });

  // ---- Meta (Instagram/Facebook) via API oficial
  const redirectUri = () => 'https://' + APP_HOST + '/auth/meta/callback';
  const origin = (req) => (req.headers['x-forwarded-proto'] || req.protocol) + '://' + req.headers.host;
  app.get('/auth/meta/start', (req, res) => {
    if (kind(hostOf(req)).t !== 'app' || !isAdmin(req)) return res.status(401).type('text').send('Entre no app primeiro.');
    if (!META_ID || !META_SECRET) return res.status(503).type('text').send('Meta não configurada (META_APP_ID/META_APP_SECRET).');
    const state = mkToken({ n: crypto.randomBytes(6).toString('hex') }, 10 * 60e3);
    const ru = process.env.META_REDIRECT_URI || redirectUri();
    res.redirect('https://www.facebook.com/' + (process.env.META_GRAPH_VERSION || 'v21.0') + '/dialog/oauth?' + new URLSearchParams({ client_id: META_ID, redirect_uri: ru, state, response_type: 'code', scope: 'pages_show_list,pages_read_engagement,instagram_basic' }));
  });
  const DOW = { mon: 'seg', tue: 'ter', wed: 'qua', thu: 'qui', fri: 'sex', sat: 'sáb', sun: 'dom' };
  async function gj(url) { const r = await fetch(url); const j = await r.json(); if (!r.ok) throw new Error((j.error && j.error.message) || 'graph'); return j; }
  async function metaProfile(code) {
    const ru = process.env.META_REDIRECT_URI || redirectUri();
    const t = await gj(GRAPH + '/oauth/access_token?' + new URLSearchParams({ client_id: META_ID, client_secret: META_SECRET, redirect_uri: ru, code }));
    const pages = await gj(GRAPH + '/me/accounts?' + new URLSearchParams({ access_token: t.access_token, limit: '10', fields: 'name,about,phone,single_line_address,hours,website,emails,instagram_business_account{username,name,biography,website,profile_picture_url,media.limit(12){caption,timestamp}}' }));
    const pg = (pages.data || [])[0]; if (!pg) throw new Error('Nenhuma Página do Facebook encontrada nesta conta.');
    const ig = pg.instagram_business_account || {};
    const hrs = []; const h = pg.hours || {};
    for (const d of Object.keys(DOW)) if (h[d + '_1_open'] && h[d + '_1_close']) hrs.push(DOW[d] + ' ' + h[d + '_1_open'] + '-' + h[d + '_1_close']);
    const caps = ((ig.media && ig.media.data) || []).map(m => String(m.caption || '').replace(/\s+/g, ' ').trim()).filter(Boolean).slice(0, 12).map(c => c.slice(0, 300));
    const lines = [];
    if (pg.about) lines.push('Sobre (Facebook): ' + pg.about);
    if (ig.biography) lines.push('Bio (Instagram' + (ig.username ? ' @' + ig.username : '') + '): ' + ig.biography);
    if (pg.single_line_address) lines.push('Endereço: ' + pg.single_line_address);
    if (pg.phone) lines.push('Telefone: ' + pg.phone);
    if (hrs.length) lines.push('Horário: ' + hrs.join(', '));
    if (pg.website || ig.website) lines.push('Site: ' + (pg.website || ig.website));
    if (caps.length) lines.push('Postagens recentes:\n- ' + caps.join('\n- '));
    let logo = '';
    if (ig.profile_picture_url) { try { const r = await fetch(ig.profile_picture_url); const ct = (r.headers.get('content-type') || '').split(';')[0]; const buf = Buffer.from(await r.arrayBuffer()); if (/^image\/(jpeg|png|webp)$/.test(ct) && buf.length < 180000) logo = 'data:' + ct + ';base64,' + buf.toString('base64'); } catch (e) {} }
    return { name: String(ig.name || pg.name || '').slice(0, 60), phone: String(pg.phone || ''), text: lines.join('\n').slice(0, 5000), logo, handle: ig.username || '' };
  }
  app.get('/auth/meta/callback', async (req, res) => {
    const out = (data) => res.type('html').send('<!doctype html><meta charset=utf-8><body style="font:16px system-ui;padding:30px">' + (data.error ? '<p>' + esc(data.error) + '</p>' : '<p>Conectado! Pode fechar esta janela.</p>') + '<script>try{window.opener&&window.opener.postMessage({ap:"meta",data:' + JSON.stringify(data).replace(/</g, '\\u003c') + '},' + JSON.stringify(origin(req)) + ')}catch(e){}setTimeout(function(){window.close()},1200)</script>');
    try {
      if (!isAdmin(req)) return out({ error: 'Sessão expirada. Entre no app e tente de novo.' });
      if (req.query.error) return out({ error: 'Conexão cancelada.' });
      if (!readToken(String(req.query.state || ''))) return out({ error: 'Pedido inválido ou expirado.' });
      if (!req.query.code) return out({ error: 'Código ausente.' });
      out(await metaProfile(String(req.query.code)));
    } catch (e) { out({ error: 'Não foi possível ler a conta: ' + e.message }); }
  });

  app.use((req, res) => res.status(404).type('text').send('Não encontrado'));
  app.use((err, req, res, next) => { console.error(err.message); res.status(err.status || 500).json({ error: 'erro' }); });
  const srv = app.listen(PORT, () => console.log('AutoPage server na porta ' + PORT + ' · armazenamento: ' + store.kind + ' · app: ' + APP_HOST));
  return { app, srv, store };
}
if (require.main === module) main().catch(e => { console.error(e); process.exit(1); });
module.exports = { main };
