// Operação da plataforma: "esqueci a senha" e confirmação de e-mail (clientes), Termos de Uso e Política de Privacidade (LGPD).
const crypto = require('crypto');

module.exports = function ops(c) {
  const { app, kind, hostOf, ipOf, limited, isAuth, isAdmin, pwHash, store, clean, esc, EMAIL, appUrl, X, ROOT } = c;
  const SEC = () => process.env.SESSION_SECRET || process.env.ADMIN_PASSWORD || 'dev-only-secret';
  const hm = (s) => crypto.createHmac('sha256', SEC()).update('ops:' + s).digest('base64url');
  const sign = (o) => { const b = Buffer.from(JSON.stringify(o)).toString('base64url'); return b + '.' + hm(b); };
  const unsign = (t, k) => { try { const [b, m] = String(t).split('.'); if (!b || !m) return null; const e = hm(b); if (e.length !== m.length || !crypto.timingSafeEqual(Buffer.from(e), Buffer.from(m))) return null; const o = JSON.parse(Buffer.from(b, 'base64url').toString()); return o && o.k === k && o.e > Date.now() ? o : null; } catch (e) { return null; } };
  const frag = (pw) => crypto.createHash('sha256').update(String(pw || '')).digest('hex').slice(0, 12);
  const app_ = (req) => kind(hostOf(req)).t === 'app';

  const shell = (title, body) => '<!doctype html><html lang=pt-BR><meta charset=utf-8><meta name=viewport content="width=device-width,initial-scale=1"><title>' + esc(title) + '</title><body style="margin:0;min-height:100vh;display:grid;place-items:center;background:#0b1020;color:#e8ecff;font:16px system-ui;padding:16px">' + body + '</body></html>';
  const card = 'width:min(360px,92vw);background:#141a33;padding:28px;border-radius:16px;display:grid;gap:12px';
  const inp = 'padding:12px;border-radius:10px;border:1px solid #2b3566;background:#0b1020;color:#fff;width:100%;box-sizing:border-box';
  const btnS = 'padding:12px;border:0;border-radius:10px;background:#4f46e5;color:#fff;font-weight:700;cursor:pointer';
  const lnk = 'color:#a5b4fc;text-align:center;font-size:14px';

  // ---------- e-mails
  X.opsMail = {
    reset: (u, url) => ({ subject: 'Redefinir sua senha · AutoPage.ai', html: X.wrap('Redefinir senha', '<p>Olá, ' + esc(clean(u.name, 60)) + '. Recebemos um pedido para redefinir a senha da sua conta. O link vale por <b>1 hora</b> e só pode ser usado uma vez.</p>' + X.btn(url, 'Criar nova senha') + '<p style="color:#6b7280;font-size:13px">Se não foi você, ignore este e-mail: sua senha continua a mesma.</p>') }),
    changed: (u) => ({ subject: 'Sua senha foi alterada · AutoPage.ai', html: X.wrap('Senha alterada', '<p>Olá, ' + esc(clean(u.name, 60)) + '. A senha da sua conta acabou de ser alterada. Se não foi você, redefina de novo agora e avise o suporte.</p>') }),
    verify: (u, url) => ({ subject: 'Confirme seu e-mail · AutoPage.ai', html: X.wrap('Confirme seu e-mail', '<p>Olá, ' + esc(clean(u.name, 60)) + '. Falta só confirmar que este e-mail é seu para publicar seus sites.</p>' + X.btn(url, 'Confirmar e-mail') + '<p style="color:#6b7280;font-size:13px">O link vale por 7 dias.</p>') })
  };
  X.verifyMail = async (u) => {
    if (!X.mailOn() || !u || !u.email) return;
    const t = sign({ k: 'v', u: u.id, e: Date.now() + 7 * 864e5 });
    await X.sendMail({ to: u.email, ...X.opsMail.verify(u, appUrl() + '/verificar?t=' + encodeURIComponent(t)) }).catch(() => {});
  };
  X.needVerify = (u) => !!u && u.ev === 0 && X.mailOn();

  // ---------- esqueci a senha (cliente)
  app.get('/esqueci', (req, res) => {
    if (!app_(req)) return res.status(404).end();
    res.type('html').send(shell('Esqueci a senha · AutoPage.ai', '<form id=f style="' + card + '"><h2 style="margin:0">🔑 Esqueci minha senha</h2><div style="color:#b7c0dc;font-size:14px">Informe o e-mail da sua conta. Se ele existir, enviamos um link para criar uma nova senha.</div><input id=e type=email placeholder="Seu e-mail" required style="' + inp + '"><div id=m style="min-height:20px;color:#b7c0dc;font-size:14px"></div><button style="' + btnS + '">Enviar link</button><a href=/ style="' + lnk + '">Voltar ao login</a></form><script>document.getElementById("f").onsubmit=async function(ev){ev.preventDefault();var m=document.getElementById("m");m.textContent="Enviando…";try{var r=await fetch("/api/forgot",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({email:e.value})}),j=await r.json();m.textContent=!r.ok?(j.error||"Erro"):(j.mail?"Se este e-mail tiver conta, o link já está a caminho. Confira também o spam.":"O envio de e-mails não está ativo neste servidor. Peça ao administrador para gerar uma nova senha.")}catch(x){m.textContent="Sem conexão. Tente de novo."}}</script>'));
  });
  app.post('/api/forgot', async (req, res) => {
    if (!app_(req)) return res.status(404).end();
    const email = String((req.body || {}).email || '').trim().toLowerCase().slice(0, 200);
    if (limited('fg:' + ipOf(req), 6, 3600e3)) return res.status(429).json({ error: 'Muitas tentativas. Tente mais tarde.' });
    if (!EMAIL.test(email)) return res.status(400).json({ error: 'Informe um e-mail válido.' });
    if (!X.mailOn()) return res.json({ ok: true, mail: 0 });
    if (!limited('fge:' + email, 3, 3600e3)) {
      const idx = await store.get('uemail/' + email), u = idx ? await store.get('users/' + idx.id) : null;
      if (u && u.status === 'active' && u.pw) {
        const t = sign({ k: 'r', u: u.id, x: frag(u.pw), e: Date.now() + 3600e3 });
        X.sendMail({ to: u.email, ...X.opsMail.reset(u, appUrl() + '/redefinir?t=' + encodeURIComponent(t)) }).catch(() => {});
        X.audit(email, 'senha.pedido', 'IP ' + ipOf(req)).catch(() => {});
      }
    }
    res.json({ ok: true, mail: 1 });
  });
  app.get('/redefinir', async (req, res) => {
    if (!app_(req)) return res.status(404).end();
    const t = String(req.query.t || ''), o = unsign(t, 'r'), u = o ? await store.get('users/' + o.u) : null;
    if (!u || frag(u.pw) !== o.x) return res.status(400).type('html').send(shell('Link inválido', '<div style="' + card + '"><h2 style="margin:0">Link inválido ou vencido</h2><div style="color:#b7c0dc">Peça um novo link em “Esqueci minha senha”.</div><a href=/esqueci style="' + lnk + '">Pedir novo link</a></div>'));
    res.type('html').send(shell('Nova senha · AutoPage.ai', '<form id=f style="' + card + '"><h2 style="margin:0">🔑 Criar nova senha</h2><input id=p type=password placeholder="Nova senha (8+ caracteres)" required minlength=8 maxlength=100 autocomplete=new-password style="' + inp + '"><input id=p2 type=password placeholder="Repita a senha" required minlength=8 maxlength=100 autocomplete=new-password style="' + inp + '"><div id=m style="min-height:20px;color:#fca5a5;font-size:14px"></div><button style="' + btnS + '">Salvar senha</button></form><script>var T=' + JSON.stringify(t).replace(/</g, '\\u003c') + ';document.getElementById("f").onsubmit=async function(ev){ev.preventDefault();var m=document.getElementById("m");if(p.value!==p2.value){m.textContent="As senhas não conferem.";return}m.textContent="Salvando…";try{var r=await fetch("/api/reset",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({t:T,password:p.value})}),j=await r.json();if(!r.ok)throw new Error(j.error||"Erro");document.getElementById("f").innerHTML="<h2 style=margin:0>✅ Senha alterada</h2><div style=color:#b7c0dc>Agora é só entrar com a nova senha.</div><a href=/ style=\\"color:#a5b4fc;text-align:center\\">Ir para o login</a>"}catch(x){m.style.color="#fca5a5";m.textContent=x.message}}</script>'));
  });
  app.post('/api/reset', async (req, res) => {
    if (!app_(req)) return res.status(404).end();
    if (limited('rs:' + ipOf(req), 20, 3600e3)) return res.status(429).json({ error: 'Muitas tentativas. Tente mais tarde.' });
    const b = req.body || {}, o = unsign(b.t, 'r'), pw = String(b.password || '');
    if (pw.length < 8 || pw.length > 100) return res.status(400).json({ error: 'A senha precisa ter de 8 a 100 caracteres.' });
    const u = o ? await store.get('users/' + o.u) : null;
    if (!u || u.status !== 'active' || frag(u.pw) !== o.x) return res.status(400).json({ error: 'Link inválido ou vencido. Peça um novo.' });
    u.pw = pwHash(pw); u.tmp = false; u.pwAt = Date.now();
    await store.set('users/' + u.id, u);
    X.audit(u.email, 'senha.redefinida', 'IP ' + ipOf(req)).catch(() => {});
    X.sendMail({ to: u.email, ...X.opsMail.changed(u) }).catch(() => {});
    res.json({ ok: true });
  });

  // ---------- confirmação de e-mail (cliente)
  app.get('/verificar', async (req, res) => {
    if (!app_(req)) return res.status(404).end();
    const o = unsign(req.query.t, 'v'), u = o ? await store.get('users/' + o.u) : null;
    if (!u) return res.status(400).type('html').send(shell('Link inválido', '<div style="' + card + '"><h2 style="margin:0">Link inválido ou vencido</h2><div style="color:#b7c0dc">Entre no painel e peça um novo e-mail de confirmação.</div><a href=/ style="' + lnk + '">Ir para o painel</a></div>'));
    if (u.ev === 0) { delete u.ev; u.evAt = Date.now(); await store.set('users/' + u.id, u); }
    res.type('html').send(shell('E-mail confirmado', '<div style="' + card + '"><h2 style="margin:0">✅ E-mail confirmado</h2><div style="color:#b7c0dc">Tudo certo! Você já pode publicar seus sites.</div><a href=/ style="' + lnk + '">Abrir meu painel</a></div>'));
  });
  app.post('/api/verify/resend', async (req, res) => {
    if (!isAuth(req) || isAdmin(req)) return res.status(401).json({ error: 'auth' });
    const u = req.u.user;
    if (u.ev !== 0) return res.json({ ok: true, done: 1 });
    if (!X.mailOn()) return res.status(503).json({ error: 'mail' });
    if (limited('vr:' + u.id, 3, 3600e3)) return res.status(429).json({ error: 'rate' });
    await X.verifyMail(u); res.json({ ok: true });
  });

  // ---------- Termos de Uso e Política de Privacidade
  const L = () => ({
    nome: clean(process.env.LEGAL_NAME || 'AutoPage.ai', 120),
    doc: clean(process.env.LEGAL_DOC || '', 40),
    mail: clean(process.env.LEGAL_EMAIL || process.env.ADMIN_EMAIL || ('contato@' + (ROOT || 'kattalo.online')), 120),
    site: (ROOT || 'kattalo.online')
  });
  const DATA = '06/11/2026';
  const doc = (title, body) => '<!doctype html><html lang=pt-BR><meta charset=utf-8><meta name=viewport content="width=device-width,initial-scale=1"><title>' + esc(title) + ' · AutoPage.ai</title><style>body{font:16px/1.7 system-ui,Arial;max-width:780px;margin:0 auto;padding:28px 18px 60px;color:#111827;background:#fff}h1{font-size:28px}h2{font-size:19px;margin-top:28px}a{color:#4f46e5}small{color:#6b7280}li{margin:4px 0}.nav{display:flex;gap:14px;font-size:14px;margin-bottom:18px}@media(prefers-color-scheme:dark){body{background:#0b1020;color:#e5e7f5}a{color:#a5b4fc}small{color:#9aa3c7}}</style><body><div class=nav><a href=/>← Início</a><a href=/termos>Termos de Uso</a><a href=/privacidade>Política de Privacidade</a></div><h1>' + esc(title) + '</h1><small>Última atualização: ' + DATA + '</small>' + body + '</body></html>';
  app.get('/termos', (req, res) => {
    const l = L(), n = esc(l.nome), m = esc(l.mail);
    res.type('html').send(doc('Termos de Uso', `
<p>Estes Termos regulam o uso da plataforma <b>AutoPage.ai</b> (“Plataforma”), operada por <b>${n}</b>${l.doc ? ' (documento ' + esc(l.doc) + ')' : ''}. Ao criar uma conta ou usar a Plataforma, você declara que leu e aceita estes Termos e a <a href="/privacidade">Política de Privacidade</a>.</p>
<h2>1. O que a Plataforma faz</h2><p>Gera e hospeda sites (landing page, catálogo, cardápio, loja com carrinho, agendamento e outros formatos) a partir de informações do seu negócio, com painel de vendas, integrações opcionais (Mercado Pago, Melhor Envio, Google, Meta) e recursos de inteligência artificial.</p>
<h2>2. Conta e segurança</h2><p>Você é responsável pelos dados informados, por manter sua senha em sigilo e por tudo que ocorre na sua conta. Avise-nos imediatamente se suspeitar de acesso indevido. Podemos exigir confirmação de e-mail para publicar sites.</p>
<h2>3. Planos, pagamento e cancelamento</h2><p>Há um plano gratuito com limites e planos pagos com mais sites e recursos, conforme a página de planos. O teste grátis, quando oferecido, tem a duração informada no cadastro. Ao fim do período pago, a conta volta ao plano gratuito e os sites publicados continuam no ar dentro dos limites do plano. Condições de reembolso seguem o Código de Defesa do Consumidor.</p>
<h2>4. Responsabilidade do lojista</h2><p>Se você vende pela Plataforma, <b>você é o fornecedor</b> perante seus compradores: responde por produtos, preços, estoque, prazos, entrega, trocas, garantias, notas fiscais, tributos e atendimento. A Plataforma é uma ferramenta tecnológica e não é parte das vendas entre você e seus compradores. Frete, prazos e valores cotados por terceiros (Correios, Melhor Envio) são estimativas.</p>
<h2>5. Uso aceitável</h2><p>É proibido usar a Plataforma para atividades ilegais, conteúdo ofensivo, discriminatório, enganoso ou que viole direitos de terceiros, venda de itens proibidos, golpes, envio de spam, tentativa de invadir, sobrecarregar ou copiar o sistema (inclusive extrair código, layouts e modelos). Podemos suspender ou remover sites e contas que violem estas regras.</p>
<h2>6. Seu conteúdo</h2><p>Textos, imagens e dados que você publica continuam sendo seus. Você nos autoriza a hospedá-los e exibi-los para operar o serviço. Você garante ter direito de usar o que envia (marcas, fotos, textos).</p>
<h2>7. Propriedade intelectual da Plataforma</h2><p>O software, os modelos de site, layouts, textos e marcas da Plataforma pertencem a ${n}. Você recebe uma licença limitada, não exclusiva e revogável para usar os sites gerados enquanto tiver conta ativa; não é permitido revender, copiar ou redistribuir os modelos ou o código da Plataforma.</p>
<h2>8. Inteligência artificial</h2><p>Parte do conteúdo é gerada ou sugerida por IA a partir dos seus dados. Pode conter erros: revise antes de publicar. Você é responsável pelo conteúdo final.</p>
<h2>9. Disponibilidade</h2><p>Trabalhamos para manter a Plataforma no ar, mas não garantimos funcionamento ininterrupto ou livre de falhas. Pode haver manutenção, instabilidade de terceiros ou indisponibilidade. Faça cópias dos seus dados importantes (a planilha de produtos pode ser exportada no painel).</p>
<h2>10. Limitação de responsabilidade</h2><p>Na máxima extensão permitida em lei, ${n} não responde por lucros cessantes, perda de vendas, falhas de terceiros (provedores de pagamento, frete, hospedagem, redes sociais, IA) ou por uso indevido da conta pelo usuário. Nada nestes Termos afasta direitos que a lei garanta ao consumidor.</p>
<h2>11. Alterações</h2><p>Podemos atualizar estes Termos. Mudanças relevantes serão avisadas no painel ou por e-mail; continuar usando a Plataforma após o aviso significa concordância.</p>
<h2>12. Lei e foro</h2><p>Estes Termos são regidos pelas leis do Brasil. Fica eleito o foro do domicílio do consumidor, quando aplicável, ou o da comarca da sede de ${n}, para dirimir dúvidas.</p>
<h2>13. Contato</h2><p>Dúvidas: <a href="mailto:${m}">${m}</a>.</p>`));
  });
  app.get('/privacidade', (req, res) => {
    const l = L(), n = esc(l.nome), m = esc(l.mail);
    res.type('html').send(doc('Política de Privacidade', `
<p>Esta Política explica como a <b>AutoPage.ai</b>, operada por <b>${n}</b>${l.doc ? ' (documento ' + esc(l.doc) + ')' : ''}, trata dados pessoais, em conformidade com a Lei Geral de Proteção de Dados (LGPD, Lei 13.709/2018).</p>
<h2>1. Papéis</h2><ul><li><b>Clientes da Plataforma</b> (quem cria sites): ${n} é a <b>controladora</b> dos dados da conta e do uso do painel.</li><li><b>Compradores e visitantes das lojas</b>: cada lojista é o <b>controlador</b> dos dados de seus compradores (pedidos, agendamentos); ${n} atua como <b>operadora</b>, tratando esses dados apenas para fornecer o serviço ao lojista. Dúvidas sobre uma compra devem ser dirigidas à loja.</li></ul>
<h2>2. Dados que tratamos</h2><ul><li><b>Conta do cliente:</b> nome, e-mail, senha (guardada somente em forma de hash), plano, registros de acesso e de uso.</li><li><b>Conteúdo do site:</b> textos, imagens, produtos, preços e dados de contato do negócio informados por você ou lidos de perfis públicos (Instagram/Facebook) mediante sua autorização.</li><li><b>Compradores:</b> nome, e-mail, telefone/WhatsApp, endereço de entrega, itens, valores, observações, histórico de pedidos e agendamentos; senha (hash) ou identificação da conta Google.</li><li><b>Pagamentos:</b> processados pelo Mercado Pago na conta do lojista; não armazenamos dados de cartão.</li><li><b>Técnicos:</b> endereço IP, navegador, datas e eventos de segurança; armazenamento local do navegador (token de login do comprador) e cookie de sessão do painel (essenciais ao funcionamento).</li></ul>
<h2>3. Finalidades e bases legais</h2><ul><li>Prestar o serviço, criar e hospedar sites, processar pedidos e agendamentos — execução de contrato (art. 7º, V).</li><li>Segurança, prevenção a fraudes e abusos, cumprimento de obrigações legais e defesa em processos — legítimo interesse e obrigação legal (art. 7º, II, IX; art. 11, II, g).</li><li>Comunicações do serviço (confirmação de e-mail, recuperação de senha, avisos de plano e de pedidos) — execução de contrato.</li><li>Leitura de dados de redes sociais e login com Google — consentimento (art. 7º, I), que você pode revogar.</li></ul>
<h2>4. Com quem compartilhamos</h2><p>Somente o necessário para operar: provedores de hospedagem e banco de dados, e-mail transacional, <b>Mercado Pago</b> (pagamentos), <b>Melhor Envio/Correios</b> (cotação de frete — CEP e peso), <b>Google</b> (login e inteligência artificial) e <b>Meta</b> (leitura de perfis autorizados). O lojista recebe os dados do comprador para atender o pedido. Não vendemos dados pessoais.</p>
<h2>5. Transferência internacional</h2><p>Alguns provedores operam fora do Brasil (por exemplo, nos Estados Unidos). Adotamos fornecedores com salvaguardas contratuais e de segurança adequadas, nos termos do art. 33 da LGPD.</p>
<h2>6. Retenção</h2><p>Mantemos os dados enquanto a conta existir e pelo tempo necessário para cumprir obrigações legais e exercer direitos. Ao excluir a conta ou a loja, os dados são removidos ou anonimizados, salvo guarda obrigatória por lei ou para defesa em processos.</p>
<h2>5. Segurança</h2><p>Usamos conexão criptografada (HTTPS), senhas com hash, tokens de integração criptografados, limites de tentativas, isolamento do conteúdo dos sites e registros de auditoria. Nenhum sistema é 100% seguro; em caso de incidente relevante, comunicaremos os titulares e a ANPD conforme a lei.</p>
<h2>8. Seus direitos (art. 18)</h2><p>Você pode pedir confirmação de tratamento, acesso, correção, anonimização, portabilidade, eliminação, informação sobre compartilhamento e revogação de consentimento. Compradores devem pedir primeiro à loja onde compraram; também atendemos pelo contato abaixo. Respondemos em prazo razoável, conforme a lei.</p>
<h2>9. Crianças e adolescentes</h2><p>A Plataforma não é destinada a menores de 18 anos sem representação legal e não coleta dados de crianças de forma intencional.</p>
<h2>10. Exclusão de dados e Meta</h2><p>Para excluir seus dados (inclusive os obtidos via Instagram/Facebook), escreva para <a href="mailto:${m}">${m}</a> com o e-mail da conta. Não publicamos nada nas suas redes e não guardamos o token de acesso da Meta após a leitura do perfil.</p>
<h2>11. Alterações</h2><p>Podemos atualizar esta Política; a versão vigente fica sempre nesta página, com a data acima.</p>
<h2>12. Contato / Encarregado (DPO)</h2><p><a href="mailto:${m}">${m}</a>.</p>`.replace('<h2>5. Segurança</h2>', '<h2>7. Segurança</h2>')));
  });
};
