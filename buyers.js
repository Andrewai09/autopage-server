// Contas de compradores por loja: e-mail e senha, ou Google. O comprador precisa estar logado para fazer pedidos.
const crypto = require('crypto');

module.exports = function buyers(c) {
  const { app, kind, hostOf, ipOf, limited, ID, pwHash, pwCheck, store, clean, rid, cors, siteOf, appUrl, X } = c;
  const SEC = () => process.env.SESSION_SECRET || process.env.ADMIN_PASSWORD || 'dev-only-secret';
  const hm = (s) => crypto.createHmac('sha256', SEC()).update('buyer:' + s).digest('base64url');
  const sign = (o) => { const b = Buffer.from(JSON.stringify(o)).toString('base64url'); return b + '.' + hm(b); };
  const unsign = (t) => { try { const [b, m] = String(t).split('.'); if (!b || !m) return null; const e = hm(b); if (e.length !== m.length || !crypto.timingSafeEqual(Buffer.from(e), Buffer.from(m))) return null; const o = JSON.parse(Buffer.from(b, 'base64url').toString()); return o && o.e > Date.now() ? o : null; } catch (e) { return null; } };
  const EM = /^[^\s@<>]{1,64}@[^\s@<>]{1,190}\.[A-Za-z]{2,24}$/;
  const kid = (email) => crypto.createHash('sha256').update(email).digest('hex').slice(0, 24);
  const GID = () => process.env.GOOGLE_CLIENT_ID || '', GSEC = () => process.env.GOOGLE_CLIENT_SECRET || '';
  const required = (st) => !!st && !st.j.nolog && ['catalog', 'ecommerce', 'menu', 'booking'].includes(st.j.goal);
  const pub = (b) => ({ name: b.name, email: b.email, tel: b.tel || '' });
  const token = (siteId, id) => sign({ s: siteId, b: id, e: Date.now() + 30 * 864e5 });
  const load = async (siteId, t) => { const o = unsign(t); if (!o || o.k || o.s !== siteId) return null; const b = await store.get('buyers/' + siteId + '/' + o.b); return b ? { id: o.b, ...b } : null; };

  // usado por /api/order: devolve o comprador logado (ou null)
  X.buyerOf = async (st, t) => load(st.id, t);
  X.buyerRequired = required;
  X.buyerBlocked = (bu) => !!bu && bu.vf === 0 && X.mailOn();
  const frag = (pw) => crypto.createHash('sha256').update(String(pw || '')).digest('hex').slice(0, 12);
  const siteName = (st) => clean((st.j && st.j.name) || 'a loja', 80);
  const sendVerify = async (st, id, rec) => {
    if (!X.mailOn()) return;
    const t = sign({ k: 'bv', s: st.id, b: id, e: Date.now() + 7 * 864e5 });
    await X.sendMail({ to: rec.email, subject: 'Confirme seu e-mail · ' + siteName(st), html: X.wrap('Confirme seu e-mail', '<p>Olá, ' + X.esc(rec.name) + '. Confirme seu e-mail para finalizar pedidos em <b>' + X.esc(siteName(st)) + '</b>.</p>' + X.btn(appUrl() + '/buyer/verify?t=' + encodeURIComponent(t), 'Confirmar e-mail')) }).catch(() => {});
  };

  app.all('/api/buyer/caps', async (req, res) => {
    if (cors(req, res)) return;
    res.setHeader('Cache-Control', 'no-store');
    const st = await siteOf(req).catch(() => null);
    if (!st) return res.json({ login: 0 });
    res.json({ login: required(st) ? 1 : 0, google: GID() && GSEC() ? appUrl() + '/auth/google/start?site=' + st.id : '' });
  });
  const post = (fn) => async (req, res) => {
    if (cors(req, res)) return;
    if (req.method !== 'POST') return res.status(405).json({ error: 'method' });
    try { const st = await siteOf(req); if (!st) return res.status(404).json({ error: 'nf' }); await fn(req, res, st, req.body || {}); } catch (e) { console.error('buyer', e.message); res.status(500).json({ error: 'server' }); }
  };
  app.all('/api/buyer/register', post(async (req, res, st, b) => {
    if (limited('br:' + ipOf(req), 10, 3600e3)) return res.status(429).json({ error: 'rate' });
    const email = clean(b.email, 254).toLowerCase(), name = clean(b.name, 80), pw = String(b.password || '');
    if (!name) return res.status(400).json({ error: 'name' });
    if (!EM.test(email)) return res.status(400).json({ error: 'email' });
    if (pw.length < 8 || pw.length > 100) return res.status(400).json({ error: 'pw' });
    const id = kid(email), prev = await store.get('buyers/' + st.id + '/' + id);
    if (prev) return res.status(409).json({ error: prev.pw ? 'exists' : 'google' });
    const rec = { name, email, tel: clean(b.tel, 30), pw: pwHash(pw), at: Date.now(), ...(X.mailOn() ? { vf: 0 } : {}) };
    await store.set('buyers/' + st.id + '/' + id, rec);
    if (rec.vf === 0) sendVerify(st, id, rec);
    res.json({ ok: true, token: token(st.id, id), buyer: pub(rec), vf: rec.vf === 0 ? 0 : 1 });
  }));
  app.all('/api/buyer/login', post(async (req, res, st, b) => {
    const email = clean(b.email, 254).toLowerCase();
    if (limited('bl:' + ipOf(req), 30, 3600e3) || limited('ble:' + st.id + email, 8, 900e3)) return res.status(429).json({ error: 'rate' });
    const id = kid(email), rec = await store.get('buyers/' + st.id + '/' + id);
    if (rec && !rec.pw) return res.status(400).json({ error: 'google' });
    if (!rec || !pwCheck(String(b.password || ''), rec.pw)) return res.status(401).json({ error: 'cred' });
    res.json({ ok: true, token: token(st.id, id), buyer: pub(rec) });
  }));
  app.all('/api/buyer/resend', post(async (req, res, st, b) => {
    const u = await load(st.id, b.bt); if (!u) return res.status(401).json({ error: 'login' });
    if (u.vf !== 0) return res.json({ ok: true, done: 1 });
    if (limited('bv:' + st.id + u.id, 3, 3600e3)) return res.status(429).json({ error: 'rate' });
    await sendVerify(st, u.id, u); res.json({ ok: true });
  }));
  app.all('/api/buyer/forgot', post(async (req, res, st, b) => {
    if (limited('bf:' + ipOf(req), 8, 3600e3)) return res.status(429).json({ error: 'rate' });
    const email = clean(b.email, 254).toLowerCase();
    if (!EM.test(email)) return res.status(400).json({ error: 'email' });
    if (!X.mailOn()) return res.json({ ok: true, mail: 0 });
    if (!limited('bfe:' + st.id + email, 3, 3600e3)) {
      const id = kid(email), rec = await store.get('buyers/' + st.id + '/' + id);
      if (rec && rec.pw) {
        const t = sign({ k: 'br', s: st.id, b: id, x: frag(rec.pw), e: Date.now() + 3600e3 });
        X.sendMail({ to: rec.email, subject: 'Redefinir sua senha · ' + siteName(st), html: X.wrap('Redefinir senha', '<p>Olá, ' + X.esc(rec.name) + '. Recebemos um pedido para redefinir sua senha em <b>' + X.esc(siteName(st)) + '</b>. O link vale por 1 hora e só funciona uma vez.</p>' + X.btn(appUrl() + '/buyer/reset?t=' + encodeURIComponent(t), 'Criar nova senha') + '<p style="color:#6b7280;font-size:13px">Se não foi você, ignore este e-mail.</p>') }).catch(() => {});
      }
    }
    res.json({ ok: true, mail: 1 });
  }));
  app.all('/api/buyer/me', post(async (req, res, st, b) => {
    const u = await load(st.id, b.bt); if (!u) return res.status(401).json({ error: 'login' });
    res.json({ ok: true, buyer: pub(u) });
  }));
  app.all('/api/buyer/exchange', post(async (req, res, st, b) => {
    if (limited('bx:' + ipOf(req), 30, 3600e3)) return res.status(429).json({ error: 'rate' });
    const code = String(b.code || ''); if (!/^[a-f0-9]{32}$/.test(code)) return res.status(400).json({ error: 'bad' });
    const r = await store.get('bcode/' + code); if (!r) return res.status(400).json({ error: 'bad' });
    await store.del('bcode/' + code);
    if (r.s !== st.id || r.e < Date.now()) return res.status(400).json({ error: 'bad' });
    const u = await store.get('buyers/' + st.id + '/' + r.b); if (!u) return res.status(400).json({ error: 'bad' });
    res.json({ ok: true, token: token(st.id, r.b), buyer: pub(u) });
  }));

  const kinds = (t, k) => { const o = unsign(t); return o && o.k === k ? o : null; };
  const wrapP = (title, body) => '<!doctype html><html lang=pt-BR><meta charset=utf-8><meta name=viewport content="width=device-width,initial-scale=1"><title>' + X.esc(title) + '</title><body style="margin:0;min-height:100vh;display:grid;place-items:center;background:#f3f4f6;color:#111827;font:16px system-ui;padding:16px"><div style="width:min(360px,92vw);background:#fff;padding:26px;border-radius:16px;display:grid;gap:12px;box-shadow:0 8px 30px #0001">' + body + '</div></body></html>';
  const siteBack = async (sid) => { const d = await store.get('sites/' + sid); return d && d.slug ? 'https://' + d.slug + '.' + (c.ROOT || 'kattalo.online') : ''; };
  app.get('/buyer/verify', async (req, res) => {
    if (kind(hostOf(req)).t !== 'app') return res.status(404).end();
    const o = kinds(req.query.t, 'bv'), u = o ? await store.get('buyers/' + o.s + '/' + o.b) : null;
    if (!u) return res.status(400).type('html').send(wrapP('Link inválido', '<h2 style="margin:0">Link inválido ou vencido</h2><div>Volte à loja e peça um novo e-mail ao tentar finalizar.</div>'));
    if (u.vf === 0) { delete u.vf; await store.set('buyers/' + o.s + '/' + o.b, u); }
    const back = await siteBack(o.s);
    res.type('html').send(wrapP('E-mail confirmado', '<h2 style="margin:0">✅ E-mail confirmado</h2><div>Pronto! Você já pode finalizar seus pedidos.</div>' + (back ? '<a style="color:#4f46e5" href="' + X.esc(back) + '">Voltar à loja</a>' : '')));
  });
  app.get('/buyer/reset', async (req, res) => {
    if (kind(hostOf(req)).t !== 'app') return res.status(404).end();
    const t = String(req.query.t || ''), o = kinds(t, 'br'), u = o ? await store.get('buyers/' + o.s + '/' + o.b) : null;
    if (!u || !u.pw || frag(u.pw) !== o.x) return res.status(400).type('html').send(wrapP('Link inválido', '<h2 style="margin:0">Link inválido ou vencido</h2><div>Peça um novo link em “Esqueci minha senha”, na loja.</div>'));
    const i = 'padding:12px;border-radius:10px;border:1px solid #d1d5db;width:100%;box-sizing:border-box';
    res.type('html').send(wrapP('Nova senha', '<form id=f style="display:grid;gap:12px"><h2 style="margin:0">🔑 Criar nova senha</h2><input id=p type=password placeholder="Nova senha (8+ caracteres)" required minlength=8 maxlength=100 autocomplete=new-password style="' + i + '"><input id=p2 type=password placeholder="Repita a senha" required minlength=8 maxlength=100 autocomplete=new-password style="' + i + '"><div id=m style="min-height:20px;color:#b91c1c;font-size:14px"></div><button style="padding:12px;border:0;border-radius:10px;background:#4f46e5;color:#fff;font-weight:700;cursor:pointer">Salvar senha</button></form><script>var T=' + JSON.stringify(t).replace(/</g, '\\u003c') + ';document.getElementById("f").onsubmit=async function(ev){ev.preventDefault();var m=document.getElementById("m");if(p.value!==p2.value){m.textContent="As senhas não conferem.";return}m.textContent="Salvando…";try{var r=await fetch("/api/buyer/reset",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({t:T,password:p.value})}),j=await r.json();if(!r.ok)throw new Error(j.error||"Erro");document.getElementById("f").innerHTML="<h2 style=margin:0>✅ Senha alterada</h2><div>Agora é só entrar na loja com a nova senha.</div>"+(j.back?"<a style=color:#4f46e5 href=\\""+j.back+"\\">Voltar à loja</a>":"")}catch(x){m.textContent=x.message}}</script>'));
  });
  app.post('/api/buyer/reset', async (req, res) => {
    if (kind(hostOf(req)).t !== 'app') return res.status(404).end();
    if (limited('brs:' + ipOf(req), 20, 3600e3)) return res.status(429).json({ error: 'Muitas tentativas. Tente mais tarde.' });
    const b = req.body || {}, o = kinds(b.t, 'br'), pw = String(b.password || '');
    if (pw.length < 8 || pw.length > 100) return res.status(400).json({ error: 'A senha precisa ter de 8 a 100 caracteres.' });
    const u = o ? await store.get('buyers/' + o.s + '/' + o.b) : null;
    if (!u || !u.pw || frag(u.pw) !== o.x) return res.status(400).json({ error: 'Link inválido ou vencido. Peça um novo.' });
    u.pw = pwHash(pw); u.pwAt = Date.now();
    await store.set('buyers/' + o.s + '/' + o.b, u);
    X.sendMail({ to: u.email, subject: 'Sua senha foi alterada', html: X.wrap('Senha alterada', '<p>Olá, ' + X.esc(u.name) + '. A senha da sua conta acabou de ser alterada. Se não foi você, redefina de novo agora.</p>') }).catch(() => {});
    res.json({ ok: true, back: await siteBack(o.s) });
  });

  // ---------- Google (fluxo por redirecionamento no domínio do app; funciona para qualquer subdomínio/domínio próprio)
  const html = (body) => '<!doctype html><meta charset=utf-8><meta name=viewport content="width=device-width,initial-scale=1"><title>Entrar</title><body style="font:16px system-ui;display:grid;place-items:center;min-height:100vh;margin:0;padding:20px;text-align:center">' + body;
  app.get('/auth/google/start', async (req, res) => {
    if (kind(hostOf(req)).t !== 'app' || !GID() || !GSEC()) return res.status(404).end();
    const site = String(req.query.site || ''); if (!ID.test(site) || !(await store.get('sites/' + site))) return res.status(400).type('html').send(html('Site inválido.'));
    if (limited('gs:' + ipOf(req), 30, 3600e3)) return res.status(429).type('html').send(html('Muitas tentativas. Tente mais tarde.'));
    const state = sign({ s: site, n: crypto.randomBytes(8).toString('hex'), e: Date.now() + 10 * 60e3 });
    const q = new URLSearchParams({ client_id: GID(), redirect_uri: appUrl() + '/auth/google/cb', response_type: 'code', scope: 'openid email profile', state, prompt: 'select_account' });
    res.redirect('https://accounts.google.com/o/oauth2/v2/auth?' + q);
  });
  app.get('/auth/google/cb', async (req, res) => {
    if (kind(hostOf(req)).t !== 'app') return res.status(404).end();
    const fail = (m) => res.status(400).type('html').send(html('<p>' + m + '</p><p>Pode fechar esta janela e tentar de novo.</p>'));
    try {
      const st = unsign(req.query.state); if (!st || !ID.test(st.s || '') || !req.query.code) return fail('Não foi possível entrar com o Google.');
      if (limited('gc:' + ipOf(req), 30, 3600e3)) return fail('Muitas tentativas.');
      const tr = await fetch(process.env.GOOGLE_TOKEN_URL || 'https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ code: String(req.query.code), client_id: GID(), client_secret: GSEC(), redirect_uri: appUrl() + '/auth/google/cb', grant_type: 'authorization_code' }) });
      const tj = await tr.json().catch(() => null); if (!tr.ok || !tj || !tj.id_token) return fail('O Google recusou o login.');
      const pl = JSON.parse(Buffer.from(String(tj.id_token).split('.')[1], 'base64url').toString());
      if (pl.aud !== GID() || !pl.email || pl.email_verified === false || !EM.test(String(pl.email))) return fail('Conta do Google sem e-mail verificado.');
      const email = String(pl.email).toLowerCase(), id = kid(email), key = 'buyers/' + st.s + '/' + id;
      let rec = await store.get(key);
      if (!rec) { rec = { name: clean(pl.name || email.split('@')[0], 80), email, tel: '', google: 1, at: Date.now() }; await store.set(key, rec); }
      const code = crypto.randomBytes(16).toString('hex'); await store.set('bcode/' + code, { s: st.s, b: id, e: Date.now() + 120e3 });
      res.type('html').send(html('<p>Login feito! Voltando para a loja…</p><script>try{opener.postMessage({apb:"code",code:' + JSON.stringify(code) + '},"*")}catch(e){}setTimeout(function(){window.close()},400)</script>'));
    } catch (e) { console.error('gcb', e.message); fail('Falha ao entrar com o Google.'); }
  });
  if (Math.random() < 1) setInterval(() => store.trim('bcode/', 200).catch(() => {}), 3600e3).unref();
  void rid;
};
