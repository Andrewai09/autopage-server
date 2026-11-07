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
  // frete da plataforma: um token único do administrador (ME_TOKEN) atende todas as lojas; o cliente só informa o CEP de origem
  const PT = () => String(process.env.ME_TOKEN || '').trim();
  const PSB = () => process.env.ME_SANDBOX === '1';
  // credenciais de cotação: token do próprio cliente (se ele conectou) ou o da plataforma
  const shipCred = (st, I) => {
    const me = I.me, sh = I.ship || {};
    if (me && me.tok && cep8(sh.cep)) { const tok = dec(me.tok); if (tok) return { tok, sb: me.sb, from: cep8(sh.cep), sh }; }
    if (PT() && cep8(st.j.ocep)) return { tok: PT(), sb: PSB(), from: cep8(st.j.ocep), sh: {} };
    return null;
  };
  X.shipPlat = () => !!PT();

  // ---------- frete (Melhor Envio)
  async function quote(st, I, cepTo, lines) {
    const cr = shipCred(st, I); if (!cr) return { error: 'noint' };
    const me = { sb: cr.sb }, sh = cr.sh, tok = cr.tok;
    const its = st.j.items || [];
    const products = lines.map((l, k) => {
      const it = its[l.ix] || {}, g = num(it.w, 1, 30000, 0) || num(sh.g, 1, 30000, 300);
      return { id: String(k + 1), width: num(sh.w, 11, 100, 16), height: num(sh.h, 2, 100, 6), length: num(sh.l, 16, 100, 20), weight: Math.round(g) / 1000, insurance_value: Math.max(0, Number(l.p) || 0), quantity: l.q };
    });
    const r = await jf(MEU(me.sb) + '/api/v2/me/shipment/calculate', { method: 'POST', headers: { Authorization: 'Bearer ' + tok, Accept: 'application/json', 'Content-Type': 'application/json', 'User-Agent': UA() }, body: JSON.stringify({ from: { postal_code: cr.from }, to: { postal_code: cepTo }, products, options: { receipt: false, own_hand: false }, services: SVC_OK.test(sh.svcs || '') ? sh.svcs : '1,2' }) });
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
      res.json({ ship: st.j.ship && shipCred(st, I) ? 1 : 0, mp: st.j.mpay && I.mp && I.mp.tok ? 1 : 0 });
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
  X.shipOn = async (st) => { if (!st.j.ship) return false; const I = await getI(st.owner); return !!shipCred(st, I); };

  // ---------- pagamento online (Mercado Pago do cliente)
  X.mpOn = async (st) => { if (!st.j.mpay) return false; const I = await getI(st.owner); return !!(I.mp && I.mp.tok); };
  X.mpPref = async (st, o, key) => {
    const I = await getI(st.owner), tok = I.mp && dec(I.mp.tok); if (!tok) return null;
    const ap = appUrl(), body = { items: [{ title: ('Pedido #' + o.no + ' - ' + st.name).slice(0, 120), quantity: 1, currency_id: 'BRL', unit_price: o.total }], external_reference: st.id + ':' + key, notification_url: ap + '/api/mp/hook?s=' + st.id, payer: Object.assign({ name: o.name }, o.em ? { email: o.em } : {}), statement_descriptor: clean(st.name, 22).replace(/[^A-Za-z0-9 ]/g, '') || undefined };
    if (st.slug && c.ROOT && !/^http:/.test(ap)) { const base = 'https://' + st.slug + '.' + c.ROOT + '/'; body.back_urls = { success: base + '?pedido=' + o.no + (o.kd ? '&ok=1' : ''), pending: base + '?pedido=' + o.no, failure: base }; body.auto_return = 'approved'; }
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
      let dv = false, rf = false; if (pg === 'estornado' && o.pg !== 'estornado' && o.kd) rf = true; if (pg !== o.pg || o.pgid !== pid) { o.pg = pg; o.pgid = pid; o.pgat = Date.now(); if (pg === 'pago' && o.st === 'novo') o.st = 'aceito'; if (pg === 'pago' && o.kd && !o.sent) { o.sent = 1; dv = true; } await store.set('sorders/' + s + '/' + m[2], o); }
      if (dv) deliver(sd, s, m[2], o).catch((e) => console.error('deliver', e.message));
      if (rf) refundAlert(sd, o).catch((e) => console.error('refund', e.message));
      res.status(200).end();
    } catch (e) { console.error('mphook', e.message); res.status(200).end(); }
  });


  // ---------- checkout próprio da página de vendas: pedido no servidor, Mercado Pago do cliente e e-mail de acesso após aprovação
  // O link de acesso fica em sdl/<site> (só no servidor): o JSON do site é público e não pode conter o produto pago.
  const deliver = async (sd, s, key, o) => {
    const j = JSON.parse(sd.j || '{}'), cf = (await store.get('sdl/' + s)) || {}, nm = clean(j.name, 80);
    let r = { skipped: true };
    if (X.mailOn()) r = await X.sendMail({ to: o.em, subject: 'Seu acesso: ' + nm, html: X.wrap('Pagamento confirmado', '<p>Olá, ' + X.esc(o.name) + '! Recebemos o pagamento de <b>' + X.esc(nm) + '</b>.</p>' + (cf.url ? '<p>Seu acesso:</p>' + X.btn(cf.url, 'Acessar agora') : '<p>O vendedor enviará o seu acesso em breve.</p>') + (cf.msg ? '<p>' + X.esc(cf.msg) + '</p>' : '') + (j.sle ? '<p style="color:#6b7280">Dúvidas: ' + X.esc(j.sle) + '</p>' : '')) });
    const cur = await store.get('sorders/' + s + '/' + key); if (cur) { cur.mok = r && r.ok ? 1 : 0; await store.set('sorders/' + s + '/' + key, cur); }
    const ow = sd.owner && sd.owner !== 'admin' ? await store.get('users/' + sd.owner) : null, to = ow ? ow.email : String(process.env.ADMIN_EMAIL || '').trim();
    if (to && X.mailOn()) await X.sendMail({ to, ...X.mail.lead(nm, { n: o.name, c: o.em, m: 'Venda aprovada · R$ ' + Number(o.total).toFixed(2).replace('.', ',') + (r && r.ok ? ' · acesso enviado ao comprador' : ' · ATENÇÃO: o e-mail de acesso NÃO foi enviado, envie manualmente') }, appUrl() + '/') });
  };

  const sellerMail = async (sd) => { const ow = sd.owner && sd.owner !== 'admin' ? await store.get('users/' + sd.owner) : null; return ow ? ow.email : String(process.env.ADMIN_EMAIL || '').trim(); };
  // estorno/chargeback: o acesso já enviado não é revogado sozinho (fica na sua plataforma de conteúdo): o vendedor é avisado para agir
  const refundAlert = async (sd, o) => { const to = await sellerMail(sd); if (!to || !X.mailOn()) return; const j = JSON.parse(sd.j || '{}'); await X.sendMail({ to, ...X.mail.lead(clean(j.name, 60), { n: o.name, c: o.em, m: 'ESTORNO/chargeback do pedido #' + o.no + ' · R$ ' + Number(o.total).toFixed(2).replace('.', ',') + ' · se você já liberou o acesso, remova-o na sua plataforma de conteúdo' }, appUrl() + '/') }); };
  // checkout abandonado: um único lembrete ao comprador que informou o e-mail, entre 2 h e 48 h depois (roda no tick do /healthz, a cada ~6 h)
  X.cartJob = async () => {
    if (!X.mailOn()) return { sent: 0 };
    const all = await store.list('sorders/', 3000, true); let sent = 0; const now = Date.now();
    for (const x of all) {
      const o = x.data; if (!o || !o.kd || o.pg !== 'aguardando' || o.rem || !o.em || !/^https:\/\//.test(o.url || '')) continue;
      const age = now - (o.at || 0); if (age < 2 * 3600e3 || age > 48 * 3600e3) continue;
      const sid = String(x.path).split('/')[1], sd = await store.get('sites/' + sid); if (!sd) continue;
      const j = JSON.parse(sd.j || '{}'), nm = clean(j.name, 80);
      o.rem = now; await store.set(x.path, o);
      await X.sendMail({ to: o.em, subject: 'Você deixou sua compra pela metade: ' + nm, html: X.wrap('Falta pouco', '<p>Olá, ' + X.esc(o.name) + '! Você começou a comprar <b>' + X.esc(nm) + '</b>, mas o pagamento não foi concluído.</p>' + X.btn(o.url, 'Finalizar minha compra') + '<p style="color:#6b7280;font-size:13px">Este é o único lembrete. Se já pagou ou não quer mais, é só ignorar este e-mail.</p>' + (j.sle ? '<p style="color:#6b7280;font-size:13px">Dúvidas: ' + X.esc(j.sle) + '</p>' : '')) });
      if (++sent >= 40) break;
    }
    return { sent };
  };
  app.all('/api/dpay', async (req, res) => {
    if (cors(req, res)) return;
    if (req.method !== 'POST') return res.status(405).json({ error: 'method' });
    try {
      if (limited('dp:' + ipOf(req), 10, 3600e3)) return res.status(429).json({ error: 'rate' });
      const st = await siteOf(req), b = req.body || {};
      if (!st || st.j.goal !== 'sales') return res.status(400).json({ error: 'bad' });
      if (limited('dps:' + st.id, 400, 86400e3)) return res.status(429).json({ error: 'rate' });
      const price = Math.round((Number(st.j.sp) || 0) * 100) / 100;
      if (!(price > 0) || price > 999999) return res.status(409).json({ error: 'price' });
      if (!(await X.mpOn(st))) return res.status(409).json({ error: 'pay' });
      const em = clean(b.email, 120).toLowerCase(), nm = clean(b.name, 80);
      if (!nm || !/^[^\s@<>"']{1,64}@[^\s@<>"']{1,120}\.[^\s@<>"']{2,20}$/.test(em)) return res.status(400).json({ error: 'bad' });
      const ctr = (await store.get('sctr/' + st.id)) || { n: 0 }; ctr.n = (ctr.n || 0) + 1; await store.set('sctr/' + st.id, ctr);
      const o = { no: ctr.n, items: [{ n: clean(st.j.name || st.name, 80), v: '', q: 1, p: price }], sub: price, d: 0, fee: 0, total: price, mode: 'digital', name: nm, em, kd: 1, pay: 'online', pg: 'aguardando', st: 'novo', at: Date.now() };
      const key = Date.now().toString(36) + rid();
      const pu = await X.mpPref(st, o, key).catch(() => null); if (!pu) return res.status(502).json({ error: 'pay' });
      o.pgref = pu.id; o.url = pu.url; await store.set('sorders/' + st.id + '/' + key, o);
      if (Math.random() < 0.03) store.trim('sorders/' + st.id + '/', 5000).catch(() => {});
      res.json({ ok: true, no: o.no, url: pu.url });
    } catch (e) { console.error('dpay', e.message); res.status(500).json({ error: 'server' }); }
  });
  app.get('/api/dpay/stats', async (req, res) => {
    if (kind(hostOf(req)).t !== 'app' || !isAuth(req)) return res.status(401).json({ error: 'auth' });
    const sid = String(req.query.site || '');
    if (!ID.test(sid) || !(await wasMine(req, sid))) return res.status(403).json({ error: 'forbidden' });
    const all = (await store.list('sorders/' + sid + '/', 5000, true)).map((x) => x.data).filter((o) => o && o.kd);
    const paid = all.filter((o) => o.pg === 'pago'), rev = paid.reduce((t, o) => t + (Number(o.total) || 0), 0);
    res.json({ paid: paid.length, rev: Math.round(rev * 100) / 100, wait: all.filter((o) => o.pg === 'aguardando').length, refunded: all.filter((o) => o.pg === 'estornado').length, noMail: paid.filter((o) => o.mok === 0).length });
  });
  app.all('/api/dpay/cfg', async (req, res) => {
    if (kind(hostOf(req)).t !== 'app' || !isAuth(req)) return res.status(401).json({ error: 'auth' });
    const b = req.method === 'POST' ? (req.body || {}) : req.query, sid = String(b.site || '');
    if (!ID.test(sid) || !(await wasMine(req, sid))) return res.status(403).json({ error: 'forbidden' });
    if (req.method === 'POST') {
      let u = String(b.url || '').trim(); if (u && !/^https:\/\/[^\s"'<>]{4,400}$/.test(u)) return res.status(400).json({ error: 'url' });
      await store.set('sdl/' + sid, { url: u, msg: clean(b.msg, 400), at: Date.now() });
    }
    const cf = (await store.get('sdl/' + sid)) || {}; res.json({ url: cf.url || '', msg: cf.msg || '' });
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
