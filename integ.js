// Integrações por cliente: Mercado Pago (receber o dinheiro das vendas) e Melhor Envio (frete Correios e outros).
// Cada cliente cola o token da própria conta; o token fica criptografado (AES-256-GCM) e nunca volta para o navegador.
const crypto = require('crypto');

module.exports = function integ(c) {
  const { app, kind, hostOf, ipOf, limited, isAdmin, isAuth, ID, planOf, store, clean, num, rid, cors, siteOf, wasMine, appUrl, X } = c;
  const MPU = () => process.env.MP_URL || 'https://api.mercadopago.com';
  const MEU = (sb) => process.env.ME_URL || (sb ? 'https://sandbox.melhorenvio.com.br' : 'https://melhorenvio.com.br');
  const UA = () => 'AutoPage.ai' + (process.env.ME_CONTACT ? ' (' + process.env.ME_CONTACT + ')' : '');
  const TOK = /^[A-Za-z0-9._\-]{20,2500}$/;

  const KEY = () => { const s = process.env.SESSION_SECRET || process.env.ADMIN_PASSWORD || ''; return s ? crypto.createHash('sha256').update('integ:' + s).digest() : null; };
  const enc = (t) => { const k = KEY(); if (!k) throw new Error('nokey'); const iv = crypto.randomBytes(12), ci = crypto.createCipheriv('aes-256-gcm', k, iv), b = Buffer.concat([ci.update(String(t), 'utf8'), ci.final()]); return [iv, ci.getAuthTag(), b].map(x => x.toString('base64')).join('.'); };
  const dec = (s) => { try { const k = KEY(), [iv, tag, b] = String(s).split('.').map(x => Buffer.from(x, 'base64')), d = crypto.createDecipheriv('aes-256-gcm', k, iv); d.setAuthTag(tag); return Buffer.concat([d.update(b), d.final()]).toString('utf8'); } catch (e) { return ''; } };
  const mask = (t) => (t ? t.slice(0, 4) + '…' + t.slice(-4) : '');

  const jf = async (url, opt) => {
    const ctl = new AbortController(), tm = setTimeout(() => ctl.abort(), 9000);
    try {
      const r = await fetch(url, { ...opt, signal: ctl.signal });
      let j = null; try { j = await r.json(); } catch (e) { /* sem corpo */ }
      return { ok: r.ok, s: r.status, j };
    } finally { clearTimeout(tm); }
  };
  const ownerOf = (req) => (isAdmin(req) ? 'admin' : req.u.id);
  const getI = async (owner) => (await store.get('integ/' + owner)) || {};
  const allowed = (req) => isAdmin(req) || !!planOf(req.u.user).integ;
  const cep8 = (v) => { const d = String(v || '').replace(/\D/g, ''); return d.length === 8 ? d : ''; };
  const SVC_OK = /^\d{1,2}(,\d{1,2}){0,5}$/;

  // ---------- frete (Melhor Envio)
  async function quote(st, I, cepTo, lines) {
    const me = I.me, sh = I.ship || {};
    if (!me || !me.tok || !cep8(sh.cep)) return { error: 'noint' };
    const tok = dec(me.tok); if (!tok) return { error: 'noint' };
    const its = st.j.items || [];
    const products = lines.map((l, k) => {
      const it = its[l.ix] || {}, g = num(it.w, 1, 30000, 0) || num(sh.g, 1, 30000, 300);
      return { id: String(k + 1), width: num(sh.w, 11, 100, 16), height: num(sh.h, 2, 100, 6), length: num(sh.l, 16, 100, 20), weight: Math.round(g) / 1000, insurance_value: Math.max(0, Number(l.p) || 0), quantity: l.q };
    });
    const r = await jf(MEU(me.sb) + '/api/v2/me/shipment/calculate', { method: 'POST', headers: { Authorization: 'Bearer ' + tok, Accept: 'application/json', 'Content-Type': 'application/json', 'User-Agent': UA() }, body: JSON.stringify({ from: { postal_code: cep8(sh.cep) }, to: { postal_code: cepTo }, products, options: { receipt: false, own_hand: false }, services: SVC_OK.test(sh.svcs || '') ? sh.svcs : '1,2' }) });
    if (!r.ok || !Array.isArray(r.j)) return { error: r.s === 401 || r.s === 403 ? 'auth' : 'api' };
    const opts = r.j.filter(x => x && !x.error && Number(x.custom_price || x.price) > 0).map(x => ({ id: Number(x.id), name: clean(x.name, 40), company: clean(x.company && x.company.name, 30), price: Math.round(Number(x.custom_price || x.price) * 100) / 100, days: Math.round(Number(x.custom_delivery_time || x.delivery_time) || 0) })).sort((a, b) => a.price - b.price).slice(0, 6);
    return { options: opts };
  }
  const shipCtx = async (req) => {
    const st = await siteOf(req); if (!st || !st.j.ship) return {};
    const I = await getI(st.owner);
    return { st, I };
  };
  app.all('/api/site/caps', async (req, res) => {
    if (cors(req, res)) return;
    res.setHeader('Cache-Control', 'no-store');
    try {
      const st = await siteOf(req); if (!st) return res.json({ ship: 0, mp: 0 });
      const I = await getI(st.owner);
      res.json({ ship: st.j.ship && I.me && I.me.tok && cep8((I.ship || {}).cep) ? 1 : 0, mp: st.j.mpay && I.mp && I.mp.tok ? 1 : 0 });
    } catch (e) { res.json({ ship: 0, mp: 0 }); }
  });
  app.all('/api/ship/quote', async (req, res) => {
    if (cors(req, res)) return;
    if (req.method !== 'POST') return res.status(405).json({ error: 'method' });
    try {
      if (limited('shq:' + ipOf(req), 40, 3600e3)) return res.status(429).json({ error: 'rate' });
      const { st, I } = await shipCtx(req), b = req.body || {}, cep = cep8(b.cep);
      if (!st) return res.status(400).json({ error: 'off' });
      if (!cep) return res.status(400).json({ error: 'cep' });
      const lines = await linesOf(st, b.items); if (lines.error) return res.status(400).json(lines);
      const q = await quote(st, I, cep, lines.lines);
      if (q.error) return res.status(q.error === 'api' ? 502 : 409).json({ error: q.error });
      res.json({ options: q.options });
    } catch (e) { console.error('shipq', e.message); res.status(500).json({ error: 'server' }); }
  });
  async function linesOf(st, raw) {
    const its = st.j.items || []; raw = Array.isArray(raw) ? raw.slice(0, 40) : []; if (!raw.length) return { error: 'bad' };
    const lines = [];
    for (const r of raw) {
      const q = Math.floor(num(r && r.q, 1, 99, 0)); if (!q) return { error: 'bad' };
      const nm = clean(r.n, 80); let ix = Number.isInteger(r.i) ? r.i : -1;
      if (!its[ix] || clean(its[ix].n, 80) !== nm) ix = its.findIndex(x => clean(x.n, 80) === nm);
      if (ix < 0) return { error: 'item' };
      lines.push({ ix, q, p: Math.max(0, Number(its[ix].p) || 0) });
    }
    return { lines };
  }
  // usado pelo /api/order: recalcula o frete no servidor (não confia no valor do navegador)
  X.shipFee = async (st, b, lines) => {
    const I = await getI(st.owner), cep = cep8(b.cep), svc = Number(b.svc);
    if (!cep || !Number.isFinite(svc)) return { error: 'ship' };
    const q = await quote(st, I, cep, lines); if (q.error) return { error: 'ship' };
    const o = q.options.find(x => x.id === svc); if (!o) return { error: 'ship' };
    return { fee: o.price, ship: { id: o.id, name: o.name, company: o.company, days: o.days, cep } };
  };
  X.shipOn = async (st) => { if (!st.j.ship) return false; const I = await getI(st.owner); return !!(I.me && I.me.tok && cep8((I.ship || {}).cep)); };

  // ---------- pagamento online (Mercado Pago do cliente)
  X.mpOn = async (st) => { if (!st.j.mpay) return false; const I = await getI(st.owner); return !!(I.mp && I.mp.tok); };
  X.mpPref = async (st, o, key) => {
    const I = await getI(st.owner), tok = I.mp && dec(I.mp.tok); if (!tok) return null;
    const ap = appUrl(), body = { items: [{ title: ('Pedido #' + o.no + ' - ' + st.name).slice(0, 120), quantity: 1, currency_id: 'BRL', unit_price: o.total }], external_reference: st.id + ':' + key, notification_url: ap + '/api/mp/hook?s=' + st.id, payer: { name: o.name }, statement_descriptor: clean(st.name, 22).replace(/[^A-Za-z0-9 ]/g, '') || undefined };
    if (st.slug && c.ROOT && !/^http:/.test(ap)) { const base = 'https://' + st.slug + '.' + c.ROOT + '/'; body.back_urls = { success: base + '?pedido=' + o.no, pending: base + '?pedido=' + o.no, failure: base }; body.auto_return = 'approved'; }
    const r = await jf(MPU() + '/checkout/preferences', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + tok }, body: JSON.stringify(body) });
    if (!r.ok || !r.j) return null;
    const u = /^TEST-/.test(tok) ? (r.j.sandbox_init_point || r.j.init_point) : r.j.init_point;
    return /^https:\/\//.test(u || '') ? { url: u, id: String(r.j.id || '').slice(0, 80) } : null;
  };
  app.all('/api/mp/hook', async (req, res) => {
    try {
      const s = String(req.query.s || ''); if (!ID.test(s)) return res.status(200).end();
      if (limited('mph:' + s, 600, 3600e3)) return res.status(200).end();
      const b = req.body && typeof req.body === 'object' ? req.body : {};
      const pid = String(req.query['data.id'] || (b.data && b.data.id) || req.query.id || '').replace(/[^0-9]/g, '').slice(0, 20);
      const type = String(req.query.type || req.query.topic || b.type || ''); if (!pid || (type && type !== 'payment')) return res.status(200).end();
      const sd = await store.get('sites/' + s); if (!sd) return res.status(200).end();
      const I = await getI(sd.owner || 'admin'), tok = I.mp && dec(I.mp.tok); if (!tok) return res.status(200).end();
      const r = await jf(MPU() + '/v1/payments/' + pid, { headers: { Authorization: 'Bearer ' + tok } });
      if (!r.ok || !r.j) return res.status(200).end();
      const m = /^([a-z0-9]{1,16}):([a-z0-9]{1,40})$/.exec(String(r.j.external_reference || '')); if (!m || m[1] !== s) return res.status(200).end();
      const o = await store.get('sorders/' + s + '/' + m[2]); if (!o || o.pay !== 'online') return res.status(200).end();
      const stt = String(r.j.status || '');
      let pg = o.pg;
      if (stt === 'approved' && Math.abs(Number(r.j.transaction_amount) - o.total) < 0.011) pg = 'pago';
      else if (stt === 'rejected' || stt === 'cancelled') pg = o.pg === 'pago' ? 'pago' : 'recusado';
      else if (stt === 'refunded' || stt === 'charged_back') pg = 'estornado';
      else if (o.pg !== 'pago') pg = 'aguardando';
      if (pg !== o.pg || o.pgid !== pid) { o.pg = pg; o.pgid = pid; o.pgat = Date.now(); if (pg === 'pago' && o.st === 'novo') o.st = 'confirmado'; await store.set('sorders/' + s + '/' + m[2], o); }
      res.status(200).end();
    } catch (e) { console.error('mphook', e.message); res.status(200).end(); }
  });

  // ---------- painel: conectar contas
  const guard = (req, res) => {
    if (kind(hostOf(req)).t !== 'app' || !isAuth(req)) { res.status(401).json({ error: 'auth' }); return false; }
    if (!allowed(req)) { res.status(403).json({ error: 'Integrações de pagamento e frete estão disponíveis nos planos Pro e Premium.' }); return false; }
    if (!KEY()) { res.status(503).json({ error: 'Servidor sem SESSION_SECRET: não é possível guardar tokens com segurança.' }); return false; }
    return true;
  };
  const view = (I) => ({ mp: I.mp && I.mp.tok ? { on: 1, masked: I.mp.m, nick: I.mp.nick || '', at: I.mp.at } : { on: 0 }, me: I.me && I.me.tok ? { on: 1, masked: I.me.m, name: I.me.name || '', sb: I.me.sb ? 1 : 0, at: I.me.at } : { on: 0, sb: 0 }, ship: { cep: (I.ship || {}).cep || '', w: (I.ship || {}).w || 16, h: (I.ship || {}).h || 6, l: (I.ship || {}).l || 20, g: (I.ship || {}).g || 300, svcs: (I.ship || {}).svcs || '1,2' } });
  app.get('/api/integrations', async (req, res) => {
    if (kind(hostOf(req)).t !== 'app' || !isAuth(req)) return res.status(401).json({ error: 'auth' });
    if (!allowed(req)) return res.json({ allowed: false });
    res.json({ allowed: true, ...view(await getI(ownerOf(req))) });
  });
  app.post('/api/integrations/mp', async (req, res) => {
    if (!guard(req, res)) return;
    if (limited('int:' + ownerOf(req), 20, 3600e3)) return res.status(429).json({ error: 'Muitas tentativas. Aguarde um pouco.' });
    const tok = String((req.body || {}).token || '').trim();
    if (!TOK.test(tok)) return res.status(400).json({ error: 'Token inválido. Copie o Access Token de produção da sua conta do Mercado Pago.' });
    const r = await jf(MPU() + '/users/me', { headers: { Authorization: 'Bearer ' + tok } }).catch(() => null);
    if (!r || !r.ok || !r.j) return res.status(400).json({ error: r && (r.s === 401 || r.s === 403) ? 'O Mercado Pago recusou este token.' : 'Não consegui falar com o Mercado Pago agora. Tente de novo.' });
    const I = await getI(ownerOf(req)); I.mp = { tok: enc(tok), m: mask(tok), nick: clean(r.j.nickname || r.j.email, 60), at: Date.now() };
    await store.set('integ/' + ownerOf(req), I); X.audit(ownerOf(req), 'integ.mp', 'conectado');
    res.json({ ok: true, ...view(I) });
  });
  app.post('/api/integrations/me', async (req, res) => {
    if (!guard(req, res)) return;
    if (limited('int:' + ownerOf(req), 20, 3600e3)) return res.status(429).json({ error: 'Muitas tentativas. Aguarde um pouco.' });
    const b = req.body || {}, I = await getI(ownerOf(req)), tok = String(b.token || '').trim(), cep = cep8(b.cep);
    if (!cep) return res.status(400).json({ error: 'Informe o CEP de origem (de onde você envia), com 8 números.' });
    const sb = !!b.sb;
    if (tok) {
      if (!TOK.test(tok)) return res.status(400).json({ error: 'Token inválido. Gere um token no Melhor Envio (Configurações → Tokens).' });
      const r = await jf(MEU(sb) + '/api/v2/me', { headers: { Authorization: 'Bearer ' + tok, Accept: 'application/json', 'User-Agent': UA() } }).catch(() => null);
      if (!r || !r.ok || !r.j) return res.status(400).json({ error: r && (r.s === 401 || r.s === 403) ? 'O Melhor Envio recusou este token.' : 'Não consegui falar com o Melhor Envio agora. Tente de novo.' });
      I.me = { tok: enc(tok), m: mask(tok), name: clean(((r.j.firstname || '') + ' ' + (r.j.lastname || '')).trim() || r.j.email, 60), sb, at: Date.now() };
    } else if (!I.me || !I.me.tok) return res.status(400).json({ error: 'Cole o token do Melhor Envio.' });
    else I.me.sb = sb;
    const svcs = String(b.svcs || '1,2').replace(/\s/g, '');
    I.ship = { cep, w: num(b.w, 11, 100, 16), h: num(b.h, 2, 100, 6), l: num(b.l, 16, 100, 20), g: num(b.g, 1, 30000, 300), svcs: SVC_OK.test(svcs) ? svcs : '1,2' };
    await store.set('integ/' + ownerOf(req), I); X.audit(ownerOf(req), 'integ.me', 'conectado');
    res.json({ ok: true, ...view(I) });
  });
  app.post('/api/integrations/remove', async (req, res) => {
    if (kind(hostOf(req)).t !== 'app' || !isAuth(req)) return res.status(401).json({ error: 'auth' });
    const w = String((req.body || {}).which || ''); if (!['mp', 'me'].includes(w)) return res.status(400).json({ error: 'bad' });
    const I = await getI(ownerOf(req)); delete I[w]; if (w === 'me') delete I.ship;
    await store.set('integ/' + ownerOf(req), I); X.audit(ownerOf(req), 'integ.' + w, 'removido');
    res.json({ ok: true, ...view(I) });
  });
  void rid; void wasMine;
};
