'use strict';
// Painel admin: histórico de versões da plataforma (deploys no Render), voltar para uma versão
// anterior, publicar a última versão manualmente e ligar/desligar o deploy automático.
// Precisa de RENDER_API_KEY (chave criada no Render). RENDER_SERVICE_ID o próprio Render já define.
// Nada daqui é exposto a clientes: todas as rotas exigem administrador.
module.exports = function release({ app, needAdmin, X, limited, ipOf }) {
  const base = () => (process.env.RENDER_API_URL || 'https://api.render.com').replace(/\/$/, '');
  const cfg = () => ({ key: process.env.RENDER_API_KEY || '', sid: process.env.RENDER_SERVICE_ID || '' });
  const ready = () => { const c = cfg(); return !!(c.key && /^srv-[a-z0-9]+$/.test(c.sid)); };
  const who = (req) => (req.u && req.u.role === 'admin') ? 'admin' : 'admin';

  async function rf(path, { method = 'GET', body } = {}) {
    const c = cfg();
    const ctl = new AbortController(); const tm = setTimeout(() => ctl.abort(), 15000);
    try {
      const r = await fetch(base() + path, {
        method, signal: ctl.signal,
        headers: { Authorization: 'Bearer ' + c.key, Accept: 'application/json', ...(body ? { 'Content-Type': 'application/json' } : {}) },
        body: body ? JSON.stringify(body) : undefined
      });
      const t = await r.text(); let j = null; try { j = t ? JSON.parse(t) : null; } catch (e) { /* texto */ }
      return { s: r.status, j };
    } finally { clearTimeout(tm); }
  };
  const fail = (res, r, fallback) => {
    const code = r && r.s === 401 ? 'A chave do Render (RENDER_API_KEY) foi recusada.' : r && r.s === 404 ? 'Serviço ou versão não encontrado no Render.' : fallback;
    res.status(502).json({ error: code });
  };

  const DAY = /^\d{4}-\d\d-\d\d$/;
  // dia local de Brasília (UTC-3): 00:00 BRT = 03:00 UTC
  const startOf = (d) => d + 'T03:00:00Z';
  const endOf = (d) => new Date(Date.parse(d + 'T03:00:00Z') + 864e5).toISOString().replace(/\.\d+Z$/, 'Z');
  const clean = (s, n) => String(s == null ? '' : s).replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, n);

  const mapDeploy = (x) => {
    const d = x.deploy || x, c = d.commit || {};
    return { id: d.id, status: d.status, trigger: d.trigger || '', at: d.createdAt, end: d.finishedAt || '', commit: clean(c.id, 7), msg: clean(String(c.message || '').split('\n')[0], 140) };
  };

  app.get('/api/admin/release', async (req, res) => {
    if (!needAdmin(req, res)) return;
    if (!ready()) return res.json({ configured: false, items: [] });
    const q = req.query || {}, from = DAY.test(q.from || '') ? q.from : '', to = DAY.test(q.to || '') ? q.to : '';
    const qs = ['limit=100'].concat(from ? ['createdAfter=' + encodeURIComponent(startOf(from))] : [], to ? ['createdBefore=' + encodeURIComponent(endOf(to))] : []).join('&');
    try {
      const [dl, sv] = await Promise.all([rf('/v1/services/' + cfg().sid + '/deploys?' + qs), rf('/v1/services/' + cfg().sid)]);
      if (dl.s !== 200 || !Array.isArray(dl.j)) return fail(res, dl, 'Não consegui ler o histórico no Render.');
      const items = dl.j.map(mapDeploy).filter(x => x.id);
      const live = items.find(x => x.status === 'live');
      res.json({ configured: true, auto: sv.s === 200 && sv.j ? sv.j.autoDeploy === 'yes' : null, current: live ? live.id : '', items });
    } catch (e) { res.status(502).json({ error: 'Render não respondeu. Tente de novo.' }); }
  });

  const guard = (req, res) => {
    if (!needAdmin(req, res)) return false;
    if (!ready()) { res.status(503).json({ error: 'Configure RENDER_API_KEY no Render para usar esta função.' }); return false; }
    if (limited('rel:' + ipOf(req), 20, 3600e3)) { res.status(429).json({ error: 'Muitas ações seguidas. Aguarde um pouco.' }); return false; }
    if (!req.body || req.body.confirm !== true) { res.status(400).json({ error: 'Confirmação necessária.' }); return false; }
    return true;
  };

  app.post('/api/admin/release/auto', async (req, res) => {
    if (!guard(req, res)) return;
    const on = req.body.on === true;
    try {
      const r = await rf('/v1/services/' + cfg().sid, { method: 'PATCH', body: { autoDeploy: on ? 'yes' : 'no' } });
      if (r.s !== 200) return fail(res, r, 'O Render não aceitou a alteração.');
      await X.audit(who(req), on ? 'release.auto_on' : 'release.auto_off', 'deploy automático ' + (on ? 'ativado' : 'desativado'));
      res.json({ ok: true, auto: r.j && r.j.autoDeploy ? r.j.autoDeploy === 'yes' : on });
    } catch (e) { res.status(502).json({ error: 'Render não respondeu. Tente de novo.' }); }
  });

  app.post('/api/admin/release/deploy', async (req, res) => {
    if (!guard(req, res)) return;
    try {
      const r = await rf('/v1/services/' + cfg().sid + '/deploys', { method: 'POST', body: { clearCache: 'do_not_clear' } });
      if (r.s !== 200 && r.s !== 201 && r.s !== 202) return fail(res, r, 'O Render não iniciou a publicação.');
      await X.audit(who(req), 'release.deploy', 'publicação manual da última versão' + (r.j && r.j.id ? ' · ' + r.j.id : ''));
      res.json({ ok: true, id: r.j && r.j.id || '' });
    } catch (e) { res.status(502).json({ error: 'Render não respondeu. Tente de novo.' }); }
  });

  app.post('/api/admin/release/rollback', async (req, res) => {
    if (!guard(req, res)) return;
    const id = String(req.body.deployId || '');
    if (!/^dep-[a-z0-9]{6,40}$/.test(id)) return res.status(400).json({ error: 'Versão inválida.' });
    try {
      // só aceita versões que existem no histórico deste serviço e que já foram ao ar com sucesso
      const dl = await rf('/v1/services/' + cfg().sid + '/deploys?limit=100');
      const hit = dl.s === 200 && Array.isArray(dl.j) ? dl.j.map(mapDeploy).find(x => x.id === id) : null;
      if (!hit) return res.status(404).json({ error: 'Essa versão não está no histórico.' });
      if (hit.status !== 'deactivated' && hit.status !== 'live') return res.status(400).json({ error: 'Só dá para voltar para versões que já foram ao ar com sucesso.' });
      if (hit.status === 'live') return res.status(400).json({ error: 'Essa já é a versão no ar.' });
      try { await X.backupNow('antes de voltar versão'); } catch (e) { /* backup é extra */ }
      const r = await rf('/v1/services/' + cfg().sid + '/rollback', { method: 'POST', body: { deployId: id } });
      if (r.s !== 200 && r.s !== 201 && r.s !== 202) return fail(res, r, 'O Render não conseguiu voltar para essa versão.');
      await X.audit(who(req), 'release.rollback', (hit.commit || id) + ' · ' + (hit.msg || '').slice(0, 80));
      res.json({ ok: true });
    } catch (e) { res.status(502).json({ error: 'Render não respondeu. Tente de novo.' }); }
  });
};
