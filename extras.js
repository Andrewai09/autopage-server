'use strict';
// Funções extras do AutoPage: auditoria, e-mail, cupons, indicação, teste grátis, contato/leads,
// versões de site, domínio próprio, estatísticas por site e backups automáticos.
const crypto = require('crypto');
const dns = require('dns').promises;

module.exports = function makeExtras(base) {
  const { store, ROOT, APP_HOST } = base;
  const rid = () => crypto.randomBytes(5).toString('hex');
  const clean = (s, n) => String(s == null ? '' : s).replace(/[\u0000-\u001f\u007f<>]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, n);
  const DAY = 864e5;
  const X = {};

  // ---------- auditoria
  X.audit = async (who, a, d) => {
    try {
      await store.set('audit/' + Date.now().toString(36) + rid(), { at: Date.now(), who: clean(who, 60), a: clean(a, 40), d: clean(d, 200) });
      if (Math.random() < 0.02) store.trim('audit/', 1500).catch(() => {});
    } catch (e) { /* auditoria nunca derruba a requisição */ }
  };

  // ---------- e-mail (Resend). Sem RESEND_API_KEY o envio é ignorado.
  X.mailOn = () => !!process.env.RESEND_API_KEY;
  X.sendMail = async ({ to, subject, html, attachments }) => {
    if (!process.env.RESEND_API_KEY || !to) return { skipped: true };
    let ok = false, err = '';
    try {
      const r = await fetch(process.env.RESEND_URL || 'https://api.resend.com/emails', {
        method: 'POST',
        headers: { 'content-type': 'application/json', Authorization: 'Bearer ' + process.env.RESEND_API_KEY },
        body: JSON.stringify({ from: process.env.MAIL_FROM || 'AutoPage <onboarding@resend.dev>', to: [to], subject, html, attachments })
      });
      ok = r.ok; if (!ok) err = 'HTTP ' + r.status;
    } catch (e) { err = e.message; }
    try { await store.set('maillog/' + Date.now().toString(36) + rid(), { at: Date.now(), to: clean(to, 120), s: clean(subject, 100), ok, err }); store.trim('maillog/', 300).catch(() => {}); } catch (e) { /* ignora */ }
    return { ok, err };
  };
  const esc = (s) => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const wrap = (t, body) => '<div style="font:16px/1.55 system-ui,Arial;max-width:520px;margin:auto;padding:24px"><h2 style="margin:0 0 12px">🪄 ' + esc(t) + '</h2>' + body + '<p style="color:#6b7280;font-size:13px;margin-top:24px">AutoPage.ai · ' + esc(APP_HOST) + '</p></div>';
  const btn = (u, t) => '<p><a href="' + esc(u) + '" style="display:inline-block;background:#4f46e5;color:#fff;padding:12px 18px;border-radius:10px;text-decoration:none;font-weight:700">' + esc(t) + '</a></p>';
  X.mail = {
    welcome: (u, url) => ({ subject: 'Bem-vindo ao AutoPage.ai', html: wrap('Bem-vindo, ' + clean(u.name, 60), '<p>Seu acesso está pronto. Crie seu primeiro site a partir do link de uma rede social.</p>' + btn(url, 'Abrir meu painel')) }),
    receipt: (u, o, planName, until, url) => ({ subject: 'Pagamento aprovado · plano ' + planName, html: wrap('Pagamento aprovado', '<p>Recebemos <b>R$ ' + (+o.amount).toFixed(2).replace('.', ',') + '</b> pelo plano <b>' + esc(planName) + '</b>.</p><p>Seu plano vale até <b>' + new Date(until).toLocaleDateString('pt-BR') + '</b>.</p>' + btn(url, 'Entrar no painel')) }),
    expiring: (u, days, url) => ({ subject: 'Seu plano vence em ' + days + ' dia(s)', html: wrap('Seu plano está vencendo', '<p>Olá, ' + esc(clean(u.name, 60)) + '. Seu plano vence em <b>' + days + ' dia(s)</b>. Renove para manter os limites atuais. Seus sites continuam no ar mesmo se o plano vencer.</p>' + btn(url, 'Renovar plano')) }),
    expired: (u, url) => ({ subject: 'Seu plano venceu', html: wrap('Seu plano venceu', '<p>Olá, ' + esc(clean(u.name, 60)) + '. Seu plano venceu e a conta voltou ao plano gratuito. Seus sites publicados continuam no ar.</p>' + btn(url, 'Renovar plano')) }),
    reward: (u, url) => ({ subject: 'Você ganhou 7 dias grátis', html: wrap('Indicação confirmada', '<p>Um amigo que você indicou assinou um plano. Adicionamos <b>7 dias</b> ao seu plano como agradecimento.</p>' + btn(url, 'Ver meu painel')) }),
    lead: (siteName, m, url) => ({ subject: 'Nova mensagem em ' + siteName, html: wrap('Nova mensagem em ' + clean(siteName, 60), '<p><b>' + esc(m.n) + '</b>' + (m.c ? ' · ' + esc(m.c) : '') + '</p>' + (m.m ? '<p>' + esc(m.m) + '</p>' : '') + (m.x ? '<p style="color:#6b7280">' + esc(m.x) + '</p>' : '') + btn(url, 'Ver todas as mensagens')) })
  };

  // ---------- backup (completo, sem hash de senha)
  X.exportAll = async () => {
    const get = async (p) => (await store.list(p, 5000, true)).map(x => ({ path: x.path, data: x.data }));
    const users = (await get('users/')).map(x => ({ path: x.path, data: { ...x.data, pw: undefined } }));
    return { at: new Date().toISOString(), users, sites: await get('sites/'), orders: await get('orders/'), config: await get('config/'), coupons: await get('coupons/'), domains: await get('domain/'), msgs: await get('msgs/') };
  };
  X.backupNow = async (who) => {
    const day = new Date(Date.now() - 3 * 3600e3).toISOString().slice(0, 10), json = JSON.stringify(await X.exportAll());
    await store.set('backup/' + day, { at: Date.now(), size: json.length, json });
    await store.trim('backup/', 3);
    let mailed = false;
    const to = String(process.env.ADMIN_EMAIL || '').trim();
    if (X.mailOn() && to && json.length < 15e6) {
      const r = await X.sendMail({ to, subject: 'Backup AutoPage · ' + day, html: wrap('Backup diário', '<p>Segue o backup completo em anexo (' + Math.round(json.length / 1024) + ' KB). Guarde em local seguro.</p>'), attachments: [{ filename: 'autopage-backup-' + day + '.json', content: Buffer.from(json).toString('base64') }] });
      mailed = !!r.ok;
    }
    await X.audit(who || 'sistema', 'backup.run', day + ' · ' + Math.round(json.length / 1024) + ' KB' + (mailed ? ' · e-mail enviado' : ''));
    return { day, size: json.length, mailed };
  };
  X.backupIfDue = async () => {
    const day = new Date(Date.now() - 3 * 3600e3).toISOString().slice(0, 10);
    if (await store.get('backup/' + day)) return null;
    return X.backupNow('sistema');
  };

  // ---------- e-mails de vencimento
  X.expiryJob = async (appUrl) => {
    const now = Date.now(), users = (await store.list('users/', 2000, true)).map(x => x.data).filter(Boolean);
    let a = 0, b = 0;
    for (const u of users) {
      if (!u.planUntil || u.status !== 'active') continue;
      const left = u.planUntil - now;
      if (left > 0 && left <= 5 * DAY && u.notifyExp !== u.planUntil) {
        u.notifyExp = u.planUntil; await store.set('users/' + u.id, u);
        await X.sendMail({ to: u.email, ...X.mail.expiring(u, Math.max(1, Math.ceil(left / DAY)), appUrl + '/planos') }); a++;
      } else if (left <= 0 && u.notifyExpd !== u.planUntil) {
        u.notifyExpd = u.planUntil; await store.set('users/' + u.id, u);
        await X.sendMail({ to: u.email, ...X.mail.expired(u, appUrl + '/planos') }); b++;
      }
    }
    return { expiring: a, expired: b };
  };

  // ---------- cupons
  const CODE = /^[A-Z0-9]{3,20}$/;
  X.couponFind = async (raw) => {
    const code = String(raw || '').trim().toUpperCase();
    if (!CODE.test(code)) return null;
    const c = await store.get('coupons/' + code);
    if (!c) return null;
    if (c.exp && c.exp < Date.now()) return null;
    if (c.max > 0 && (c.used || 0) >= c.max) return null;
    return c;
  };
  X.priced = (price, c) => (c ? Math.max(1, Math.round(price * (100 - c.pct)) / 100) : price);

  // ---------- resolução de site por domínio
  X.siteByDomain = async (host) => {
    if (!host || host === APP_HOST || host.endsWith('.' + ROOT)) return null;
    const d = await store.get('domain/' + host);
    return d && d.ok ? d : null;
  };

  // ---------- rotas
  X.routes = function (c) {
    const { app, kind, hostOf, ipOf, limited, isAdmin, isAuth, ID, PLANS, planOf, pwHash, pwCheck, mkToken, EMAIL, needAdmin, allSites, canSite, appUrl } = c;
    const secureC = (req) => (req.headers['x-forwarded-proto'] === 'https' ? '; Secure' : '');
    const cors = (req, res) => {
      res.setHeader('Access-Control-Allow-Origin', '*');
      if (req.method === 'OPTIONS') { res.setHeader('Access-Control-Allow-Methods', 'GET,POST'); res.setHeader('Access-Control-Allow-Headers', 'Content-Type'); res.status(204).end(); return true; }
      return false;
    };
    const who = (req) => (req.u ? (isAdmin(req) ? 'admin' : req.u.name + ' <' + (req.u.user && req.u.user.email) + '>') : 'anônimo');
    const wasMine = async (req, id) => (await canSite(req, id));

    // --- cadastro com 7 dias de Pro (+ indicação)
    const SIGNUP_ON = () => String(process.env.SIGNUP || 'on').toLowerCase() !== 'off';
    const page = (t, body) => '<!doctype html><html lang=pt-BR><meta charset=utf-8><meta name=viewport content="width=device-width,initial-scale=1"><title>' + esc(t) + '</title><body style="margin:0;min-height:100vh;display:grid;place-items:center;background:#0b1020;color:#e8ecff;font:16px system-ui;padding:16px">' + body + '</html>';
    const inp = 'padding:12px;border-radius:10px;border:1px solid #2b3566;background:#0b1020;color:#fff;width:100%;box-sizing:border-box';
    app.get('/cadastro', (req, res) => {
      if (kind(hostOf(req)).t !== 'app') return res.status(404).end();
      if (!SIGNUP_ON()) return res.type('html').send(page('Cadastro', '<p>Cadastros fechados no momento. <a style="color:#a5b4fc" href=/planos>Ver planos</a></p>'));
      const ref = clean(req.query.ref, 20).replace(/[^a-z0-9]/g, '');
      res.type('html').send(page('Criar conta · AutoPage.ai', '<form id=f style="width:min(360px,92vw);background:#141a33;padding:28px;border-radius:16px;display:grid;gap:12px"><h2 style="margin:0">🪄 Criar conta grátis</h2><div style="color:#b7c0dc;font-size:14px">Ganhe <b>7 dias do plano Pro</b> para testar. Sem cartão.</div><input id=n placeholder="Seu nome" required maxlength=80 style="' + inp + '"><input id=e type=email placeholder="Seu e-mail" required style="' + inp + '"><input id=p type=password placeholder="Crie uma senha (8+ caracteres)" required minlength=8 style="' + inp + '"><input id=w tabindex=-1 autocomplete=off style="position:absolute;left:-9999px" aria-hidden=true><div id=m style="color:#fca5a5;min-height:20px"></div><button style="padding:12px;border:0;border-radius:10px;background:#4f46e5;color:#fff;font-weight:700;cursor:pointer">Criar conta e entrar</button><a href=/ style="color:#a5b4fc;text-align:center;font-size:14px">Já tenho conta</a></form><script>document.getElementById("f").onsubmit=async function(ev){ev.preventDefault();var m=document.getElementById("m");m.textContent="Criando…";try{var r=await fetch("/api/signup",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({name:n.value,email:e.value,password:p.value,w:w.value,ref:' + JSON.stringify(ref) + '})}),j=await r.json();if(!r.ok)throw new Error(j.error||"Erro");location.href="/"}catch(x){m.textContent=x.message}}</script>'));
    });
    app.post('/api/signup', async (req, res) => {
      if (kind(hostOf(req)).t !== 'app') return res.status(404).end();
      if (!SIGNUP_ON()) return res.status(403).json({ error: 'Cadastros fechados no momento.' });
      if (limited('su:' + ipOf(req), 5, 3600e3)) return res.status(429).json({ error: 'Muitas tentativas. Tente mais tarde.' });
      const b = req.body || {};
      if (b.w) return res.json({ ok: true }); // honeypot
      const name = clean(b.name, 80), email = String(b.email || '').trim().toLowerCase().slice(0, 200), pw = String(b.password || '');
      if (!name || !EMAIL.test(email)) return res.status(400).json({ error: 'Informe nome e um e-mail válido.' });
      if (pw.length < 8 || pw.length > 100) return res.status(400).json({ error: 'A senha precisa ter 8 caracteres ou mais.' });
      if (await store.get('uemail/' + email)) return res.status(409).json({ error: 'Esse e-mail já tem conta. Entre com sua senha.' });
      const ref = clean(b.ref, 20).replace(/[^a-z0-9]/g, ''), refU = ref && ID.test(ref) ? await store.get('users/' + ref) : null;
      const id = crypto.randomBytes(6).toString('hex');
      const u = { id, role: 'client', name, email, pw: pwHash(pw), status: 'active', plan: 'pro', planUntil: Date.now() + 7 * DAY, trialUsed: true, maxSites: 0, note: 'Cadastro online (teste de 7 dias)', tmp: false, createdAt: Date.now(), lastLogin: Date.now(), refBy: refU ? refU.id : '' };
      await store.set('users/' + id, u); await store.set('uemail/' + email, { id });
      await X.audit(email, 'signup', refU ? 'indicado por ' + refU.email : 'sem indicação');
      X.sendMail({ to: email, ...X.mail.welcome(u, appUrl() + '/') }).catch(() => {});
      res.setHeader('Set-Cookie', 'ap_s=' + mkToken({ r: 'client', u: id }, 7 * DAY) + '; HttpOnly; SameSite=Lax; Path=/; Max-Age=' + 7 * 86400 + secureC(req));
      res.json({ ok: true });
    });
    app.post('/api/trial', async (req, res) => {
      if (!isAuth(req) || isAdmin(req)) return res.status(401).json({ error: 'auth' });
      const u = req.u.user;
      if (u.trialUsed || planOf(u).key !== 'free') return res.status(400).json({ error: 'O teste grátis não está disponível para esta conta.' });
      u.plan = 'pro'; u.planUntil = Date.now() + 7 * DAY; u.maxSites = 0; u.trialUsed = true;
      await store.set('users/' + u.id, u); await X.audit(u.email, 'trial.start', '7 dias de Pro');
      res.json({ ok: true });
    });
    X.meExtra = async (u) => {
      const users = (await store.list('users/', 2000, true)).map(x => x.data).filter(Boolean);
      return { trialOk: !u.trialUsed && planOf(u).key === 'free', ref: { code: u.id, link: appUrl() + '/cadastro?ref=' + u.id, signups: users.filter(x => x.refBy === u.id).length, rewards: u.refRewards || 0 } };
    };

    // --- cupons (admin)
    app.post('/api/admin/coupons', async (req, res) => {
      if (!needAdmin(req, res)) return;
      const b = req.body || {}, code = String(b.code || '').trim().toUpperCase(), pct = Math.round(+b.pct);
      if (!CODE.test(code)) return res.status(400).json({ error: 'Código: 3 a 20 letras ou números, sem espaços.' });
      if (!(pct >= 1 && pct <= 90)) return res.status(400).json({ error: 'Desconto de 1% a 90%.' });
      const old = await store.get('coupons/' + code);
      const c = { code, pct, max: Math.min(100000, Math.max(0, Math.round(+b.max) || 0)), used: old ? old.used || 0 : 0, exp: +b.days > 0 ? Date.now() + Math.min(730, +b.days) * DAY : 0, at: Date.now() };
      await store.set('coupons/' + code, c); await X.audit('admin', 'coupon.save', code + ' ' + pct + '%');
      res.json({ ok: true, coupon: c });
    });
    app.post('/api/admin/coupons/delete', async (req, res) => {
      if (!needAdmin(req, res)) return;
      const code = String((req.body || {}).code || '').toUpperCase(); if (!CODE.test(code)) return res.status(400).json({ error: 'bad' });
      await store.del('coupons/' + code); await X.audit('admin', 'coupon.delete', code); res.json({ ok: true });
    });
    app.get('/api/coupon', async (req, res) => {
      if (kind(hostOf(req)).t !== 'app') return res.status(404).end();
      if (limited('cp:' + ipOf(req), 30, 600e3)) return res.status(429).json({ error: 'Muitas tentativas.' });
      const cp = await X.couponFind(req.query.code);
      if (!cp) return res.status(404).json({ error: 'Cupom inválido ou expirado.' });
      res.json({ ok: true, pct: cp.pct });
    });

    // --- mensagens, presenças e contatos (públicos, vindos dos sites)
    const siteOf = async (req) => {
      const k = kind(hostOf(req)); let id = '';
      if (k.t === 'site') { const ptr = await store.get('slug/' + k.slug); id = ptr ? ptr.id : ''; }
      else { const d = await X.siteByDomain(hostOf(req)); id = d ? d.site : ''; }
      if (!id) return null;
      const sd = await store.get('sites/' + id); if (!sd) return null;
      let j = {}; try { j = JSON.parse(sd.j || '{}'); } catch (e) { /* vazio */ }
      return { id, name: sd.name || j.name || 'Seu site', owner: sd.owner || 'admin', j };
    };
    X.siteOf = siteOf;
    app.all('/api/contact', async (req, res) => {
      if (cors(req, res)) return;
      if (req.method !== 'POST') return res.status(405).json({ error: 'method' });
      try {
        if (limited('ct:' + ipOf(req), 10, 3600e3)) return res.status(429).json({ error: 'rate' });
        const st = await siteOf(req), b = req.body || {};
        if (!st) return res.status(400).json({ error: 'bad' });
        if (b.w) return res.json({ ok: true });
        const type = ['msg', 'rsvp', 'lead'].includes(b.type) ? b.type : 'msg', n = clean(b.n, 80);
        if (!n) return res.status(400).json({ error: 'bad' });
        if (limited('cts:' + st.id, 300, 86400e3)) return res.status(429).json({ error: 'rate' });
        const m = { type, n, c: clean(b.c, 120), m: clean(b.m, 600), x: clean(b.x, 60), at: Date.now() };
        await store.set('msgs/' + st.id + '/' + Date.now().toString(36) + rid(), m);
        if (Math.random() < 0.05) store.trim('msgs/' + st.id + '/', 500).catch(() => {});
        const ow = st.owner !== 'admin' ? await store.get('users/' + st.owner) : null;
        const to = ow ? ow.email : String(process.env.ADMIN_EMAIL || '').trim();
        if (to && X.mailOn()) X.sendMail({ to, ...X.mail.lead(st.name, m, appUrl() + '/') }).catch(() => {});
        res.json({ ok: true });
      } catch (e) { console.error('contact', e.message); res.status(500).json({ error: 'server' }); }
    });
    const ownSites = async (req) => (await allSites()).filter(x => isAdmin(req) || x.owner === req.u.id);
    app.get('/api/messages', async (req, res) => {
      if (kind(hostOf(req)).t !== 'app' || !isAuth(req)) return res.status(401).json({ error: 'auth' });
      const mine = await ownSites(req), by = Object.fromEntries(mine.map(s => [s.id, s]));
      const only = String(req.query.site || '');
      if (only && !by[only]) return res.status(403).json({ error: 'forbidden' });
      const items = [];
      for (const s of only ? [by[only]] : mine) {
        for (const r of await store.list('msgs/' + s.id + '/', 200, true)) items.push({ id: r.path.split('/').pop(), site: s.id, siteName: s.name, ...r.data });
      }
      items.sort((a, b) => b.at - a.at);
      if (req.query.csv) {
        const q = (v) => '"' + String(v == null ? '' : v).replace(/"/g, '""').replace(/^([=+\-@])/, "'$1") + '"';
        res.setHeader('Content-Disposition', 'attachment; filename="mensagens.csv"');
        return res.type('text/csv').send('﻿Data,Site,Tipo,Nome,Contato,Mensagem,Extra\n' + items.map(i => [new Date(i.at).toLocaleString('pt-BR'), i.siteName, i.type, i.n, i.c, i.m, i.x].map(q).join(',')).join('\n'));
      }
      res.json({ items: items.slice(0, 100), total: items.length });
    });
    app.post('/api/messages/delete', async (req, res) => {
      if (kind(hostOf(req)).t !== 'app' || !isAuth(req)) return res.status(401).json({ error: 'auth' });
      const b = req.body || {}, s = String(b.site || ''), id = String(b.id || '');
      if (!ID.test(s) || !/^[a-z0-9]{1,40}$/.test(id)) return res.status(400).json({ error: 'bad' });
      if (!(await wasMine(req, s))) return res.status(403).json({ error: 'forbidden' });
      await store.del('msgs/' + s + '/' + id); res.json({ ok: true });
    });

    // --- vendas: pedidos registrados dos sites de venda (catálogo, cardápio, loja) + painel do cliente
    const COMM = ['catalog', 'ecommerce', 'menu'], STS = ['novo', 'confirmado', 'entregue', 'cancelado'];
    const num = (v, a, b, d) => { const n = Number(v); return Number.isFinite(n) ? Math.min(b, Math.max(a, n)) : d; };
    const saveSite = async (id, sd, j) => { await store.set('sites/' + id, { ...sd, j: JSON.stringify(j), at: Date.now() }); };
    app.all('/api/order', async (req, res) => {
      if (cors(req, res)) return;
      if (req.method !== 'POST') return res.status(405).json({ error: 'method' });
      try {
        if (limited('od:' + ipOf(req), 20, 3600e3)) return res.status(429).json({ error: 'rate' });
        const st = await siteOf(req), b = req.body || {};
        if (!st || !COMM.includes(st.j.goal)) return res.status(400).json({ error: 'bad' });
        if (limited('ods:' + st.id, 600, 86400e3)) return res.status(429).json({ error: 'rate' });
        const its = st.j.items || [], raw = Array.isArray(b.items) ? b.items.slice(0, 40) : [];
        if (!raw.length) return res.status(400).json({ error: 'bad' });
        const lines = []; let sub = 0;
        for (const r of raw) {
          const q = Math.floor(num(r.q, 1, 99, 0)); if (!q) return res.status(400).json({ error: 'bad' });
          const nm = clean(r.n, 80); let ix = Number.isInteger(r.i) ? r.i : -1;
          if (!its[ix] || clean(its[ix].n, 80) !== nm) ix = its.findIndex(x => clean(x.n, 80) === nm);
          if (ix < 0) return res.status(400).json({ error: 'item', m: nm });
          const it = its[ix];
          if (it.o) return res.status(409).json({ error: 'out', m: it.n });
          lines.push({ ix, n: clean(it.n, 80), v: clean(r.v, 40), q, p: Math.max(0, Number(it.p) || 0) });
        }
        // estoque: soma por produto; recusa se faltar
        const need = {}; lines.forEach(l => { need[l.ix] = (need[l.ix] || 0) + l.q; });
        for (const k of Object.keys(need)) { const it = its[k]; if (it.s !== '' && it.s != null && Number.isFinite(Number(it.s)) && need[k] > Number(it.s)) return res.status(409).json({ error: 'stock', m: it.n, left: Math.max(0, Number(it.s)) }); }
        sub = lines.reduce((t, l) => t + l.p * l.q, 0);
        const mode = b.mode === 'entrega' ? 'entrega' : 'retirada', cm = /^([A-Za-z0-9]{2,20}):(\d{1,2})$/.exec(String(st.j.coupon || '').trim());
        const d = cm && String(b.cup || '').trim().toUpperCase() === cm[1].toUpperCase() ? +cm[2] : 0;
        const fee = mode === 'entrega' && !st.j.nodeliv ? Math.max(0, Number(st.j.fee) || 0) : 0;
        if (Number(st.j.min) > 0 && sub < Number(st.j.min)) return res.status(409).json({ error: 'min', m: st.j.min });
        const total = Math.round((sub * (1 - d / 100) + fee) * 100) / 100;
        const ctr = (await store.get('sctr/' + st.id)) || { n: 0 }; ctr.n = (ctr.n || 0) + 1; await store.set('sctr/' + st.id, ctr);
        const o = { no: ctr.n, items: lines.map(l => ({ n: l.n, v: l.v, q: l.q, p: l.p })), sub: Math.round(sub * 100) / 100, d, fee, total, mode, name: clean(b.name, 80), tel: clean(b.tel, 30), addr: clean(b.addr, 200), pay: clean(b.pay, 30), obs: clean(b.obs, 300), st: 'novo', at: Date.now() };
        if (!o.name) return res.status(400).json({ error: 'bad' });
        const key = Date.now().toString(36) + rid();
        await store.set('sorders/' + st.id + '/' + key, o);
        // baixa de estoque
        const ks = Object.keys(need).filter(k => its[k].s !== '' && its[k].s != null && Number.isFinite(Number(its[k].s)));
        if (ks.length) {
          const sd = await store.get('sites/' + st.id);
          if (sd) { const j = JSON.parse(sd.j || '{}'); ks.forEach(k => { const it = (j.items || [])[k]; if (it) { it.s = Math.max(0, Number(it.s) - need[k]); if (it.s === 0) it.o = 1; } }); await saveSite(st.id, sd, j); }
        }
        const ow = st.owner !== 'admin' ? await store.get('users/' + st.owner) : null, to = ow ? ow.email : String(process.env.ADMIN_EMAIL || '').trim();
        if (to && X.mailOn()) X.sendMail({ to, ...X.mail.lead(st.name, { n: o.name, c: o.tel, m: 'Pedido #' + o.no + ' · ' + o.items.map(i => i.q + 'x ' + i.n).join(', ') + ' · Total R$ ' + o.total.toFixed(2).replace('.', ',') }, appUrl() + '/') }).catch(() => {});
        if (Math.random() < 0.03) store.trim('sorders/' + st.id + '/', 5000).catch(() => {});
        res.json({ ok: true, no: o.no, total: o.total });
      } catch (e) { console.error('order', e.message); res.status(500).json({ error: 'server' }); }
    });
    const commSites = async (req) => (await ownSites(req)).filter(x => COMM.includes(x.goal));
    app.get('/api/sales/sites', async (req, res) => {
      if (kind(hostOf(req)).t !== 'app' || !isAuth(req)) return res.status(401).json({ error: 'auth' });
      const mine = await commSites(req), out = [];
      for (const s of mine) {
        const os = (await store.list('sorders/' + s.id + '/', 2000, true)).map(r => r.data), t7 = Date.now() - 7 * DAY;
        out.push({ id: s.id, name: s.name, slug: s.slug, goal: s.goal, orders: os.length, novos: os.filter(o => o.st === 'novo').length, rev7: Math.round(os.filter(o => o.st !== 'cancelado' && o.at >= t7).reduce((t, o) => t + o.total, 0) * 100) / 100 });
      }
      res.json({ sites: out });
    });
    app.get('/api/sales', async (req, res) => {
      if (kind(hostOf(req)).t !== 'app' || !isAuth(req)) return res.status(401).json({ error: 'auth' });
      const id = String(req.query.site || ''); if (!ID.test(id)) return res.status(400).json({ error: 'bad' });
      if (!(await wasMine(req, id))) return res.status(403).json({ error: 'forbidden' });
      const sd = await store.get('sites/' + id); if (!sd) return res.status(404).json({ error: 'nf' });
      let j = {}; try { j = JSON.parse(sd.j || '{}'); } catch (e) { /* vazio */ }
      const orders = (await store.list('sorders/' + id + '/', 3000, true)).map(r => ({ id: r.path.split('/').pop(), ...r.data }));
      const products = (j.items || []).map((x, i) => ({ i, n: x.n, p: x.p, e: x.e, d: x.d || '', c: x.c || '', v: x.v || '', s: x.s === undefined ? '' : x.s, o: x.o ? 1 : 0, img: x.i ? 1 : 0 }));
      res.json({ site: { id, name: sd.name || j.name, goal: j.goal, fee: j.fee || 0, min: j.min || 0, coupon: j.coupon || '' }, orders, products });
    });
    app.post('/api/sales/status', async (req, res) => {
      if (kind(hostOf(req)).t !== 'app' || !isAuth(req)) return res.status(401).json({ error: 'auth' });
      const b = req.body || {}, id = String(b.site || ''), oid = String(b.id || '');
      if (!ID.test(id) || !/^[a-z0-9]{1,40}$/.test(oid) || !STS.includes(b.st)) return res.status(400).json({ error: 'bad' });
      if (!(await wasMine(req, id))) return res.status(403).json({ error: 'forbidden' });
      const o = await store.get('sorders/' + id + '/' + oid); if (!o) return res.status(404).json({ error: 'nf' });
      if (o.st === 'cancelado') return res.status(409).json({ error: 'cancelled' });
      if (b.st === 'cancelado') { // devolve o estoque dos produtos com estoque controlado
        const sd = await store.get('sites/' + id);
        if (sd) { const j = JSON.parse(sd.j || '{}'); let ch = false; o.items.forEach(l => { const it = (j.items || []).find(x => clean(x.n, 80) === l.n); if (it && it.s !== '' && it.s != null && Number.isFinite(Number(it.s))) { it.s = Number(it.s) + l.q; if (it.s > 0) delete it.o; ch = true; } }); if (ch) await saveSite(id, sd, j); }
      }
      o.st = b.st; o.up = Date.now(); await store.set('sorders/' + id + '/' + oid, o);
      res.json({ ok: true });
    });
    app.post('/api/sales/product', async (req, res) => {
      if (kind(hostOf(req)).t !== 'app' || !isAuth(req)) return res.status(401).json({ error: 'auth' });
      const b = req.body || {}, id = String(b.site || '');
      if (!ID.test(id)) return res.status(400).json({ error: 'bad' });
      if (!(await wasMine(req, id))) return res.status(403).json({ error: 'forbidden' });
      const sd = await store.get('sites/' + id); if (!sd) return res.status(404).json({ error: 'nf' });
      const j = JSON.parse(sd.j || '{}'); j.items = Array.isArray(j.items) ? j.items : [];
      const pick = (x) => { const o = {}; if ('n' in x) { o.n = clean(x.n, 80); if (!o.n) return null; } if ('p' in x) o.p = Math.round(num(x.p, 0, 1e6, 0) * 100) / 100; if ('e' in x) o.e = clean(x.e, 8) || '📦'; if ('d' in x) o.d = clean(x.d, 140); if ('c' in x) o.c = clean(x.c, 40); if ('v' in x) o.v = clean(x.v, 120); if ('s' in x) o.s = (x.s === '' || x.s == null) ? '' : Math.floor(num(x.s, 0, 99999, 0)); if ('o' in x) o.o = x.o ? 1 : 0; return o; };
      const i = Number(b.i);
      if (b.op === 'add') { if (j.items.length >= 60) return res.status(409).json({ error: 'limit' }); const o = pick({ n: b.item && b.item.n, p: 0, e: '📦', d: '', c: '', v: '', ...(b.item || {}) }); if (!o) return res.status(400).json({ error: 'name' }); j.items.push({ n: o.n, p: o.p, e: o.e, d: o.d, c: o.c, v: o.v, ...(o.s !== undefined && o.s !== '' ? { s: o.s } : {}), ...(o.o ? { o: 1 } : {}) }); }
      else if (b.op === 'del') { if (!Number.isInteger(i) || !j.items[i]) return res.status(400).json({ error: 'bad' }); j.items.splice(i, 1); }
      else if (b.op === 'move') { const k = i + (b.dir > 0 ? 1 : -1); if (!Number.isInteger(i) || !j.items[i] || !j.items[k]) return res.status(400).json({ error: 'bad' }); [j.items[i], j.items[k]] = [j.items[k], j.items[i]]; }
      else if (b.op === 'update') {
        if (!Number.isInteger(i) || !j.items[i]) return res.status(400).json({ error: 'bad' });
        const o = pick(b.patch || {}); if (!o) return res.status(400).json({ error: 'name' });
        Object.keys(o).forEach(k => { if ((k === 's' && o[k] === '') || (k === 'o' && !o[k])) delete j.items[i][k]; else j.items[i][k] = o[k]; });
        if ('s' in o && o.s === 0) j.items[i].o = 1;
      } else return res.status(400).json({ error: 'bad' });
      await saveSite(id, sd, j);
      await X.audit(req.u.id || 'admin', 'sales.product', id + ' ' + b.op);
      res.json({ ok: true, items: j.items.length });
    });

    // --- estatísticas por site
    app.get('/api/stats/site', async (req, res) => {
      if (kind(hostOf(req)).t !== 'app' || !isAuth(req)) return res.status(401).json({ error: 'auth' });
      const id = String(req.query.id || ''); if (!ID.test(id)) return res.status(400).json({ error: 'bad' });
      if (!(await wasMine(req, id))) return res.status(403).json({ error: 'forbidden' });
      const now = Date.now(), dayBR = (ts) => new Date(ts - 3 * 3600e3).toISOString().slice(0, 10), ser = {};
      for (let i = 29; i >= 0; i--) ser[dayBR(now - i * DAY)] = { d: dayBR(now - i * DAY), v: 0, c: 0 };
      const ev = (await store.list('events/', 3000, true)).map(x => x.data).filter(e => e && e.s === id);
      const u7 = new Set(), u30 = new Set(), links = {}, seen = {};
      ev.forEach(e => {
        const age = (now - (e.at || 0)) / DAY, k = e.t === 'view' ? 'v' : 'c', d = ser[dayBR(e.at || 0)]; if (d) d[k]++;
        if (e.t === 'view' && e.b) { if (age <= 30) u30.add(e.b); if (age <= 7) u7.add(e.b); if (age <= 30) seen[e.b] = (seen[e.b] || 0) + 1; }
        if (e.t === 'click' && age <= 30) { const l = e.l || 'WhatsApp'; links[l] = (links[l] || 0) + 1; }
      });
      res.json({ days: Object.values(ser), unique7: u7.size, unique30: u30.size, returning30: Object.values(seen).filter(n => n > 1).length, links: Object.entries(links).sort((a, b) => b[1] - a[1]).slice(0, 8).map(a => ({ l: a[0], c: a[1] })) });
    });

    // --- versões do site
    X.keepVersion = async (id, prev) => {
      if (!prev || !prev.j) return;
      await store.set('ver/' + id + '/' + Date.now().toString(36), { j: prev.j, name: prev.name || '', savedAt: prev.at || 0, at: Date.now() });
      await store.trim('ver/' + id + '/', 6).catch(() => {});
    };
    app.get('/api/versions', async (req, res) => {
      if (kind(hostOf(req)).t !== 'app' || !isAuth(req)) return res.status(401).json({ error: 'auth' });
      const id = String(req.query.site || ''); if (!ID.test(id)) return res.status(400).json({ error: 'bad' });
      if (!(await wasMine(req, id))) return res.status(403).json({ error: 'forbidden' });
      const rows = await store.list('ver/' + id + '/', 6, true);
      res.json({ items: rows.map(r => ({ v: r.path.split('/').pop(), at: r.data.savedAt || r.data.at, name: r.data.name, kb: Math.round((r.data.j || '').length / 1024) })) });
    });
    app.post('/api/versions/restore', async (req, res) => {
      if (kind(hostOf(req)).t !== 'app' || !isAuth(req)) return res.status(401).json({ error: 'auth' });
      const b = req.body || {}, id = String(b.site || ''), v = String(b.v || '');
      if (!ID.test(id) || !/^[a-z0-9]{1,20}$/.test(v)) return res.status(400).json({ error: 'bad' });
      if (!(await wasMine(req, id))) return res.status(403).json({ error: 'forbidden' });
      const ver = await store.get('ver/' + id + '/' + v), cur = await store.get('sites/' + id);
      if (!ver || !cur) return res.status(404).json({ error: 'not_found' });
      await X.keepVersion(id, cur);
      await store.set('sites/' + id, { ...cur, j: ver.j, name: ver.name || cur.name, at: Date.now() });
      await X.audit(who(req), 'site.restore', id);
      res.json({ ok: true });
    });

    // --- domínio próprio (planos pagos)
    const HOST = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,24}$/;
    const lookupOk = async (host) => {
      try { const cn = await dns.resolveCname(host); if (cn.some(x => x.toLowerCase().replace(/\.$/, '') === APP_HOST)) return true; } catch (e) { /* sem CNAME */ }
      try { const mine = await dns.resolve4(APP_HOST), his = await dns.resolve4(host); return his.some(ip => mine.includes(ip)); } catch (e) { return false; }
    };
    X.dnsCheck = lookupOk;
    app.get('/api/domains', async (req, res) => {
      if (kind(hostOf(req)).t !== 'app' || !isAuth(req)) return res.status(401).json({ error: 'auth' });
      const rows = (await store.list('domain/', 500, true)).filter(r => isAdmin(req) || (r.data && r.data.owner === req.u.id));
      res.json({ items: rows.map(r => ({ host: r.path.slice(7), ...r.data })), target: APP_HOST, mail: X.mailOn() });
    });
    app.post('/api/domain', async (req, res) => {
      if (kind(hostOf(req)).t !== 'app' || !isAuth(req)) return res.status(401).json({ error: 'auth' });
      if (!isAdmin(req) && !planOf(req.u.user).domain) return res.status(403).json({ error: 'Domínio próprio está disponível nos planos Pro e Premium.' });
      const b = req.body || {}, site = String(b.site || ''), host = String(b.domain || '').trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
      if (!ID.test(site) || !HOST.test(host) || host.length > 100) return res.status(400).json({ error: 'Informe um domínio válido, como meusite.com.br.' });
      if (host === APP_HOST || host === ROOT || host.endsWith('.' + ROOT)) return res.status(400).json({ error: 'Use um domínio seu, fora de ' + ROOT + '.' });
      if (!(await wasMine(req, site))) return res.status(403).json({ error: 'forbidden' });
      if (!isAdmin(req) && planOf(req.u.user).key === 'free') return res.status(403).json({ error: 'Domínio próprio está disponível nos planos pagos.' });
      const ex = await store.get('domain/' + host); if (ex && ex.site !== site) return res.status(409).json({ error: 'Esse domínio já está em uso.' });
      for (const r of await store.list('domain/', 500, true)) if (r.data && r.data.site === site && r.path !== 'domain/' + host) await store.del(r.path);
      const sd = await store.get('sites/' + site);
      await store.set('domain/' + host, { site, owner: sd.owner || 'admin', ok: false, at: Date.now() });
      await X.audit(who(req), 'domain.set', host); res.json({ ok: true, host, target: APP_HOST });
    });
    app.post('/api/domain/verify', async (req, res) => {
      if (kind(hostOf(req)).t !== 'app' || !isAuth(req)) return res.status(401).json({ error: 'auth' });
      if (limited('dv:' + ipOf(req), 30, 600e3)) return res.status(429).json({ error: 'rate' });
      const host = String((req.body || {}).domain || '').toLowerCase(), d = await store.get('domain/' + host);
      if (!d) return res.status(404).json({ error: 'not_found' });
      if (!isAdmin(req) && d.owner !== req.u.id) return res.status(403).json({ error: 'forbidden' });
      const ok = await lookupOk(host);
      if (ok) { d.ok = true; d.verifiedAt = Date.now(); await store.set('domain/' + host, d); await X.audit(who(req), 'domain.verify', host); }
      res.json({ ok, target: APP_HOST });
    });
    app.post('/api/domain/delete', async (req, res) => {
      if (kind(hostOf(req)).t !== 'app' || !isAuth(req)) return res.status(401).json({ error: 'auth' });
      const host = String((req.body || {}).domain || '').toLowerCase(), d = await store.get('domain/' + host);
      if (!d) return res.json({ ok: true });
      if (!isAdmin(req) && d.owner !== req.u.id) return res.status(403).json({ error: 'forbidden' });
      await store.del('domain/' + host); await X.audit(who(req), 'domain.delete', host); res.json({ ok: true });
    });

    // --- painel admin: auditoria, backups, jobs
    app.get('/api/admin/audit', async (req, res) => {
      if (!needAdmin(req, res)) return;
      res.json({ items: (await store.list('audit/', Math.min(300, +req.query.limit || 100), true)).map(r => r.data), mail: (await store.list('maillog/', 10, true)).map(r => r.data) });
    });
    app.get('/api/admin/backups', async (req, res) => {
      if (!needAdmin(req, res)) return;
      X.backupIfDue().catch(() => {});
      res.json({ items: (await store.list('backup/', 10, true)).map(r => ({ day: r.path.slice(7), at: r.data.at, size: r.data.size })), mail: X.mailOn() });
    });
    app.get('/api/admin/backups/download', async (req, res) => {
      if (!needAdmin(req, res)) return;
      const day = String(req.query.d || ''); if (!/^\d{4}-\d\d-\d\d$/.test(day)) return res.status(400).json({ error: 'bad' });
      const b = await store.get('backup/' + day); if (!b) return res.status(404).json({ error: 'not_found' });
      res.setHeader('Content-Disposition', 'attachment; filename="autopage-backup-' + day + '.json"'); res.type('json').send(b.json);
    });
    app.post('/api/admin/backups/run', async (req, res) => {
      if (!needAdmin(req, res)) return;
      res.json({ ok: true, ...(await X.backupNow('admin')) });
    });
    app.post('/api/admin/jobs', async (req, res) => {
      if (!needAdmin(req, res)) return;
      res.json({ ok: true, ...(await X.expiryJob(appUrl())) });
    });
  };

  let lastTick = 0;
  X.tick = async (appUrl) => { // chamado pelo /healthz: roda as rotinas no máximo a cada 6 h, mesmo com o servidor dormindo entre acessos
    if (Date.now() - lastTick < 6 * 3600e3) return;
    lastTick = Date.now();
    await X.expiryJob(appUrl()); await X.backupIfDue();
  };
  X.startJobs = (appUrl) => {
    const run = () => { X.expiryJob(appUrl()).catch(e => console.error('expiryJob', e.message)); X.backupIfDue().catch(e => console.error('backup', e.message)); };
    setTimeout(run, 90e3).unref(); setInterval(run, 6 * 3600e3).unref();
  };
  return X;
};
