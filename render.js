// Renderização no servidor das páginas de vendas: roda o MESMO gerador do app (public/app.html) dentro de um escopo isolado,
// com um "document" de mentira. O resultado é HTML completo (SEO, prévia de link e carregamento rápido).
const dummy = () => { const f = function () {}; const p = new Proxy(f, { get: (t, k) => { if (k === Symbol.toPrimitive) return () => ''; if (k === 'then') return undefined; if (k === 'length') return 0; return p; }, apply: () => p, construct: () => p, set: () => true, has: () => true }); return p; };
let R = null;
function init(appHtml) {
  try {
    const m = [...String(appHtml).matchAll(/<script>([\s\S]*?)<\/script>/g)].map((x) => x[1]).sort((a, b) => b.length - a.length)[0];
    const store = { getItem: () => null, setItem() {}, removeItem() {} };
    const stubs = { document: dummy(), window: null, localStorage: store, sessionStorage: store, location: { hash: '', search: '' }, navigator: {}, matchMedia: () => ({ matches: false, addEventListener() {} }), setTimeout: () => 0, setInterval: () => 0, addEventListener() {}, fetch: () => Promise.reject(new Error('sem rede')) };
    const G = new Proxy({}, {
      has: (t, k) => typeof k === 'string' && k !== '__out' && k !== 'G' && k !== 'arguments',
      get: (t, k) => { if (k === Symbol.unscopables) return undefined; if (k in stubs) return k === 'window' ? G : stubs[k]; if (k in globalThis) return globalThis[k]; return dummy(); },
      set: () => true
    });
    const out = {};
    new Function('G', '__out', 'with(G){' + m + '\n;__out.R={siteHTML,sane};}')(G, out);
    R = out.R && typeof out.R.siteHTML === 'function' ? out.R : null;
  } catch (e) { console.error('render init:', e.message); R = null; }
  return !!R;
}
// devolve o HTML completo da página de vendas ou null (o servidor então cai no modo antigo, montado no navegador)
function sales(sj, host, hasOg) {
  if (!R || !sj || sj.goal !== 'sales') return null;
  try {
    let h = R.siteHTML(R.sane(sj), 0, 1);
    if (typeof h !== 'string' || h.length < 500) return null;
    const esc = (v) => String(v).replace(/[&<>"']/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
    const extra = '<meta property="og:type" content="website"><meta property="og:url" content="https://' + esc(host) + '/">' + (hasOg ? '<meta property="og:image" content="https://' + esc(host) + '/__og"><meta name="twitter:card" content="summary_large_image"><meta name="twitter:image" content="https://' + esc(host) + '/__og">' : '<meta name="twitter:card" content="summary">');
    return h.replace('</head>', () => extra + '</head>');
  } catch (e) { console.error('render sales:', e.message); return null; }
}
module.exports = { init, sales };
