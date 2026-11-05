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
const isAdmin = (req) => !!(req.u && req.u.role === 'admin');
const isAuth = (req) => !!req.u;
const PLANS = { free: { name: 'Gratuito', maxSites: 1, ai: 10 }, basic: { name: 'Básico', maxSites: 3, ai: 30 }, pro: { name: 'Pro', maxSites: 10, ai: 80 }, premium: { name: 'Premium', maxSites: 30, ai: 200 } };
const planOf = (u) => {
  const exp = !!(u.planUntil && u.planUntil < Date.now()), k = PLANS[u.plan] && !exp ? u.plan : 'free', p = PLANS[k];
  return { key: k, name: p.name, maxSites: (u.maxSites > 0 && !exp) ? u.maxSites : p.maxSites, ai: p.ai, until: u.planUntil || 0, expired: exp, wanted: exp ? u.plan : '' };
};
const pwHash = (pw) => { const salt = crypto.randomBytes(16).toString('hex'); return salt + ':' + crypto.scryptSync(String(pw), salt, 32).toString('hex'); };
const pwCheck = (pw, h) => { try { const [salt, hx] = String(h).split(':'); return safeEq(crypto.scryptSync(String(pw), salt, 32).toString('hex'), hx); } catch (e) { return false; } };
const genPw = () => { const al = 'abcdefghjkmnpqrstuvwxyzACDEFGHJKLMNPQRSTUVWXYZ23456789'; let o = ''; for (const b of crypto.randomBytes(10)) o += al[b % al.length]; return o; };
const EMAIL = /^[^\s@]{1,64}@[^\s@]{1,200}\.[^\s@]{2,}$/;
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

  app.use(async (req, res, next) => {
    req.u = null;
    try {
      const t = readToken(cookies(req).ap_s);
      if (t) {
        if (t.a || t.r === 'admin') req.u = { id: 'admin', role: 'admin', name: 'Admin' };
        else if (t.r === 'client' && t.u) { const u = await store.get('users/' + t.u); if (u && u.status === 'active') req.u = { id: u.id, role: 'client', name: u.name, user: u }; }
      }
    } catch (e) { /* sem sessão */ }
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
  const loginPage = (msg) => '<!doctype html><html lang=pt-BR><meta charset=utf-8><meta name=viewport content="width=device-width,initial-scale=1"><title>AutoPage.ai · Entrar</title><body style="margin:0;min-height:100vh;display:grid;place-items:center;background:#0b1020;color:#e8ecff;font:16px system-ui"><form method=post action=/login style="width:min(340px,90vw);background:#141a33;padding:28px;border-radius:16px;display:grid;gap:12px"><h2 style="margin:0">🪄 AutoPage.ai</h2>' + (msg ? '<div style="color:#fca5a5">' + esc(msg) + '</div>' : '') + '<input type=email name=email placeholder="E-mail (admin: pode deixar em branco)" autocomplete=username style="padding:12px;border-radius:10px;border:1px solid #2b3566;background:#0b1020;color:#fff"><input type=password name=password placeholder=Senha autofocus required style="padding:12px;border-radius:10px;border:1px solid #2b3566;background:#0b1020;color:#fff"><button style="padding:12px;border:0;border-radius:10px;background:#4f46e5;color:#fff;font-weight:700">Entrar</button><a href=/planos style="color:#a5b4fc;text-align:center;font-size:14px">Quero contratar um plano</a></form></html>';
  app.post('/login', async (req, res) => {
    if (kind(hostOf(req)).t !== 'app') return res.status(404).end();
    const tooMany = () => res.status(429).type('html').send(loginPage('Muitas tentativas. Aguarde 15 minutos.'));
    const bad = (code, msg) => (limited('login:' + ipOf(req), 10, 15 * 60e3) ? tooMany() : res.status(code).type('html').send(loginPage(msg)));
    const email = String(req.body.email || '').trim().toLowerCase().slice(0, 200), pw = String(req.body.password || '').slice(0, 200);
    const secure = req.headers['x-forwarded-proto'] === 'https' ? '; Secure' : '';
    const setC = (tok) => res.setHeader('Set-Cookie', 'ap_s=' + tok + '; HttpOnly; SameSite=Lax; Path=/; Max-Age=' + 7 * 86400 + secure);
    const idx = email ? await store.get('uemail/' + email) : null, usr = idx ? await store.get('users/' + idx.id) : null;
    if (usr) {
      if (!pwCheck(pw, usr.pw)) return limited('loginE:' + email, 8, 15 * 60e3) ? tooMany() : bad(401, 'E-mail ou senha incorretos.');
      if (usr.status !== 'active') return res.status(403).type('html').send(loginPage('Acesso bloqueado. Fale com o suporte.'));
      usr.lastLogin = Date.now(); await store.set('users/' + usr.id, usr);
      setC(mkToken({ r: 'client', u: usr.id }, 7 * 864e5)); return res.redirect('/');
    }
    const AEM = String(process.env.ADMIN_EMAIL || '').trim().toLowerCase();
    if (!ADMIN_PASSWORD || !safeEq(pw, ADMIN_PASSWORD) || (AEM && email !== AEM)) {
      return bad(401, 'E-mail ou senha incorretos.');
    }
    setC(mkToken({ r: 'admin', u: 'admin' }, 7 * 864e5)); res.redirect('/');
  });
  app.post('/logout', (req, res) => { res.setHeader('Set-Cookie', 'ap_s=; HttpOnly; Path=/; Max-Age=0'); res.redirect('/'); });

  // ---- páginas
  app.get('/', async (req, res) => {
    const k = kind(hostOf(req));
    if (k.t === 'none') return res.status(404).type('text').send('Não encontrado');
    if (k.t === 'app') {
      if (!ADMIN_PASSWORD) return res.status(503).type('text').send('Defina ADMIN_PASSWORD no servidor.');
      if (!isAuth(req)) return res.type('html').send(loginPage(''));
      const uu = req.u.role === 'admin' ? { id: 'admin', role: 'admin', name: 'Admin' } : { id: req.u.id, role: 'client', name: req.u.name, email: req.u.user.email };
      return page(req, res, cfg({ meta: !!(META_ID && META_SECRET), site: false }) + 'window.__U=' + JSON.stringify(uu).replace(/</g, '\\u003c') + ';');
    }
    const ptr = await store.get('slug/' + k.slug);
    if (!ptr) return res.status(404).type('html').send('<!doctype html><meta charset=utf-8><meta name=viewport content="width=device-width,initial-scale=1"><body style="font:16px system-ui;display:grid;place-items:center;min-height:100vh;margin:0"><p>Site não encontrado.</p>');
    try {
      if (!/[?&]nr=1/.test(req.url || '')) {
        const sd = await store.get('sites/' + ptr.id);
        const sj = sd && JSON.parse(sd.j || '{}');
        if (sj && sj.goal === 'links' && sj.redir && Array.isArray(sj.links) && sj.links[0] && /^https:\/\/[^\s"'<>]+$/.test(String(sj.links[0].u || ''))) return res.redirect(String(sj.links[0].u));
      }
    } catch (e) { /* segue para a página normal */ }
    return page(req, res, cfg({ site: true }) + 'window.__SITE_ID=' + JSON.stringify(ptr.id) + ';');
  });

  // ---- "banco" (mesma interface que o app usa no Claude)
  const ID = /^[a-z0-9]{1,16}$/;
  app.post('/api/db', async (req, res) => {
    try {
      const b = req.body || {}; const au = isAuth(req), adm = isAdmin(req); const op = b.op;
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
      if (!au) return res.status(401).json({ error: 'auth' });
      if (op === 'set') {
        const m = /^sites\/([a-z0-9]{1,16})$/.exec(String(b.path)); const d = b.data || {};
        if (!m || typeof d.j !== 'string' || d.j.length > 1100000) return res.status(400).json({ error: 'bad' });
        let p; try { p = JSON.parse(d.j); } catch (e) { return res.status(400).json({ error: 'bad' }); }
        const prev = await store.get('sites/' + m[1]);
        if (prev && !adm && (prev.owner || 'admin') !== req.u.id) return res.status(403).json({ error: 'forbidden' });
        if (!prev && !adm) {
          const rows0 = await store.list('sites/', 500, true), own = rows0.filter(x => x.data && x.data.owner === req.u.id).length, pl = planOf(req.u.user);
          if (own >= pl.maxSites) return res.status(403).json({ error: 'limit', max: pl.maxSites });
        }
        let slug = prev && prev.slug;
        if (!slug) {
          const base = slugify(p.name); let c = base, n = 1;
          while (RESERVED.has(c) || await store.get('slug/' + c)) { n++; c = base + '-' + n; if (n > 50) { c = base + '-' + m[1]; break; } }
          slug = c;
          await store.set('slug/' + slug, { id: m[1], at: Date.now() });
        }
        await store.set('sites/' + m[1], { j: d.j, name: String(d.name || '').slice(0, 80), at: Date.now(), slug, owner: prev ? (prev.owner || 'admin') : req.u.id, goal: String(p.goal || '').slice(0, 20), nItems: Array.isArray(p.items) ? p.items.length : 0 });
        return res.json({ ok: true, slug });
      }
      if (op === 'delete') {
        const m = /^(sites|events)\/([a-z0-9]{1,16})$/.exec(String(b.path)); if (!m) return res.status(400).json({ error: 'bad' });
        if (m[1] === 'events' && !adm) return res.status(403).json({ error: 'forbidden' });
        if (m[1] === 'sites') { const d = await store.get('sites/' + m[2]); if (d && !adm && (d.owner || 'admin') !== req.u.id) return res.status(403).json({ error: 'forbidden' }); if (d && d.slug) await store.del('slug/' + d.slug); await store.del('sites/' + m[2]); }
        else await store.del('events/' + m[2]);
        return res.json({ ok: true });
      }
      if (op === 'list' && b.coll === 'events') {
        const lim = Math.min(3000, Math.max(1, +b.limit || 500));
        let rows = await store.list('events/', lim, true);
        if (!adm) { const own = new Set((await store.list('sites/', 500, true)).filter(x => x.data && x.data.owner === req.u.id).map(x => x.path.slice(6))); rows = rows.filter(x => own.has(x.data && x.data.s)); }
        return res.json({ docs: rows.map(r => ({ id: r.path.slice(7), data: r.data })) });
      }
      if (op === 'all' && b.coll === 'sites') { // lista dos sites publicados (para conferência)
        const rows = (await store.list('sites/', 500, true)).filter(x => adm || (x.data && x.data.owner === req.u.id));
        return res.json({ docs: rows.map(r => ({ id: r.path.slice(6), data: { name: r.data.name, slug: r.data.slug, at: r.data.at } })) });
      }
      return res.status(400).json({ error: 'op' });
    } catch (e) { console.error('db', e.message); res.status(500).json({ error: 'server' }); }
  });

  // ---- IA (Anthropic)
  app.post('/api/ai', async (req, res) => {
    if (!isAuth(req)) return res.status(401).json({ error: 'auth' });
    if (!isAdmin(req) && limited('aiu:' + req.u.id, planOf(req.u.user).ai, 86400e3)) return res.status(429).json({ error: 'limite' });
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
          let r, j;
          for (let t = 0; t < 2; t++) { // modelo sobrecarregado (5xx): espera um instante e tenta de novo
            r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', 'x-goog-api-key': GKEY }, body });
            j = await r.json();
            if (r.status < 500) break;
            console.error('gemini', model, r.status, 'tentativa', t + 1);
            await new Promise(ok => setTimeout(ok, 1500));
          }
          if (r.ok) { txt = (((j.candidates || [])[0] || {}).content || { parts: [] }).parts.map(p => p.text || '').join(''); break; }
          lastStatus = r.status; console.error('gemini', model, r.status, JSON.stringify(j).slice(0, 200));
          if (r.status === 429) break; // cota esgotada: trocar de modelo não ajuda
          // 404/400 (modelo inexistente) e 5xx (sobrecarga) seguem para o próximo modelo
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
    if (kind(hostOf(req)).t !== 'app' || !isAuth(req)) return res.status(401).type('text').send('Entre no app primeiro.');
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
    const pages = await gj(GRAPH + '/me/accounts?' + new URLSearchParams({ access_token: t.access_token, limit: '10', fields: 'name,about,phone,single_line_address,hours,website,emails,instagram_business_account{username,name,biography,website,profile_picture_url,media.limit(12){caption,timestamp,media_type,media_url}}' }));
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
    const photos = [];
    for (const m of ((ig.media && ig.media.data) || [])) {
      if (photos.length >= 6) break;
      if (m.media_type !== 'IMAGE' || !m.media_url) continue;
      try { const r = await fetch(m.media_url); const ct = (r.headers.get('content-type') || '').split(';')[0]; const buf = Buffer.from(await r.arrayBuffer()); if (/^image\/(jpeg|png|webp)$/.test(ct) && buf.length < 300000) photos.push('data:' + ct + ';base64,' + buf.toString('base64')); } catch (e) { /* ignora foto */ }
    }
    return { name: String(ig.name || pg.name || '').slice(0, 60), phone: String(pg.phone || ''), text: lines.join('\n').slice(0, 5000), logo, photos, handle: ig.username || '' };
  }
  app.get('/auth/meta/callback', async (req, res) => {
    const out = (data) => res.type('html').send('<!doctype html><meta charset=utf-8><body style="font:16px system-ui;padding:30px">' + (data.error ? '<p>' + esc(data.error) + '</p>' : '<p>Conectado! Pode fechar esta janela.</p>') + '<script>try{window.opener&&window.opener.postMessage({ap:"meta",data:' + JSON.stringify(data).replace(/</g, '\\u003c') + '},' + JSON.stringify(origin(req)) + ')}catch(e){}setTimeout(function(){window.close()},1200)</script>');
    try {
      if (!isAuth(req)) return out({ error: 'Sessão expirada. Entre no app e tente de novo.' });
      if (req.query.error) return out({ error: 'Conexão cancelada.' });
      if (!readToken(String(req.query.state || ''))) return out({ error: 'Pedido inválido ou expirado.' });
      if (!req.query.code) return out({ error: 'Código ausente.' });
      out(await metaProfile(String(req.query.code)));
    } catch (e) { out({ error: 'Não foi possível ler a conta: ' + e.message }); }
  });

  // ---- agendamento público (reserva de horários por site publicado)
  const brNow = () => new Date(Date.now() - 3 * 3600e3);
  const ymd = (d) => d.toISOString().slice(0, 10);
  const hmToMin = (t) => { const m = /^(\d\d):(\d\d)$/.exec(String(t || '')); return m && +m[1] < 24 && +m[2] < 60 ? +m[1] * 60 + +m[2] : null; };
  async function bookingSite(req) {
    const k = kind(hostOf(req)); if (k.t !== 'site') return null;
    const ptr = await store.get('slug/' + k.slug); if (!ptr) return null;
    const d = await store.get('sites/' + ptr.id); if (!d) return null;
    let j; try { j = JSON.parse(d.j || '{}'); } catch (e) { return null; }
    return j.goal === 'booking' ? { id: ptr.id, j } : null;
  }
  let bkLock = Promise.resolve();
  const bkRun = (fn) => { const p = bkLock.then(fn, fn); bkLock = p.catch(() => {}); return p; };
  app.all('/api/slots', async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    if (req.method === 'OPTIONS') { res.setHeader('Access-Control-Allow-Methods', 'GET,POST'); res.setHeader('Access-Control-Allow-Headers', 'Content-Type'); return res.status(204).end(); }
    try {
      if (limited('sl:' + ipOf(req), 120, 60e3)) return res.status(429).json({ error: 'rate' });
      const st = await bookingSite(req); const d = String(req.query.d || '');
      if (!st || !/^\d{4}-\d\d-\d\d$/.test(d)) return res.status(400).json({ error: 'bad' });
      const doc = await store.get('book/' + st.id + '/' + d);
      res.json({ taken: ((doc && doc.items) || []).map(x => x.t) });
    } catch (e) { res.status(500).json({ error: 'server' }); }
  });
  app.all('/api/book', async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    if (req.method === 'OPTIONS') { res.setHeader('Access-Control-Allow-Methods', 'GET,POST'); res.setHeader('Access-Control-Allow-Headers', 'Content-Type'); return res.status(204).end(); }
    if (req.method !== 'POST') return res.status(405).json({ error: 'method' });
    try {
      if (limited('bk:' + ipOf(req), 8, 3600e3)) return res.status(429).json({ error: 'rate' });
      const st = await bookingSite(req); const b = req.body || {};
      const d = String(b.d || ''), t = String(b.t || ''), n = String(b.n || '').replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, 80), sv = String(b.s || '').replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, 80);
      if (!st || !/^\d{4}-\d\d-\d\d$/.test(d) || !n) return res.status(400).json({ error: 'bad' });
      const dt = new Date(d + 'T12:00:00Z'); if (isNaN(dt)) return res.status(400).json({ error: 'bad' });
      const now = brNow(), today = ymd(now);
      if (d < today || d > ymd(new Date(now.getTime() + 120 * 864e5))) return res.status(400).json({ error: 'date' });
      const dow = dt.getUTCDay(), dy = ['todos', 'semana', 'sabado'].includes(st.j.days) ? st.j.days : 'todos';
      if (!(dy === 'todos' || (dy === 'semana' && dow > 0 && dow < 6) || (dy === 'sabado' && dow > 0))) return res.status(400).json({ error: 'closed' });
      const op = hmToMin(st.j.open) != null ? hmToMin(st.j.open) : 540, cl = hmToMin(st.j.close) != null ? hmToMin(st.j.close) : 1080, tm = hmToMin(t);
      if (tm == null || tm < op || tm + 30 > cl || (tm - op) % 30) return res.status(400).json({ error: 'time' });
      if (d === today && tm <= now.getUTCHours() * 60 + now.getUTCMinutes()) return res.status(400).json({ error: 'past' });
      const out = await bkRun(async () => {
        const key = 'book/' + st.id + '/' + d, doc = (await store.get(key)) || { items: [] };
        if (doc.items.some(x => x.t === t)) return 409;
        if (doc.items.length >= 48) return 400;
        doc.items.push({ t, n, s: sv, at: Date.now() }); await store.set(key, doc); return 200;
      });
      res.status(out).json(out === 200 ? { ok: true } : { error: out === 409 ? 'taken' : 'full' });
    } catch (e) { console.error('book', e.message); res.status(500).json({ error: 'server' }); }
  });
  const canSite = async (req, id) => { if (isAdmin(req)) return true; const d = await store.get('sites/' + id); return !!(d && req.u && (d.owner || 'admin') === req.u.id); };
  app.get('/api/bookings', async (req, res) => {
    if (kind(hostOf(req)).t !== 'app' || !isAuth(req)) return res.status(401).json({ error: 'auth' });
    const id = String(req.query.site || ''); if (!ID.test(id)) return res.status(400).json({ error: 'bad' });
    if (!(await canSite(req, id))) return res.status(403).json({ error: 'forbidden' });
    const rows = await store.list('book/' + id + '/', 400, false);
    const today = ymd(brNow()), items = [];
    rows.forEach(r => { const d = r.path.split('/').pop(); ((r.data && r.data.items) || []).forEach(x => items.push({ d, t: x.t, n: x.n, s: x.s })); });
    items.sort((a, b) => (a.d + a.t < b.d + b.t ? -1 : 1));
    res.json({ items: items.filter(x => x.d >= today) });
  });
  app.post('/api/bookings/cancel', async (req, res) => {
    if (kind(hostOf(req)).t !== 'app' || !isAuth(req)) return res.status(401).json({ error: 'auth' });
    const b = req.body || {}, id = String(b.site || ''), d = String(b.d || ''), t = String(b.t || '');
    if (!ID.test(id) || !/^\d{4}-\d\d-\d\d$/.test(d)) return res.status(400).json({ error: 'bad' });
    if (!(await canSite(req, id))) return res.status(403).json({ error: 'forbidden' });
    await bkRun(async () => { const key = 'book/' + id + '/' + d, doc = await store.get(key); if (!doc) return; doc.items = doc.items.filter(x => x.t !== t); if (doc.items.length) await store.set(key, doc); else await store.del(key); });
    res.json({ ok: true });
  });

  // ---- painéis: estatísticas, conta, administração de clientes
  const dayBR = (ts) => new Date(ts - 3 * 3600e3).toISOString().slice(0, 10);
  async function allSites() {
    const rows = await store.list('sites/', 500, true);
    return rows.map(x => { const d = x.data || {}; let goal = d.goal, n = d.nItems; if (goal == null) { try { const p = JSON.parse(d.j || '{}'); goal = p.goal || 'landing'; n = (p.items || []).length; } catch (e) { goal = 'landing'; n = 0; } } return { id: x.path.slice(6), name: d.name || '', slug: d.slug || '', owner: d.owner || 'admin', at: d.at || 0, goal, items: n || 0 }; });
  }
  async function computeStats(sites) {
    const ids = new Set(sites.map(x => x.id)), now = Date.now(), today = dayBR(now);
    const evr = (await store.list('events/', 3000, true)).filter(x => x.data && ids.has(x.data.s));
    const per = {}; sites.forEach(x => { per[x.id] = { v7: 0, c7: 0, v30: 0, c30: 0 }; });
    const ser = {}; for (let i = 13; i >= 0; i--) ser[dayBR(now - i * 864e5)] = { d: dayBR(now - i * 864e5), v: 0, c: 0 };
    const t = { views7: 0, clicks7: 0, views30: 0, clicks30: 0 };
    evr.forEach(e => { const a = e.data, age = (now - (a.at || 0)) / 864e5, k = a.t === 'view' ? 'v' : 'c', P = per[a.s]; if (age <= 30) { P[k + '30']++; t[(k === 'v' ? 'views' : 'clicks') + '30']++; } if (age <= 7) { P[k + '7']++; t[(k === 'v' ? 'views' : 'clicks') + '7']++; } const dk = dayBR(a.at || 0); if (ser[dk]) ser[dk][k]++; });
    const bookings = []; let bTotal = 0;
    for (const st of sites.filter(x => x.goal === 'booking')) {
      const rows = await store.list('book/' + st.id + '/', 400, false);
      rows.forEach(r2 => { const d = r2.path.split('/').pop(); if (d < today) return; ((r2.data && r2.data.items) || []).forEach(x => { bTotal++; bookings.push({ site: st.id, siteName: st.name, d, t: x.t, n: x.n, s: x.s }); }); });
      st.bookings = bookings.filter(b => b.site === st.id).length;
    }
    bookings.sort((a, b) => (a.d + a.t < b.d + b.t ? -1 : 1));
    return { totals: { sites: sites.length, ...t, bookings: bTotal }, series: Object.values(ser), sites: sites.map(x => ({ ...x, ...per[x.id] })), bookings: bookings.slice(0, 20), capped: evr.length >= 3000 };
  }
  app.get('/api/me', async (req, res) => {
    if (!isAuth(req)) return res.status(401).json({ error: 'auth' });
    if (isAdmin(req)) return res.json({ role: 'admin', name: 'Admin' });
    const u = req.u.user, mine = (await allSites()).filter(x => x.owner === u.id);
    res.json({ role: 'client', name: u.name, email: u.email, tmp: !!u.tmp, plan: planOf(u), usage: { sites: mine.length }, canBuy: !!MPT() });
  });
  app.get('/api/stats', async (req, res) => {
    if (kind(hostOf(req)).t !== 'app' || !isAuth(req)) return res.status(401).json({ error: 'auth' });
    const sites = (await allSites()).filter(x => isAdmin(req) || x.owner === req.u.id);
    res.json(await computeStats(sites));
  });
  app.post('/api/account', async (req, res) => {
    if (!isAuth(req) || isAdmin(req)) return res.status(401).json({ error: 'auth' });
    const b = req.body || {}, u = req.u.user;
    if (b.name != null) { const n = String(b.name).replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, 80); if (n) u.name = n; }
    if (b.newPassword) {
      if (limited('pw:' + u.id, 8, 3600e3)) return res.status(429).json({ error: 'rate' });
      if (!pwCheck(String(b.oldPassword || ''), u.pw)) return res.status(400).json({ error: 'senha atual incorreta' });
      if (String(b.newPassword).length < 8 || String(b.newPassword).length > 100) return res.status(400).json({ error: 'a nova senha precisa ter 8 caracteres ou mais' });
      u.pw = pwHash(String(b.newPassword)); u.tmp = false;
    }
    await store.set('users/' + u.id, u); res.json({ ok: true });
  });
  const needAdmin = (req, res) => { if (kind(hostOf(req)).t !== 'app' || !isAdmin(req)) { res.status(401).json({ error: 'auth' }); return false; } return true; };
  const pubUser = (u, sites) => ({ id: u.id, name: u.name, email: u.email, status: u.status, plan: planOf(u), tmp: !!u.tmp, note: u.note || '', createdAt: u.createdAt, lastLogin: u.lastLogin || 0, sites: sites.filter(x => x.owner === u.id).length });
  app.get('/api/admin/overview', async (req, res) => {
    if (!needAdmin(req, res)) return;
    const sites = await allSites(), users = (await store.list('users/', 1000, true)).map(x => x.data).filter(Boolean), st = await computeStats(sites);
    const nameOf = Object.fromEntries(users.map(u => [u.id, u.name])); nameOf.admin = 'Admin';
    st.sites = st.sites.map(x => ({ ...x, ownerName: nameOf[x.owner] || '—' }));
    const now = Date.now(), orders = (await store.list('orders/', 300, true)).map(x => x.data).filter(Boolean), paid = orders.filter(x => x.status === 'paid');
    const sales = { rev30: paid.filter(x => now - x.paidAt < 30 * 864e5).reduce((a, x) => a + x.amount, 0), count30: paid.filter(x => now - x.paidAt < 30 * 864e5).length, pending: orders.filter(x => x.status === 'pending' && now - x.at < 7 * 864e5).length, recent: orders.slice(0, 12).map(x => ({ name: x.name, email: x.email, plan: x.plan, amount: x.amount, status: x.status, at: x.paidAt || x.at })) };
    res.json({ ...st, sales, prices: await getPrices(), mp: !!MPT(), clients: users.map(u => pubUser(u, sites)).sort((a, b) => b.createdAt - a.createdAt), kpi: { clients: users.length, active: users.filter(u => u.status === 'active').length, blocked: users.filter(u => u.status !== 'active').length, new30: users.filter(u => now - u.createdAt < 30 * 864e5).length, aiToday: aiDay.d === new Date().toISOString().slice(0, 10) ? aiDay.n : 0, aiLimit: AI_DAILY, store: store.kind }, plans: Object.fromEntries(Object.entries(PLANS).map(([k, v]) => [k, v])) });
  });
  app.post('/api/admin/clients', async (req, res) => {
    if (!needAdmin(req, res)) return;
    const b = req.body || {}, name = String(b.name || '').replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, 80), email = String(b.email || '').trim().toLowerCase().slice(0, 200);
    if (!name || !EMAIL.test(email)) return res.status(400).json({ error: 'Informe nome e um e-mail válido.' });
    if (await store.get('uemail/' + email)) return res.status(409).json({ error: 'Já existe um cliente com esse e-mail.' });
    const id = crypto.randomBytes(6).toString('hex'), pw = genPw();
    const u = { id, role: 'client', name, email, pw: pwHash(pw), status: 'active', plan: PLANS[b.plan] ? b.plan : 'free', maxSites: 0, note: String(b.note || '').slice(0, 300), tmp: true, createdAt: Date.now(), lastLogin: 0 };
    await store.set('users/' + id, u); await store.set('uemail/' + email, { id });
    res.json({ ok: true, user: pubUser(u, []), password: pw });
  });
  app.post('/api/admin/clients/update', async (req, res) => {
    if (!needAdmin(req, res)) return;
    const b = req.body || {}, id = String(b.id || ''); if (!ID.test(id)) return res.status(400).json({ error: 'bad' });
    const u = await store.get('users/' + id); if (!u) return res.status(404).json({ error: 'not_found' });
    if (b.status === 'active' || b.status === 'blocked') u.status = b.status;
    if (b.plan && PLANS[b.plan]) u.plan = b.plan;
    if (b.maxSites != null) u.maxSites = Math.min(500, Math.max(0, +b.maxSites || 0));
    if (b.name) u.name = String(b.name).replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, 80) || u.name;
    if (b.note != null) u.note = String(b.note).slice(0, 300);
    let pw = null; if (b.resetPassword) { pw = genPw(); u.pw = pwHash(pw); u.tmp = true; }
    await store.set('users/' + id, u); res.json({ ok: true, password: pw, user: pubUser(u, await allSites()) });
  });
  app.post('/api/admin/clients/delete', async (req, res) => {
    if (!needAdmin(req, res)) return;
    const id = String((req.body || {}).id || ''); if (!ID.test(id)) return res.status(400).json({ error: 'bad' });
    const u = await store.get('users/' + id); if (!u) return res.status(404).json({ error: 'not_found' });
    for (const st of (await allSites()).filter(x => x.owner === id)) {
      if (st.slug) await store.del('slug/' + st.slug); await store.del('sites/' + st.id);
      for (const r2 of await store.list('book/' + st.id + '/', 400, false)) await store.del(r2.path);
    }
    await store.del('uemail/' + u.email); await store.del('users/' + id); res.json({ ok: true });
  });
  app.post('/api/admin/sites/unpublish', async (req, res) => {
    if (!needAdmin(req, res)) return;
    const id = String((req.body || {}).id || ''); if (!ID.test(id)) return res.status(400).json({ error: 'bad' });
    const d = await store.get('sites/' + id); if (d && d.slug) await store.del('slug/' + d.slug); await store.del('sites/' + id); res.json({ ok: true });
  });

  // ---- vendas: planos + Mercado Pago (pagamento libera o acesso sozinho)
  const MPT = () => process.env.MP_ACCESS_TOKEN || '', MPU = () => process.env.MP_URL || 'https://api.mercadopago.com';
  const APP_URL = () => process.env.APP_URL || ('https://' + APP_HOST);
  const getPrices = async () => ((await store.get('config/plans')) || {}).prices || {};
  const fmt = (n) => 'R$ ' + (+n).toFixed(2).replace('.', ',');
  let ordLock = Promise.resolve();
  const ordRun = (fn) => { const p = ordLock.then(fn, fn); ordLock = p.catch(() => {}); return p; };
  const shell = (title, body) => '<!doctype html><html lang=pt-BR><meta charset=utf-8><meta name=viewport content="width=device-width,initial-scale=1"><title>' + esc(title) + '</title><body style="margin:0;min-height:100vh;background:#0b1020;color:#e8ecff;font:16px/1.5 system-ui;display:grid;place-items:center;padding:20px"><main style="width:min(880px,100%)">' + body + '</main></html>';
  app.get('/planos', async (req, res) => {
    if (kind(hostOf(req)).t !== 'app') return res.status(404).end();
    const prices = await getPrices(), me = req.u && req.u.role === 'client' ? req.u.user : null;
    const cards = Object.entries(PLANS).filter(([k]) => prices[k] > 0).map(([k, p]) => '<label style="display:block;cursor:pointer"><input type=radio name=plan value=' + k + ' style="position:absolute;opacity:0" ' + (me && me.plan === k ? 'checked' : '') + '><div class=pc style="background:#141a33;border:2px solid #2b3566;border-radius:18px;padding:20px;height:100%;box-sizing:border-box"><b style="font-size:18px">' + esc(p.name) + '</b><div style="font-size:30px;font-weight:800;margin:6px 0">' + fmt(prices[k]) + '<small style="font-size:13px;font-weight:400;color:#93a0bb"> / 30 dias</small></div><div style="color:#b7c0dc;font-size:14px">' + p.maxSites + ' site' + (p.maxSites > 1 ? 's' : '') + ' publicado' + (p.maxSites > 1 ? 's' : '') + '<br>Leitura de perfil com IA<br>Painel com visitas e cliques<br>Endereço próprio em ' + esc(ROOT) + '</div></div></label>').join('');
    const body = '<h1 style="text-align:center;margin:0 0 6px">🪄 AutoPage.ai</h1><p style="text-align:center;color:#b7c0dc;margin:0 0 22px">Escolha o plano e receba seu acesso assim que o pagamento for aprovado.</p>' + (cards && MPT() ? '<form id=f><div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:14px">' + cards + '</div><div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:18px"><input id=n placeholder="Seu nome" required maxlength=80 value="' + esc(me ? me.name : '') + '" style="padding:12px;border-radius:10px;border:1px solid #2b3566;background:#0b1020;color:#fff"><input id=e type=email placeholder="Seu e-mail" required value="' + esc(me ? me.email : '') + '" ' + (me ? 'readonly' : '') + ' style="padding:12px;border-radius:10px;border:1px solid #2b3566;background:#0b1020;color:#fff"></div><div id=m style="color:#fca5a5;margin-top:8px;min-height:20px"></div><button style="width:100%;margin-top:6px;padding:14px;border:0;border-radius:12px;background:#4f46e5;color:#fff;font-weight:800;font-size:16px;cursor:pointer">Pagar com Mercado Pago</button><p style="text-align:center;color:#93a0bb;font-size:13px">Pix, cartão ou boleto. Pagamento de 30 dias, sem renovação automática.</p></form><style>input[type=radio]:checked+.pc{border-color:#818cf8!important;background:#1b2350!important}</style><script>document.getElementById("f").onsubmit=async function(ev){ev.preventDefault();var m=document.getElementById("m"),p=document.querySelector("input[name=plan]:checked");if(!p){m.textContent="Escolha um plano.";return}m.textContent="Abrindo o pagamento…";try{var r=await fetch("/api/checkout",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({plan:p.value,name:document.getElementById("n").value,email:document.getElementById("e").value})}),j=await r.json();if(!r.ok)throw new Error(j.error||"erro");location.href=j.url}catch(x){m.textContent=x.message==="erro"?"Não foi possível iniciar o pagamento agora.":x.message}}</script>' : '<p style="text-align:center;color:#fca5a5">Vendas ainda não estão abertas. Fale com o suporte.</p>') + '<p style="text-align:center;margin-top:18px"><a href="/" style="color:#a5b4fc">Já tenho acesso: entrar</a></p>';
    res.type('html').send(shell('Planos · AutoPage.ai', body));
  });
  app.post('/api/checkout', async (req, res) => {
    if (kind(hostOf(req)).t !== 'app') return res.status(404).end();
    if (limited('co:' + ipOf(req), 8, 3600e3)) return res.status(429).json({ error: 'Muitas tentativas. Tente mais tarde.' });
    const b = req.body || {}, prices = await getPrices(), plan = String(b.plan || '');
    if (!MPT()) return res.status(503).json({ error: 'Pagamento indisponível no momento.' });
    if (!PLANS[plan] || !(prices[plan] > 0)) return res.status(400).json({ error: 'Plano indisponível.' });
    const me = req.u && req.u.role === 'client' ? req.u.user : null;
    const name = String(me ? me.name : b.name || '').replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, 80), email = String(me ? me.email : b.email || '').trim().toLowerCase().slice(0, 200);
    if (!name || !EMAIL.test(email)) return res.status(400).json({ error: 'Informe nome e e-mail válidos.' });
    if (!me && await store.get('uemail/' + email)) return res.status(409).json({ error: 'Esse e-mail já tem acesso. Entre para renovar ou trocar de plano.' });
    const oid = crypto.randomBytes(8).toString('hex'), tok = mkToken({ o: oid }, 7 * 864e5);
    await store.set('orders/' + oid, { id: oid, plan, name, email, uid: me ? me.id : '', amount: prices[plan], status: 'pending', at: Date.now() });
    try {
      const back = APP_URL() + '/planos/obrigado?o=' + oid + '&t=' + encodeURIComponent(tok);
      const r2 = await fetch(MPU() + '/checkout/preferences', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + MPT() }, body: JSON.stringify({ items: [{ title: 'AutoPage.ai · Plano ' + PLANS[plan].name + ' (30 dias)', quantity: 1, unit_price: prices[plan], currency_id: 'BRL' }], payer: { email, name }, external_reference: oid, notification_url: APP_URL() + '/mp/webhook', back_urls: { success: back, pending: back, failure: APP_URL() + '/planos' }, auto_return: 'approved' }) });
      const j = await r2.json();
      if (!r2.ok || !j.init_point) throw new Error('mp');
      res.json({ url: j.init_point });
    } catch (e) { console.error('checkout', e.message); res.status(502).json({ error: 'Não foi possível iniciar o pagamento agora.' }); }
  });
  async function settle(paymentId) {
    if (!/^\d{3,20}$/.test(String(paymentId)) || !MPT()) return false;
    const r2 = await fetch(MPU() + '/v1/payments/' + paymentId, { headers: { Authorization: 'Bearer ' + MPT() } });
    if (!r2.ok) return false;
    const p = await r2.json();
    if (p.status !== 'approved') return false;
    return ordRun(async () => {
      const o = await store.get('orders/' + String(p.external_reference || '').replace(/[^a-f0-9]/g, '')); if (!o || o.status === 'paid') return !!o;
      if (!(+p.transaction_amount >= o.amount - 0.001)) return false;
      let u = o.uid ? await store.get('users/' + o.uid) : null;
      if (!u) { const idx = await store.get('uemail/' + o.email); u = idx ? await store.get('users/' + idx.id) : null; }
      if (!u) {
        const id = crypto.randomBytes(6).toString('hex');
        u = { id, role: 'client', name: o.name, email: o.email, pw: pwHash(crypto.randomBytes(18).toString('hex')), needPw: true, status: 'active', plan: o.plan, maxSites: 0, note: 'Compra online', tmp: false, createdAt: Date.now(), lastLogin: 0 };
        await store.set('uemail/' + o.email, { id });
      }
      u.plan = o.plan; u.maxSites = 0; u.planUntil = Math.max(Date.now(), u.planUntil || 0) + 30 * 864e5;
      await store.set('users/' + u.id, u);
      o.status = 'paid'; o.paidAt = Date.now(); o.uid = u.id; o.paymentId = String(paymentId); await store.set('orders/' + o.id, o);
      return true;
    });
  }
  app.all('/mp/webhook', async (req, res) => {
    try {
      const q = req.query || {}, b = req.body || {};
      const type = q.type || q.topic || b.type || b.topic, id = q['data.id'] || q.id || (b.data && b.data.id) || (b.resource && String(b.resource).split('/').pop());
      if (/payment/.test(String(type || '')) && id) await settle(String(id));
    } catch (e) { console.error('mp webhook', e.message); }
    res.status(200).json({ ok: true });
  });
  app.get('/planos/obrigado', (req, res) => {
    if (kind(hostOf(req)).t !== 'app') return res.status(404).end();
    res.type('html').send(shell('Obrigado · AutoPage.ai', '<div id=b style="max-width:420px;margin:auto;text-align:center"><h2>Confirmando seu pagamento…</h2><p style="color:#b7c0dc">Isso leva alguns segundos. Não feche esta página.</p></div><script>(function(){var q=new URLSearchParams(location.search),o=q.get("o"),t=q.get("t"),b=document.getElementById("b"),n=0,pid=q.get("payment_id")||q.get("collection_id");function esc(s){return String(s).replace(/[&<>"]/g,function(c){return{"&":"&amp;","<":"&lt;",">":"&gt;","\\"":"&quot;"}[c]})}function poll(){fetch("/api/order?o="+encodeURIComponent(o)+"&t="+encodeURIComponent(t)+(pid?"&p="+encodeURIComponent(pid):"")).then(function(r){return r.json()}).then(function(j){if(j.status==="paid"){if(j.needPw)form(j);else b.innerHTML="<h2>✅ Pagamento aprovado!</h2><p>Seu plano está ativo.</p><p><a style=\\"color:#a5b4fc\\" href=\\"/\\">Entrar no painel</a></p>";return}if(++n>40){b.innerHTML="<h2>Ainda aguardando…</h2><p style=\\"color:#b7c0dc\\">Se você pagou por Pix ou boleto, a confirmação pode demorar. Volte a esta página em alguns minutos.</p>";return}setTimeout(poll,3000)}).catch(function(){setTimeout(poll,4000)})}function form(j){b.innerHTML="<h2>✅ Pagamento aprovado!</h2><p style=\\"color:#b7c0dc\\">Crie sua senha para acessar o painel.</p><p><b>"+esc(j.email)+"</b></p><input id=pw type=password placeholder=\\"Crie uma senha (8+ caracteres)\\" style=\\"width:100%;box-sizing:border-box;padding:12px;border-radius:10px;border:1px solid #2b3566;background:#0b1020;color:#fff\\"><div id=m style=\\"color:#fca5a5;min-height:22px\\"></div><button id=go style=\\"width:100%;padding:13px;border:0;border-radius:10px;background:#4f46e5;color:#fff;font-weight:800;cursor:pointer\\">Criar senha e entrar</button>";document.getElementById("go").onclick=function(){fetch("/api/order/setpw",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({o:o,t:t,password:document.getElementById("pw").value})}).then(function(r){return r.json().then(function(x){return{ok:r.ok,x:x}})}).then(function(r){if(r.ok)location.href="/";else document.getElementById("m").textContent=r.x.error||"Erro"})}}if(!o||!t){b.innerHTML="<h2>Link inválido</h2>"}else poll()})()</script>'));
  });
  const orderOf = async (o, t) => { const tk = readToken(String(t || '')); if (!tk || tk.o !== String(o || '')) return null; return store.get('orders/' + String(o).replace(/[^a-f0-9]/g, '')); };
  app.get('/api/order', async (req, res) => {
    const o = await orderOf(req.query.o, req.query.t); if (!o) return res.status(404).json({ error: 'not_found' });
    if (o.status !== 'paid' && req.query.p) { try { await settle(String(req.query.p)); } catch (e) { /* aguarda webhook */ } }
    const cur = o.status === 'paid' ? o : await store.get('orders/' + o.id), u = cur.status === 'paid' ? await store.get('users/' + cur.uid) : null;
    res.json({ status: cur.status, email: cur.email, needPw: !!(u && u.needPw) });
  });
  app.post('/api/order/setpw', async (req, res) => {
    if (limited('spw:' + ipOf(req), 10, 3600e3)) return res.status(429).json({ error: 'Muitas tentativas.' });
    const b = req.body || {}, o = await orderOf(b.o, b.t); if (!o || o.status !== 'paid') return res.status(404).json({ error: 'Pedido não encontrado.' });
    const u = await store.get('users/' + o.uid); if (!u || !u.needPw) return res.status(400).json({ error: 'A senha já foi criada. Entre com seu e-mail.' });
    const pw = String(b.password || ''); if (pw.length < 8 || pw.length > 100) return res.status(400).json({ error: 'A senha precisa ter 8 caracteres ou mais.' });
    u.pw = pwHash(pw); u.needPw = false; u.lastLogin = Date.now(); await store.set('users/' + u.id, u);
    const secure = req.headers['x-forwarded-proto'] === 'https' ? '; Secure' : '';
    res.setHeader('Set-Cookie', 'ap_s=' + mkToken({ r: 'client', u: u.id }, 7 * 864e5) + '; HttpOnly; SameSite=Lax; Path=/; Max-Age=' + 7 * 86400 + secure);
    res.json({ ok: true });
  });
  app.get('/api/admin/export', async (req, res) => {
    if (!needAdmin(req, res)) return;
    const get = async (p) => (await store.list(p, 5000, true)).map(x => ({ path: x.path, data: x.data }));
    const users = (await get('users/')).map(x => ({ path: x.path, data: { ...x.data, pw: undefined } }));
    res.setHeader('Content-Disposition', 'attachment; filename="autopage-backup-' + new Date().toISOString().slice(0, 10) + '.json"');
    res.type('json').send(JSON.stringify({ at: new Date().toISOString(), users, sites: await get('sites/'), orders: await get('orders/'), config: await get('config/') }));
  });
  app.post('/api/admin/config', async (req, res) => {
    if (!needAdmin(req, res)) return;
    const pr = {}; for (const k of Object.keys(PLANS)) { const v = +((req.body.prices || {})[k]); if (v > 0 && v < 100000) pr[k] = Math.round(v * 100) / 100; }
    await store.set('config/plans', { prices: pr }); res.json({ ok: true, prices: pr });
  });

  app.use((req, res) => res.status(404).type('text').send('Não encontrado'));
  app.use((err, req, res, next) => { console.error(err.message); res.status(err.status || 500).json({ error: 'erro' }); });
  const srv = app.listen(PORT, () => console.log('AutoPage server na porta ' + PORT + ' · armazenamento: ' + store.kind + ' · app: ' + APP_HOST));
  return { app, srv, store };
}
if (require.main === module) main().catch(e => { console.error(e); process.exit(1); });
module.exports = { main };
