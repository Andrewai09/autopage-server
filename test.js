// Testes de integração do servidor (sem dependências externas).
process.env.ROOT_DOMAIN='kattalo.online';process.env.ADMIN_PASSWORD='segredo123';process.env.SESSION_SECRET='x'.repeat(40);
process.env.DATA_FILE='/tmp/ap-test-data.json';process.env.PORT='3917';process.env.META_APP_ID='111';process.env.META_APP_SECRET='sec';process.env.ANTHROPIC_API_KEY='k';
require('fs').rmSync('/tmp/ap-test-data.json',{force:true});
const {main}=require('./server');
let pass=0,fail=0;const ok=(n,c,x)=>{c?pass++:fail++;console.log((c?'PASS ':'FAIL ')+n+(c?'':' -> '+x))};
const B='http://127.0.0.1:3917';
const http=require('http');
const rq=(path,{host='app.kattalo.online',method='GET',body,cookie,raw,ct}={})=>new Promise((ok,no)=>{const h={host};if(cookie)h.cookie=cookie;let b;if(raw){b=raw;h['content-type']='application/x-www-form-urlencoded'}else if(body){b=JSON.stringify(body);h['content-type']=ct||'application/json'}
 if(b)h['content-length']=Buffer.byteLength(b);const q=http.request({host:'127.0.0.1',port:3917,path,method,headers:h},res=>{let t='';res.on('data',c=>t+=c);res.on('end',()=>{let j=null;try{j=JSON.parse(t)}catch(e){}ok({s:res.statusCode,t,j,h:{get:k=>{const v=res.headers[k.toLowerCase()];return Array.isArray(v)?v[0]:v}}})})});q.on('error',no);if(b)q.write(b);q.end()});
(async()=>{
 const {srv,store}=await main();
 const realFetch=global.fetch;
 // login
 let r=await rq('/');ok('app sem login mostra tela de login',r.s===200&&r.t.includes('type=password')&&!r.t.includes('claude.use'),r.s);
 r=await rq('/login',{method:'POST',raw:'password=errada'});ok('senha errada 401',r.s===401);
 r=await rq('/login',{method:'POST',raw:'password=segredo123'});const ck=(r.h.get('set-cookie')||'').split(';')[0];ok('login ok redireciona + cookie HttpOnly',r.s===302&&ck.startsWith('ap_s=')&&/HttpOnly/.test(r.h.get('set-cookie')),r.s);
 r=await rq('/',{cookie:ck});ok('app logado entrega editor com shim',r.s===200&&r.t.includes('window.__ROOT')&&r.t.includes('metaConnect')&&r.t.includes('sample.json'),r.t.slice(0,80));
 r=await rq('/',{cookie:ck+'x'});ok('cookie adulterado volta ao login',r.t.includes('type=password'));
 // api exige auth
 r=await rq('/api/db',{method:'POST',body:{op:'set',path:'sites/abc',data:{j:'{}'}}});ok('set sem login 401',r.s===401);
 r=await rq('/api/ai',{method:'POST',body:{prompt:'x'}});ok('ia sem login 401',r.s===401);
 // publicar
 const site={id:'abc123',name:'Pizzaria do Zé',color:'#ef4444',items:[{n:'Margherita',p:50,e:'🍕'}]};
 r=await rq('/api/db',{method:'POST',cookie:ck,body:{op:'set',path:'sites/abc123',data:{j:JSON.stringify(site),name:site.name,at:1}}});ok('publicar devolve slug',r.j&&r.j.slug==='pizzaria-do-ze',JSON.stringify(r.j));
 r=await rq('/api/db',{method:'POST',cookie:ck,body:{op:'set',path:'sites/def456',data:{j:JSON.stringify({...site,id:'def456'}),name:site.name}}});ok('slug duplicado vira -2',r.j&&r.j.slug==='pizzaria-do-ze-2',JSON.stringify(r.j));
 r=await rq('/api/db',{method:'POST',cookie:ck,body:{op:'set',path:'sites/abc123',data:{j:JSON.stringify(site),name:site.name}}});ok('republicar mantém slug',r.j.slug==='pizzaria-do-ze');
 r=await rq('/api/db',{method:'POST',cookie:ck,body:{op:'set',path:'sites/../etc',data:{j:'{}'}}});ok('path inválido rejeitado',r.s===400);
 r=await rq('/api/db',{method:'POST',cookie:ck,body:{op:'set',path:'sites/zzz',data:{j:'não é json'}}});ok('json inválido rejeitado',r.s===400);
 // redirecionamento (Link na bio)
 r=await rq('/api/db',{method:'POST',cookie:ck,body:{op:'set',path:'sites/lnk001',data:{j:JSON.stringify({id:'lnk001',name:'Ana Links',goal:'links',redir:1,links:[{t:'Insta',u:'https://instagram.com/ana'}]}),name:'Ana Links'}}});
 r=await rq('/',{host:'ana-links.kattalo.online'});ok('link na bio redireciona (302)',r.s===302&&r.h.get('location')==='https://instagram.com/ana',r.s+' '+r.h.get('location'));
 r=await rq('/?nr=1',{host:'ana-links.kattalo.online'});ok('?nr=1 mostra a página sem redirecionar',r.s===200,r.s);
 r=await rq('/api/db',{method:'POST',cookie:ck,body:{op:'set',path:'sites/lnk002',data:{j:JSON.stringify({id:'lnk002',name:'Bad Redir',goal:'links',redir:1,links:[{t:'x',u:'javascript:alert(1)'}]}),name:'Bad Redir'}}});
 r=await rq('/',{host:'bad-redir.kattalo.online'});ok('redirect só para https (javascript: ignorado)',r.s===200,r.s);
 // agendamento com reserva
 const dtf=new Date(Date.now()-3*3600e3+3*864e5);while([0,6].includes(dtf.getUTCDay()))dtf.setUTCDate(dtf.getUTCDate()+1);const D=dtf.toISOString().slice(0,10);
 r=await rq('/api/db',{method:'POST',cookie:ck,body:{op:'set',path:'sites/bk0001',data:{j:JSON.stringify({id:'bk0001',name:'Studio Lara',goal:'booking',days:'semana',open:'09:00',close:'12:00',nolog:1}),name:'Studio Lara'}}});
 const bh='studio-lara.kattalo.online';
 r=await rq('/api/book',{host:bh,method:'POST',body:{d:D,t:'09:30',n:'Maria',s:'Esmaltação'},ct:'text/plain'});ok('agendar horário livre 200',r.s===200,r.s+' '+r.t);
 r=await rq('/api/book',{host:bh,method:'POST',body:{d:D,t:'09:30',n:'João'},ct:'text/plain'});ok('mesmo horário 409',r.s===409,r.s);
 r=await rq('/api/slots?d='+D,{host:bh});ok('slots mostra horário ocupado',r.s===200&&JSON.parse(r.t).taken.includes('09:30'),r.t);
 r=await rq('/api/book',{host:bh,method:'POST',body:{d:D,t:'11:45',n:'X'},ct:'text/plain'});ok('horário fora da grade 400',r.s===400,r.s);
 r=await rq('/api/book',{host:bh,method:'POST',body:{d:D,t:'12:00',n:'X'},ct:'text/plain'});ok('depois do fechamento 400',r.s===400,r.s);
 r=await rq('/api/book',{host:bh,method:'POST',body:{d:'2020-01-06',t:'10:00',n:'X'},ct:'text/plain'});ok('data passada 400',r.s===400,r.s);
 r=await rq('/api/db',{method:'POST',cookie:ck,body:{op:'set',path:'sites/bk0002',data:{j:JSON.stringify({id:'bk0002',name:'Studio Login',goal:'booking',days:'todos',open:'09:00',close:'12:00'}),name:'Studio Login'}}});const bh2=(r.j&&r.j.slug||'studio-login')+'.kattalo.online';r=await rq('/api/book',{host:bh2,method:'POST',body:{d:D,t:'09:00',n:'Ana'},ct:'text/plain'});ok('agendamento exige login do comprador por padrão',r.s===401,r.t);
 r=await rq('/api/bookings?site=bk0001',{});ok('lista de agendamentos exige login',r.s===401,r.s);
 r=await rq('/api/bookings?site=bk0001',{cookie:ck});ok('admin lista agendamentos',r.s===200&&JSON.parse(r.t).items.some(x=>x.t==='09:30'&&x.n==='Maria'),r.t);
 r=await rq('/api/bookings/cancel',{method:'POST',cookie:ck,body:{site:'bk0001',d:D,t:'09:30'}});r=await rq('/api/book',{host:bh,method:'POST',body:{d:D,t:'09:30',n:'Ana'},ct:'text/plain'});ok('cancelar libera o horário',r.s===200,r.s);
 // ---- usuários: admin e cliente
 r=await rq('/api/admin/clients',{method:'POST',body:{name:'Maria',email:'maria@ex.com',plan:'free'}});ok('criar cliente sem login 401',r.s===401,r.s);
 r=await rq('/api/admin/clients',{method:'POST',cookie:ck,body:{name:'Maria Silva',email:'maria@ex.com',plan:'free'}});const cpw=r.j&&r.j.password,cid=r.j&&r.j.user&&r.j.user.id;ok('admin cria cliente com senha gerada',r.s===200&&cpw&&cpw.length>=10&&cid,r.t);
 r=await rq('/api/admin/clients',{method:'POST',cookie:ck,body:{name:'Outra',email:'MARIA@ex.com'}});ok('e-mail duplicado 409',r.s===409,r.s);
 r=await rq('/login',{method:'POST',raw:'email=maria%40ex.com&password=errada123'});ok('cliente senha errada 401',r.s===401,r.s);
 r=await rq('/login',{method:'POST',raw:'email=maria%40ex.com&password='+encodeURIComponent(cpw)});const ck2=(r.h.get('set-cookie')||'').split(';')[0];ok('cliente loga com a senha gerada',r.s===302&&ck2.startsWith('ap_s='),r.s);
 r=await rq('/api/me',{cookie:ck2});ok('/api/me do cliente',r.s===200&&r.j.role==='client'&&r.j.plan.maxSites===1&&r.j.tmp===true,r.t);
 r=await rq('/api/admin/overview',{cookie:ck2});ok('cliente não acessa painel admin',r.s===401,r.s);
 r=await rq('/api/db',{method:'POST',cookie:ck2,body:{op:'set',path:'sites/fmt001',data:{j:JSON.stringify({name:'Loja',goal:'ecommerce',items:[]}),name:'Loja'}}});ok('plano Básico grátis bloqueia formato pago (loja)',r.s===403&&r.j.error==='format',r.t);
 r=await rq('/api/db',{method:'POST',cookie:ck2,body:{op:'set',path:'sites/vend02',data:{j:JSON.stringify({name:'Curso',goal:'sales'}),name:'Curso'}}});ok('plano grátis não publica página de vendas',r.s===403&&r.j.error==='format',r.t);
 r=await rq('/api/me',{cookie:ck2});ok('/api/me lista os formatos do plano grátis',Array.isArray(r.j.plan.fmts)&&r.j.plan.fmts.includes('landing')&&!r.j.plan.fmts.includes('ecommerce'),r.t);
 r=await rq('/api/domain',{method:'POST',cookie:ck2,body:{site:'fmt001',domain:'meusite.com.br'}});ok('domínio próprio bloqueado fora do Pro/Premium',r.s===403&&/Pro/.test(r.j.error||''),r.t);
 r=await rq('/api/me',{cookie:ck2});ok('/api/me traz recursos do plano',r.j.plan.domain===false&&r.j.plan.feat.length>0,r.t);
 r=await rq('/api/integrations',{cookie:ck2});ok('plano grátis não acessa integrações',r.s===200&&r.j.allowed===false,r.t);
 r=await rq('/api/integrations/mp',{method:'POST',cookie:ck2,body:{token:'APP_USR-xxxxxxxxxxxxxxxxxxxxxxxx'}});ok('conectar Mercado Pago bloqueado fora do Pro',r.s===403,r.t);
 r=await rq('/api/integrations',{});ok('integrações sem login 401',r.s===401,r.s);
 r=await rq('/api/ship/quote',{method:'POST',body:{cep:'01001000',items:[{n:'x',q:1}]},host:'pizzaria-do-ze.kattalo.online'});ok('cotação de frete recusada se o site não ativou',r.s===400,r.t);
 r=await rq('/api/buyer/caps',{host:'pizzaria-do-ze.kattalo.online'});ok('caps de login do comprador responde',r.s===200&&typeof r.j.login==='number',r.t);
 r=await rq('/api/buyer/register',{method:'POST',body:{name:'Ana',email:'ana@ex.com',password:'123'},host:'pizzaria-do-ze.kattalo.online'});ok('cadastro de comprador recusa senha curta',r.s===400,r.t);
 r=await rq('/api/buyer/login',{method:'POST',body:{email:'nao@ex.com',password:'qualquer123'},host:'pizzaria-do-ze.kattalo.online'});ok('login de comprador inexistente 401',r.s===401,r.t);
 r=await rq('/api/buyer/me',{method:'POST',body:{bt:'abc.def'},host:'pizzaria-do-ze.kattalo.online'});ok('token de comprador inválido 401',r.s===401,r.t);
 r=await rq('/auth/google/start?site=abc123');ok('Google desligado sem credenciais (404)',r.s===404,r.s);
 r=await rq('/api/admin/clients',{method:'POST',cookie:ck2,body:{name:'x',email:'x@x.com'}});ok('cliente não cria clientes',r.s===401,r.s);
 r=await rq('/api/db',{method:'POST',cookie:ck2,body:{op:'set',path:'sites/cli001',data:{j:JSON.stringify({id:'cli001',name:'Loja da Maria',goal:'landing'}),name:'Loja da Maria'}}});ok('cliente publica o 1º site',r.s===200&&r.j.slug==='loja-da-maria',r.t);
 r=await rq('/api/db',{method:'POST',cookie:ck2,body:{op:'set',path:'sites/cli002',data:{j:JSON.stringify({id:'cli002',name:'Segundo',goal:'landing'}),name:'Segundo'}}});ok('plano gratuito limita a 1 site (403)',r.s===403&&r.j.error==='limit',r.t);
 r=await rq('/api/db',{method:'POST',cookie:ck2,body:{op:'set',path:'sites/abc123',data:{j:JSON.stringify({id:'abc123',name:'Invadido'}),name:'Invadido'}}});ok('cliente não sobrescreve site de outro (403)',r.s===403,r.s);
 r=await rq('/api/db',{method:'POST',cookie:ck2,body:{op:'delete',path:'sites/abc123'}});ok('cliente não apaga site de outro (403)',r.s===403,r.s);
 r=await rq('/api/stats',{cookie:ck2});ok('stats do cliente só com os próprios sites',r.s===200&&r.j.sites.length===1&&r.j.sites[0].id==='cli001',r.t.slice(0,200));
 r=await rq('/api/stats',{cookie:ck});ok('stats do admin vê todos',r.s===200&&r.j.sites.length>=2,r.s);
 r=await rq('/api/admin/overview',{cookie:ck});ok('overview do admin traz clientes e KPIs',r.s===200&&r.j.clients.some(c=>c.email==='maria@ex.com'&&c.sites===1)&&r.j.kpi.clients>=1,r.t.slice(0,200));
 r=await rq('/api/bookings?site=bk0001',{cookie:ck2});ok('cliente não vê agendamentos de site alheio',r.s===403,r.s);
 r=await rq('/api/account',{method:'POST',cookie:ck2,body:{oldPassword:cpw,newPassword:'curta'}});ok('senha nova curta rejeitada',r.s===400,r.s);
 r=await rq('/api/account',{method:'POST',cookie:ck2,body:{oldPassword:cpw,newPassword:'NovaSenha123'}});ok('cliente troca a senha',r.s===200,r.t);
 r=await rq('/login',{method:'POST',raw:'email=maria%40ex.com&password=NovaSenha123'});ok('login com a nova senha',r.s===302,r.s);
 r=await rq('/api/admin/clients/update',{method:'POST',cookie:ck,body:{id:cid,status:'blocked'}});r=await rq('/api/me',{cookie:ck2});ok('cliente bloqueado perde a sessão',r.s===401,r.s);
 r=await rq('/login',{method:'POST',raw:'email=maria%40ex.com&password=NovaSenha123'});ok('cliente bloqueado não loga (403)',r.s===403,r.s);
 r=await rq('/api/admin/clients/update',{method:'POST',cookie:ck,body:{id:cid,status:'active',plan:'pro',resetPassword:true}});const pw2=r.j&&r.j.password;ok('admin reativa, muda plano e reseta senha',r.s===200&&pw2&&r.j.user.plan.key==='pro',r.t);
 r=await rq('/api/admin/clients/delete',{method:'POST',cookie:ck,body:{id:cid}});r=await rq('/',{host:'loja-da-maria.kattalo.online'});ok('excluir cliente remove seus sites',r.s===404,r.s);
 r=await rq('/login',{method:'POST',raw:'email=maria%40ex.com&password='+encodeURIComponent(pw2)});ok('cliente excluído não loga',r.s===401,r.s);
 // ---- vendas (Mercado Pago mock)
 process.env.MP_ACCESS_TOKEN='TESTTOKEN';process.env.MP_URL='https://mp.test';const _ff=global.fetch;let lastPref=null,payAmt=null;
 global.fetch=async(u,o)=>{u=String(u);if(u==='https://mp.test/checkout/preferences'){lastPref=JSON.parse(o.body);return{ok:true,status:201,json:async()=>({id:'pref1',init_point:'https://mp.test/pay/abc'})}}
  const m=/^https:\/\/mp\.test\/v1\/payments\/(\d+)$/.exec(u);if(m){return{ok:true,status:200,json:async()=>({status:m[1]==='999'?'pending':'approved',external_reference:lastPref&&lastPref.external_reference,transaction_amount:payAmt})}}return _ff(u,o)};
 r=await rq('/planos');ok('/planos sem preços mostra vendas fechadas',r.s===200&&r.t.includes('Vendas ainda não'),r.s);
 r=await rq('/api/admin/config',{method:'POST',cookie:ck,body:{prices:{basic:49.9,pro:99,free:10}}});ok('admin define preços (free ignora?)',r.s===200&&r.j.prices.basic===49.9&&r.j.prices.pro===99&&r.j.prices.free===10,r.t);
 r=await rq('/api/admin/config',{method:'POST',body:{prices:{basic:1}}});ok('config de preços exige admin',r.s===401,r.s);
 r=await rq('/planos');ok('/planos mostra os planos com preço',r.t.includes('R$ 49,90')&&r.t.includes('R$ 99,00')&&r.t.includes('Pagar com Mercado Pago'),r.s);
 r=await rq('/api/checkout',{method:'POST',body:{plan:'premium',name:'João',email:'joao@ex.com'}});ok('plano sem preço rejeitado',r.s===400,r.s);
 r=await rq('/api/checkout',{method:'POST',body:{plan:'basic',name:'João Souza',email:'joao@ex.com'}});ok('checkout cria preferência e devolve a URL',r.s===200&&r.j.url==='https://mp.test/pay/abc'&&lastPref.items[0].unit_price===49.9&&lastPref.payer.email==='joao@ex.com'&&/^[a-f0-9]{16}$/.test(lastPref.external_reference),r.t);
 const oid=lastPref.external_reference,tok=new URL(lastPref.back_urls.success).searchParams.get('t');
 r=await rq('/api/order?o='+oid+'&t='+encodeURIComponent(tok));ok('pedido pendente',r.s===200&&r.j.status==='pending',r.t);
 r=await rq('/api/order?o='+oid+'&t=falso');ok('token inválido 404',r.s===404,r.s);
 payAmt=10;r=await rq('/mp/webhook?type=payment&data.id=123',{method:'POST'});r=await rq('/api/order?o='+oid+'&t='+encodeURIComponent(tok));ok('valor pago menor não libera',r.j.status==='pending',r.t);
 r=await rq('/mp/webhook?type=payment&data.id=999',{method:'POST'});r=await rq('/api/order?o='+oid+'&t='+encodeURIComponent(tok));ok('pagamento pendente não libera',r.j.status==='pending',r.t);
 payAmt=49.9;r=await rq('/mp/webhook',{method:'POST',body:{type:'payment',data:{id:'123'}}});r=await rq('/api/order?o='+oid+'&t='+encodeURIComponent(tok));ok('pagamento aprovado libera o pedido e pede a senha',r.j.status==='paid'&&r.j.needPw===true,r.t);
 r=await rq('/mp/webhook?type=payment&data.id=123',{method:'POST'});r=await rq('/api/admin/overview',{cookie:ck});const jc=r.j.clients.find(c=>c.email==='joao@ex.com');ok('webhook repetido não duplica; cliente criado no plano Básico com validade',jc&&r.j.clients.filter(c=>c.email==='joao@ex.com').length===1&&jc.plan.key==='basic'&&jc.plan.until>Date.now()+29*864e5&&r.j.sales.count30===1&&r.j.sales.rev30===49.9,JSON.stringify(jc)+JSON.stringify(r.j.sales));
 r=await rq('/login',{method:'POST',raw:'email=joao%40ex.com&password=qualquercoisa'});ok('antes de criar a senha não entra',r.s===401,r.s);
 r=await rq('/api/order/setpw',{method:'POST',body:{o:oid,t:tok,password:'curta'}});ok('senha curta recusada',r.s===400,r.s);
 r=await rq('/api/order/setpw',{method:'POST',body:{o:oid,t:'x',password:'SenhaBoa123'}});ok('setpw com token falso recusado',r.s===404,r.s);
 r=await rq('/api/order/setpw',{method:'POST',body:{o:oid,t:tok,password:'SenhaBoa123'}});const ck3=(r.h.get('set-cookie')||'').split(';')[0];ok('comprador cria a senha e já entra',r.s===200&&ck3.startsWith('ap_s='),r.t);
 r=await rq('/api/order/setpw',{method:'POST',body:{o:oid,t:tok,password:'OutraSenha123'}});ok('não dá para redefinir a senha pelo mesmo pedido',r.s===400,r.s);
 r=await rq('/api/me',{cookie:ck3});ok('/api/me do comprador: plano Essencial com 5 sites',r.j.plan.key==='basic'&&r.j.plan.maxSites===5&&r.j.canBuy===true,r.t);
 r=await rq('/api/checkout',{method:'POST',body:{plan:'pro',name:'J',email:'joao@ex.com'}});ok('e-mail já cliente exige login para renovar',r.s===409,r.s);
 r=await rq('/api/checkout',{method:'POST',cookie:ck3,body:{plan:'pro'}});ok('cliente logado compra upgrade',r.s===200&&lastPref.payer.email==='joao@ex.com',r.t);
 payAmt=99;r=await rq('/mp/webhook?type=payment&data.id=124',{method:'POST'});r=await rq('/api/me',{cookie:ck3});ok('upgrade aplica o plano Pro',r.j.plan.key==='pro'&&r.j.plan.maxSites===10&&r.j.plan.until>Date.now()+59*864e5,r.t);
 global.fetch=_ff;
 r=await rq('/api/admin/export',{});ok('backup exige admin',r.s===401,r.s);
 r=await rq('/api/admin/export',{cookie:ck});ok('backup do admin sem hashes de senha',r.s===200&&r.j.users.length>0&&!r.t.includes('"pw"')&&Array.isArray(r.j.sites),r.s);
 process.env.ADMIN_EMAIL='dono@ex.com';
 r=await rq('/login',{method:'POST',raw:'password=segredo123'});ok('com ADMIN_EMAIL definido, e-mail em branco não entra',r.s===401,r.s);
 r=await rq('/login',{method:'POST',raw:'email=outro%40ex.com&password=segredo123'});ok('com ADMIN_EMAIL, e-mail errado não entra',r.s===401,r.s);
 r=await rq('/login',{method:'POST',raw:'email=DONO%40ex.com&password=segredo123'});ok('admin entra com e-mail e senha corretos',r.s===302,r.s);
 delete process.env.ADMIN_EMAIL;
 // site por subdomínio
 r=await rq('/',{host:'pizzaria-do-ze.kattalo.online'});ok('subdomínio serve o site sem login',r.s===200&&r.t.includes('window.__SITE_ID="abc123"')&&!r.t.includes('name=password'),r.s);
 r=await rq('/',{host:'inexistente.kattalo.online'});ok('subdomínio inexistente 404',r.s===404);
 r=await rq('/',{host:'mail.kattalo.online'});ok('subdomínio reservado 404',r.s===404);
 r=await rq('/',{host:'localhost'});ok('localhost abre o app',r.t.includes('type=password'));
 // leitura pública só de sites
 r=await rq('/api/db',{host:'pizzaria-do-ze.kattalo.online',method:'POST',body:{op:'get',path:'sites/abc123'}});ok('visitante lê o site',r.j&&r.j.exists&&JSON.parse(r.j.data.j).name==='Pizzaria do Zé');
 r=await rq('/api/db',{host:'pizzaria-do-ze.kattalo.online',method:'POST',body:{op:'get',path:'events/x'}});ok('visitante não lê events',r.s===403);
 r=await rq('/api/db',{host:'pizzaria-do-ze.kattalo.online',method:'POST',body:{op:'list',coll:'events'}});ok('visitante não lista events',r.s===401);
 // eventos
 r=await rq('/api/db',{host:'pizzaria-do-ze.kattalo.online',method:'POST',body:{op:'add',coll:'events',data:{s:'abc123',t:'view',b:'b1'}}});ok('visitante registra view',r.s===200&&r.j.id);
 r=await rq('/api/db',{host:'x.kattalo.online',method:'POST',body:{op:'add',coll:'events',data:{s:'nao-existe',t:'view'}}});ok('evento de site inexistente rejeitado',r.s===400);
 r=await rq('/api/db',{host:'x.kattalo.online',method:'POST',body:{op:'add',coll:'events',data:{s:'abc123',t:'hack'}}});ok('tipo de evento inválido rejeitado',r.s===400);
 await rq('/api/db',{method:'POST',body:{op:'add',coll:'events',data:{s:'abc123',t:'click',b:'b1'}}});
 r=await rq('/api/db',{method:'POST',cookie:ck,body:{op:'list',coll:'events',limit:100}});ok('admin lista eventos',r.j&&r.j.docs.filter(d=>d.data.s==='abc123').length===2,JSON.stringify(r.j));
 // cookie de admin não vale em subdomínio? (cookie host-only: simula navegador não enviando) -> sem cookie = 401
 r=await rq('/api/db',{host:'pizzaria-do-ze.kattalo.online',method:'POST',body:{op:'delete',path:'sites/abc123'}});ok('delete sem cookie no subdomínio 401',r.s===401);
 // rate limit eventos
 let last=0;for(let i=0;i<130;i++){const x=await rq('/api/db',{method:'POST',body:{op:'add',coll:'events',data:{s:'abc123',t:'view'}}});last=x.s}ok('rate limit de eventos (429)',last===429,last);
 // IA (mock Anthropic)
 global.fetch=async(u,o)=>{if(String(u).startsWith('https://api.anthropic.com')){const b=JSON.parse(o.body);global.__aiBody=b;return{ok:true,status:200,json:async()=>({content:[{type:'text',text:'Claro: {"name":"Zé","items":[{"n":"Pizza","p":50}]}'}]})}}return realFetch(u,o)};
 r=await rq('/api/ai',{method:'POST',cookie:ck,body:{prompt:'extraia',images:['data:image/jpeg;base64,/9j/AAAA','javascript:alert(1)']}});
 ok('IA devolve JSON extraído',r.j&&r.j.value&&r.j.value.name==='Zé'&&r.j.value.items[0].p===50,r.t);
 ok('IA enviou só 1 imagem válida + texto',global.__aiBody.messages[0].content.filter(c=>c.type==='image').length===1&&global.__aiBody.messages[0].content.some(c=>c.type==='text'));
 // Gemini
 process.env.GEMINI_API_KEY='g';
 global.fetch=async(u,o)=>{if(String(u).includes('generativelanguage.googleapis.com')){if(String(u).includes('gemini-3.8-flash')&&!global.__try){global.__try=1;return{ok:false,status:404,json:async()=>({error:{message:'gone'}})}}global.__gb=JSON.parse(o.body);global.__gh=o.headers;return{ok:true,status:200,json:async()=>({candidates:[{content:{parts:[{text:'{"name":"Gê","items":[]}'}]}}]})}}return realFetch(u,o)};
 r=await rq('/api/ai',{method:'POST',cookie:ck,body:{prompt:'extraia',images:['data:image/png;base64,iVBOR']}});
 ok('Gemini cai para o próximo modelo quando o primeiro dá 404',global.__try===1);
 ok('Gemini devolve JSON',r.j&&r.j.value&&r.j.value.name==='Gê',r.t);
 ok('Gemini recebeu imagem + JSON mode + chave no header',global.__gb.contents[0].parts[0].inline_data&&global.__gb.generationConfig.responseMimeType==='application/json'&&global.__gh['x-goog-api-key']==='g');
 delete process.env.GEMINI_API_KEY;
 // Meta (mock Graph)
 r=await rq('/auth/meta/start');ok('meta start sem login 401',r.s===401);
 r=await rq('/auth/meta/start',{cookie:ck});const loc=r.h.get('location')||'';ok('meta start redireciona ao Facebook com escopos',r.s===302&&loc.includes('facebook.com')&&loc.includes('client_id=111')&&loc.includes('instagram_basic')&&loc.includes('state='),loc);
 const state=new URL(loc).searchParams.get('state');
 global.fetch=async(u,o)=>{u=String(u);if(u.includes('/oauth/access_token'))return{ok:true,json:async()=>({access_token:'T'})};
  if(u.includes('/me/accounts'))return{ok:true,json:async()=>({data:[{name:'Pizzaria do Zé',about:'A melhor pizza',phone:'(11) 97777-6666',single_line_address:'Rua A, 10 - SP',hours:{mon_1_open:'18:00',mon_1_close:'23:00'},instagram_business_account:{username:'pizzariadoze',name:'Pizzaria do Zé',biography:'Pizza no forno a lenha',profile_picture_url:'https://cdn/x.jpg',media:{data:[{caption:'Promo de terça: 2 pizzas por R$ 90'}]}}}]})};
  if(u==='https://cdn/x.jpg')return{headers:{get:()=>'image/jpeg'},arrayBuffer:async()=>new Uint8Array([1,2,3]).buffer};
  return realFetch(u,o)};
 r=await rq('/auth/meta/callback?code=abc&state='+encodeURIComponent(state),{cookie:ck});
 ok('callback devolve dados do perfil via postMessage',r.t.includes('Pizza no forno a lenha')&&r.t.includes('Rua A, 10')&&r.t.includes('seg 18:00-23:00')&&r.t.includes('Promo de terça')&&r.t.includes('data:image/jpeg;base64'),r.t.slice(0,300));
 r=await rq('/auth/meta/callback?code=abc&state=forjado',{cookie:ck});ok('state forjado rejeitado',r.t.includes('inválido'));
 r=await rq('/auth/meta/callback?code=abc&state='+encodeURIComponent(state));ok('callback sem sessão rejeitado',r.t.includes('Sessão expirada'));

 // ---- extras: cadastro, cupom, indicação, contato, versões, domínio, backup, e-mail
 process.env.RESEND_API_KEY='RK';process.env.RESEND_URL='https://mail.test/emails';
 const mails=[];let xPref=null,xAmt=0;const _f2=global.fetch;
 global.fetch=async(u,o)=>{u=String(u);if(u==='https://mail.test/emails'){mails.push(JSON.parse(o.body));return{ok:true,status:200,json:async()=>({id:'m'})}}
  if(u==='https://mp.test/checkout/preferences'){xPref=JSON.parse(o.body);return{ok:true,status:201,json:async()=>({id:'p',init_point:'https://mp.test/pay/x'})}}
  const m=/^https:\/\/mp\.test\/v1\/payments\/(\d+)$/.exec(u);if(m)return{ok:true,status:200,json:async()=>({status:'approved',external_reference:xPref&&xPref.external_reference,transaction_amount:xAmt})};return _f2(u,o)};
 const tick=()=>new Promise(k=>setTimeout(k,60));
 r=await rq('/cadastro');ok('página de cadastro abre',r.s===200&&r.t.includes('7 dias'),r.s);
 r=await rq('/api/signup',{method:'POST',body:{name:'Sem',email:'sem@ex.com',password:'SenhaBoa123'}});ok('cadastro exige aceite dos termos',r.s===400,r.t);
 r=await rq('/api/signup',{method:'POST',body:{name:'Ana',email:'ana@ex.com',password:'SenhaBoa123',terms:true}});const ckA=(r.h.get('set-cookie')||'').split(';')[0];ok('cadastro cria conta e já entra',r.s===200&&ckA.startsWith('ap_s='),r.t);
 r=await rq('/api/me',{cookie:ckA});const refA=r.j.ref&&r.j.ref.code;ok('cadastro dá 7 dias de Pro, sem teste extra, com link de indicação',r.j.plan.key==='pro'&&r.j.plan.until>Date.now()+6*864e5&&r.j.trialOk===false&&/\/cadastro\?ref=/.test(r.j.ref.link),r.t);
 await tick();ok('e-mail de boas-vindas enviado',mails.some(m=>/Bem-vindo/.test(m.subject)&&m.to[0]==='ana@ex.com'));
 const tokOf=(rx,to)=>{const m=mails.filter(x=>x.to[0]===to&&rx.test(x.subject)).pop();const h=m&&/href="[^"]*[?]t=([^"&]+)"/.exec(m.html);return h?decodeURIComponent(h[1]):''};
 r=await rq('/api/db',{method:'POST',cookie:ckA,body:{op:'set',path:'sites/ana00v',data:{j:JSON.stringify({name:'Ana V',goal:'landing',items:[]})}}});ok('e-mail não confirmado bloqueia publicação',r.s===403&&r.j.error==='verify',r.t);
 r=await rq('/api/me',{cookie:ckA});ok('/api/me informa verificação pendente',r.j.verifyPending===true,r.t);
 {const tv=tokOf(/Confirme seu e-mail/,'ana@ex.com');ok('e-mail de confirmação enviado',!!tv);
 r=await rq('/verificar?t='+encodeURIComponent(tv));ok('link de confirmação funciona',r.s===200&&r.t.includes('confirmado'),r.s);
 r=await rq('/verificar?t='+encodeURIComponent(tv+'x'));ok('link adulterado rejeitado',r.s===400);
 r=await rq('/api/me',{cookie:ckA});ok('verificação some após confirmar',r.j.verifyPending===false,r.t);}
 r=await rq('/api/signup',{method:'POST',body:{name:'Ana',email:'ana@ex.com',password:'SenhaBoa123',terms:true}});ok('e-mail repetido 409',r.s===409,r.s);
 r=await rq('/api/signup',{method:'POST',body:{name:'X',email:'x@ex.com',password:'curta',terms:true}});ok('senha curta recusada no cadastro',r.s===400,r.s);
 r=await rq('/api/signup',{method:'POST',body:{name:'Bot',email:'bot@ex.com',password:'SenhaBoa123',terms:true,w:'spam'}});r=await rq('/login',{method:'POST',raw:'email=bot%40ex.com&password=SenhaBoa123'});ok('honeypot não cria conta',r.s===401,r.s);
 // teste grátis para cliente criado pelo admin
 r=await rq('/api/admin/clients',{method:'POST',cookie:ck,body:{name:'Bia',email:'bia@ex.com',plan:'free'}});const pwB=r.j.password;
 r=await rq('/login',{method:'POST',raw:'email=bia%40ex.com&password='+pwB});const ckB=(r.h.get('set-cookie')||'').split(';')[0];
 r=await rq('/api/me',{cookie:ckB});ok('cliente free vê teste grátis disponível',r.j.trialOk===true&&r.j.plan.key==='free',r.t);
 r=await rq('/api/db',{method:'POST',cookie:ckB,body:{op:'set',path:'sites/bia001',data:{j:JSON.stringify({id:'bia001',name:'Bia Studio'}),name:'Bia Studio'}}});
 r=await rq('/api/domain',{method:'POST',cookie:ckB,body:{site:'bia001',domain:'biastudio.com.br'}});ok('domínio próprio exige plano pago',r.s===403,r.s+' '+r.t);
 r=await rq('/api/trial',{method:'POST',cookie:ckB});ok('teste grátis ativa Pro por 7 dias',r.s===200,r.t);
 r=await rq('/api/trial',{method:'POST',cookie:ckB});ok('teste grátis só uma vez',r.s===400,r.s);
 r=await rq('/api/me',{cookie:ckB});ok('após o teste: plano Pro, trialOk falso',r.j.plan.key==='pro'&&r.j.trialOk===false,r.t);
 // cupom + indicação
 r=await rq('/api/admin/coupons',{method:'POST',body:{code:'LANC20',pct:20}});ok('cupom exige admin',r.s===401,r.s);
 r=await rq('/api/admin/coupons',{method:'POST',cookie:ck,body:{code:'a b',pct:20}});ok('cupom com código inválido recusado',r.s===400,r.s);
 r=await rq('/api/admin/coupons',{method:'POST',cookie:ck,body:{code:'lanc20',pct:20,max:2}});ok('admin cria cupom',r.s===200&&r.j.coupon.code==='LANC20',r.t);
 r=await rq('/api/coupon?code=lanc20');ok('cupom válido devolve o desconto',r.s===200&&r.j.pct===20,r.t);
 r=await rq('/api/coupon?code=nada');ok('cupom inexistente 404',r.s===404,r.s);
 r=await rq('/api/signup',{method:'POST',body:{name:'Caio',email:'caio@ex.com',password:'SenhaBoa123',terms:true,ref:refA}});const ckC=(r.h.get('set-cookie')||'').split(';')[0];
 const untilA0=(await rq('/api/me',{cookie:ckA})).j.plan.until;
 r=await rq('/api/checkout',{method:'POST',cookie:ckC,body:{plan:'basic',coupon:'invalido'}});ok('checkout com cupom inválido recusado',r.s===400,r.s);
 r=await rq('/api/checkout',{method:'POST',cookie:ckC,body:{plan:'basic',coupon:'lanc20'}});ok('checkout aplica 20% no valor cobrado',r.s===200&&xPref.items[0].unit_price===39.92,r.t+JSON.stringify(xPref&&xPref.items));
 xAmt=49.9;await rq('/mp/webhook?type=payment&data.id=301',{method:'POST'});
 r=await rq('/api/admin/overview',{cookie:ck});const cc=r.j.clients.find(c=>c.email==='caio@ex.com');ok('pagamento com valor cheio-menor que o desconto não vale? (49,90 ≥ 39,92 libera)',cc&&cc.plan.key==='basic',JSON.stringify(cc&&cc.plan));
 r=await rq('/api/admin/overview',{cookie:ck});ok('uso do cupom contabilizado',r.j.coupons.find(c=>c.code==='LANC20').used===1,JSON.stringify(r.j.coupons));
 r=await rq('/api/me',{cookie:ckA});ok('indicação premia o indicador com +7 dias e conta o cadastro',r.j.plan.until>=untilA0+7*864e5-1000&&r.j.ref.rewards===1&&r.j.ref.signups===1,r.t);
 await tick();ok('e-mails de recibo e de indicação enviados',mails.some(m=>/Pagamento aprovado/.test(m.subject)&&m.to[0]==='caio@ex.com')&&mails.some(m=>/7 dias grátis/.test(m.subject)&&m.to[0]==='ana@ex.com'));
 xAmt=49.9;await rq('/mp/webhook?type=payment&data.id=301',{method:'POST'});r=await rq('/api/me',{cookie:ckA});ok('webhook repetido não premia de novo',r.j.ref.rewards===1,r.t);
 r=await rq('/api/admin/audit');ok('auditoria exige admin',r.s===401,r.s);
 r=await rq('/api/admin/audit',{cookie:ck});ok('auditoria registra pagamento, indicação e cadastro',r.j.items.some(i=>i.a==='order.paid')&&r.j.items.some(i=>i.a==='referral.reward')&&r.j.items.some(i=>i.a==='signup')&&r.j.items.some(i=>i.a==='admin.login'),JSON.stringify(r.j.items.map(i=>i.a)));
 // contato / presença / lead vindos do site
 const sh='pizzaria-do-ze.kattalo.online';
 r=await rq('/api/contact',{host:sh,method:'POST',ct:'text/plain',body:{type:'rsvp',n:'Maria',c:'11999990000',x:'2 pessoas'}});ok('visitante envia presença/mensagem',r.s===200,r.s+' '+r.t);
 r=await rq('/api/contact',{host:sh,method:'POST',ct:'text/plain',body:{type:'lead',c:'sem nome'}});ok('mensagem sem nome recusada',r.s===400,r.s);
 r=await rq('/api/contact',{host:'inexistente.kattalo.online',method:'POST',ct:'text/plain',body:{n:'A'}});ok('contato em site inexistente recusado',r.s===400,r.s);
 r=await rq('/api/contact',{host:sh,method:'POST',ct:'text/plain',body:{n:'Robô',w:'x'}});ok('honeypot de contato ignorado',r.s===200);
 r=await rq('/api/messages',{cookie:ck});ok('dono (admin) vê a mensagem',r.j.items.length===1&&r.j.items[0].type==='rsvp'&&r.j.items[0].n==='Maria',r.t);
 r=await rq('/api/messages',{cookie:ckA});ok('outro cliente não vê mensagens alheias',r.s===200&&r.j.items.length===0,r.t);
 r=await rq('/api/messages?site=abc123',{cookie:ckA});ok('outro cliente não lê site alheio',r.s===403,r.s);
 r=await rq('/api/messages?csv=1',{cookie:ck});ok('exporta CSV de mensagens',r.s===200&&r.t.includes('Maria')&&r.t.includes('Nome'),r.t.slice(0,80));
 r=await rq('/api/messages',{});ok('mensagens exigem login',r.s===401,r.s);
 const mid=(await rq('/api/messages',{cookie:ck})).j.items[0].id;
 r=await rq('/api/messages/delete',{method:'POST',cookie:ckA,body:{site:'abc123',id:mid}});ok('cliente não apaga mensagem alheia',r.s===403,r.s);
 r=await rq('/api/messages/delete',{method:'POST',cookie:ck,body:{site:'abc123',id:mid}});r=await rq('/api/messages',{cookie:ck});ok('dono apaga mensagem',r.j.items.length===0,r.t);
 // estatísticas por site
 r=await rq('/api/stats/site?id=abc123',{cookie:ck});ok('estatísticas do site: visitantes únicos e 30 dias',r.s===200&&r.j.unique30>=1&&r.j.days.length===30,r.t.slice(0,120));
 r=await rq('/api/stats/site?id=abc123',{cookie:ckA});ok('estatísticas de site alheio 403',r.s===403,r.s);
 r=await rq('/api/stats/site?id=lnk001',{cookie:ck});ok('redirecionamento do link na bio é contado como clique com o nome do link',r.j.links.some(l=>l.l==='Insta'&&l.c>=1)&&r.j.unique30>=1,r.t.slice(0,200));
 // versões
 r=await rq('/api/db',{method:'POST',cookie:ck,body:{op:'set',path:'sites/abc123',data:{j:JSON.stringify({...site,name:'Pizzaria V2'}),name:'Pizzaria V2'}}});
 r=await rq('/api/versions?site=abc123',{cookie:ck});const vv=r.j.items&&r.j.items[0];ok('republicar guarda a versão anterior',r.s===200&&r.j.items.length===1,r.t);
 r=await rq('/api/versions/restore',{method:'POST',cookie:ckA,body:{site:'abc123',v:vv.v}});ok('cliente não restaura versão alheia',r.s===403,r.s);
 r=await rq('/api/versions/restore',{method:'POST',cookie:ck,body:{site:'abc123',v:vv.v}});r=await rq('/api/db',{host:sh,method:'POST',body:{op:'get',path:'sites/abc123'}});ok('restaurar volta o conteúdo anterior',JSON.parse(r.j.data.j).name==='Pizzaria do Zé',r.t.slice(0,100));
 // domínio próprio
 r=await rq('/api/db',{method:'POST',cookie:ckA,body:{op:'set',path:'sites/ana001',data:{j:JSON.stringify({id:'ana001',name:'Ana Sites'}),name:'Ana Sites'}}});
 r=await rq('/api/domain',{method:'POST',cookie:ckA,body:{site:'ana001',domain:'foo'}});ok('domínio inválido recusado',r.s===400,r.s);
 r=await rq('/api/domain',{method:'POST',cookie:ckA,body:{site:'ana001',domain:'x.kattalo.online'}});ok('domínio dentro do nosso domínio recusado',r.s===400,r.s);
 r=await rq('/api/domain',{method:'POST',cookie:ckA,body:{site:'abc123',domain:'meu.com.br'}});ok('domínio para site alheio 403',r.s===403,r.s);
 r=await rq('/api/domain',{method:'POST',cookie:ckA,body:{site:'ana001',domain:'https://AnaSite.com.br/'}});ok('cliente pago registra domínio (normalizado)',r.s===200&&r.j.host==='anasite.com.br'&&r.j.target==='app.kattalo.online',r.t);
 r=await rq('/api/domain',{method:'POST',cookie:ckC,body:{site:'ana001',domain:'anasite.com.br'}});ok('domínio já em uso por outro site 403/409',r.s===403||r.s===409,r.s);
 r=await rq('/',{host:'anasite.com.br'});ok('domínio ainda não verificado não serve o site',r.t.includes('type=password'),r.s);
 await store.set('domain/anasite.com.br',{site:'ana001',owner:(await store.get('uemail/ana@ex.com')).id,ok:true,at:Date.now()});
 r=await rq('/',{host:'anasite.com.br'});ok('domínio verificado serve o site',r.s===200&&r.t.includes('window.__SITE_ID="ana001"'),r.t.slice(0,80));
 r=await rq('/api/domains',{cookie:ckA});ok('lista os domínios do cliente',r.j.items.length===1&&r.j.items[0].ok===true,r.t);
 r=await rq('/api/domain/delete',{method:'POST',cookie:ckA,body:{domain:'anasite.com.br'}});r=await rq('/',{host:'anasite.com.br'});ok('remover domínio tira o site do ar nesse endereço',r.t.includes('type=password'));
 // backup
 r=await rq('/api/admin/backups/run',{method:'POST'});ok('backup manual exige admin',r.s===401,r.s);
 r=await rq('/api/admin/backups/run',{method:'POST',cookie:ck});ok('backup manual gera snapshot',r.s===200&&r.j.size>100,r.t);
 r=await rq('/api/admin/backups',{cookie:ck});const bd=r.j.items[0]&&r.j.items[0].day;ok('lista de backups',r.j.items.length>=1&&/^\d{4}-\d\d-\d\d$/.test(bd),r.t);
 r=await rq('/api/admin/backups/download?d='+bd,{cookie:ck});ok('baixa o backup sem hashes de senha',r.s===200&&Array.isArray(r.j.users)&&!r.t.includes('"pw"'),r.s);
 // vencimento por e-mail
 const idA=(await store.get('uemail/ana@ex.com')).id,uA=await store.get('users/'+idA);uA.planUntil=Date.now()+2*864e5;await store.set('users/'+idA,uA);mails.length=0;
 r=await rq('/api/admin/jobs',{method:'POST',cookie:ck});await tick();ok('aviso de vencimento enviado ao cliente',r.j.expiring>=1&&mails.some(m=>/vence em/.test(m.subject)&&m.to[0]==='ana@ex.com'),r.t+JSON.stringify(mails.map(m=>m.subject)));
 mails.length=0;r=await rq('/api/admin/jobs',{method:'POST',cookie:ck});ok('aviso não repete',r.j.expiring===0&&!mails.length,r.t);
 // ---- operação: esqueci a senha (cliente), termos, comprador
 r=await rq('/esqueci');ok('página esqueci a senha abre',r.s===200&&r.t.includes('Esqueci'),r.s);
 r=await rq('/');ok('login tem link de esqueci a senha',r.t.includes('/esqueci')||r.t.includes('Esqueci'),r.s);
 mails.length=0;r=await rq('/api/forgot',{method:'POST',body:{email:'ana@ex.com'}});await tick();
 ok('pedido de redefinição envia e-mail',r.s===200&&r.j.mail===1&&mails.some(m=>/Redefinir sua senha/.test(m.subject)&&m.to[0]==='ana@ex.com'),r.t);
 mails.length=0;r=await rq('/api/forgot',{method:'POST',body:{email:'naoexiste@ex.com'}});await tick();ok('e-mail inexistente: mesma resposta e nenhum envio',r.s===200&&r.j.ok&&!mails.length,r.t);
 {const tr=tokOf(/Redefinir sua senha/,'ana@ex.com')||(await(async()=>{mails.length=0;await rq('/api/forgot',{method:'POST',body:{email:'ana@ex.com'}});await tick();return tokOf(/Redefinir sua senha/,'ana@ex.com')})());
 ok('e-mail traz o token de redefinição',!!tr);
 r=await rq('/redefinir?t='+encodeURIComponent(tr));ok('página de nova senha abre',r.s===200&&r.t.includes('nova senha'),r.s);
 r=await rq('/api/reset',{method:'POST',body:{t:tr+'x',password:'NovaSenha456'}});ok('token adulterado rejeitado',r.s===400,r.t);
 r=await rq('/api/reset',{method:'POST',body:{t:tr,password:'curta'}});ok('senha curta recusada na redefinição',r.s===400,r.t);
 mails.length=0;r=await rq('/api/reset',{method:'POST',body:{t:tr,password:'NovaSenha456'}});await tick();ok('redefinição altera a senha e avisa por e-mail',r.s===200&&mails.some(m=>/senha foi alterada/.test(m.subject)),r.t);
 r=await rq('/api/reset',{method:'POST',body:{t:tr,password:'OutraSenha789'}});ok('link de redefinição só vale uma vez',r.s===400,r.t);
 r=await rq('/login',{method:'POST',raw:'email=ana%40ex.com&password=NovaSenha456'});ok('login com a nova senha',r.s===302||r.s===200&&!/incorret/i.test(r.t),r.s);
 r=await rq('/login',{method:'POST',raw:'email=ana%40ex.com&password=SenhaBoa123'});ok('senha antiga não entra mais',r.s===401,r.s);}
 r=await rq('/api/db',{method:'POST',cookie:ck,body:{op:'set',path:'sites/bz0001',data:{j:JSON.stringify({name:'Loja Bia',goal:'menu',items:[{n:'Pizza',p:30}]}),name:'Loja Bia'}}});
 {const H=r.j.slug+'.kattalo.online';mails.length=0;
 r=await rq('/api/buyer/register',{method:'POST',body:{name:'Bia',email:'bia@ex.com',password:'SenhaBoa123'},host:H});await tick();
 const bt=r.j.token;ok('comprador novo nasce não confirmado e recebe e-mail',r.s===200&&r.j.vf===0&&mails.some(m=>/Confirme seu e-mail/.test(m.subject)&&m.to[0]==='bia@ex.com'),r.t);
 r=await rq('/api/order',{method:'POST',body:{items:[{n:'x',q:1}],bt},host:H});ok('pedido bloqueado até confirmar e-mail',r.s===403&&r.j.error==='verify',r.t);
 r=await rq('/api/buyer/me',{method:'POST',body:{bt:tokOf(/Confirme seu e-mail/,'bia@ex.com')},host:H});ok('token de confirmação não serve como sessão',r.s===401,r.s);
 r=await rq('/buyer/verify?t='+encodeURIComponent(tokOf(/Confirme seu e-mail/,'bia@ex.com')));ok('comprador confirma e-mail',r.s===200&&r.t.includes('confirmado'),r.s);
 r=await rq('/api/order',{method:'POST',body:{items:[{n:'x',q:1}],bt},host:H});ok('depois de confirmar não é mais bloqueado',!(r.j&&r.j.error==='verify'),r.t);
 mails.length=0;r=await rq('/api/buyer/forgot',{method:'POST',body:{email:'bia@ex.com'},host:H});await tick();
 ok('comprador pede redefinição e recebe e-mail',r.s===200&&r.j.mail===1&&mails.some(m=>/Redefinir sua senha/.test(m.subject)&&m.to[0]==='bia@ex.com'),r.t);
 const br=tokOf(/Redefinir sua senha/,'bia@ex.com');
 r=await rq('/api/buyer/me',{method:'POST',body:{bt:br},host:H});ok('token de redefinição não serve como sessão',r.s===401,r.s);
 r=await rq('/buyer/reset?t='+encodeURIComponent(br));ok('página de nova senha do comprador abre',r.s===200&&r.t.includes('nova senha'),r.s);
 r=await rq('/api/buyer/reset',{method:'POST',body:{t:br,password:'NovaSenha456'}});ok('comprador redefine a senha',r.s===200,r.t);
 r=await rq('/api/buyer/reset',{method:'POST',body:{t:br,password:'Outra123456'}});ok('link do comprador só vale uma vez',r.s===400,r.t);
 r=await rq('/api/buyer/login',{method:'POST',body:{email:'bia@ex.com',password:'NovaSenha456'},host:H});ok('comprador entra com a nova senha',r.s===200,r.t);}
 r=await rq('/termos');ok('termos de uso',r.s===200&&r.t.includes('Termos de Uso')&&r.t.includes('LGPD')===false&&r.t.includes('Política de Privacidade'));
 r=await rq('/privacidade');ok('privacidade cita LGPD, direitos e contato',r.s===200&&r.t.includes('LGPD')&&r.t.includes('art. 18')&&r.t.includes('mailto:'));
 // ---- página de vendas
 {const sj={name:'Curso Foco',goal:'sales',sl:'video',sp:97,sd:197,sg:7,st:24,sk:'https://pay.exemplo.com/foco',sv:'https://youtu.be/dQw4w9WgXcQ',sb:'Aprenda rápido\nAplique já',sm:'Fundamentos | Base\nPrática | Exercícios',faq:'Como recebo? | Por e-mail',tests:'Ana: ótimo',slogan:'Domine o foco em 7 dias',color:'#0ea5e9',phone:'+55 11 91234-5678'};
 r=await rq('/api/db',{method:'POST',cookie:ck,body:{op:'set',path:'sites/vend01',data:{j:JSON.stringify(sj),name:sj.name}}});const sl1=r.j&&r.j.slug;ok('publica página de vendas',!!sl1,r.t);r=await rq('/',{host:sl1+'.kattalo.online'});ok('página de vendas é servida no subdomínio',r.s===200&&r.t.includes('__SITE_ID'),r.s);
 const px='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
 const sj2={name:'Curso <img src=x onerror=alert(1)> "Foco"',goal:'sales',ss:'Sub & "aspas" <b>',cover:px,sp:10,phone:'+55 11 91234-5678'};
 r=await rq('/api/db',{method:'POST',cookie:ck,body:{op:'set',path:'sites/vend03',data:{j:JSON.stringify(sj2),name:'Curso Foco 2'}}});const sl3=r.j&&r.j.slug;
 r=await rq('/',{host:sl3+'.kattalo.online'});const hd=(r.t.split('</head>')[0]||'');
 ok('prévia: og:title, og:description e og:image no HTML servido',hd.includes('property="og:title"')&&hd.includes('property="og:description"')&&hd.includes('property="og:image" content="https://'+sl3+'.kattalo.online/__og"'),hd.slice(-300));
 ok('prévia: nome e descrição vêm escapados (sem tag injetada)',!hd.includes('<img src=x')&&hd.includes('&lt;img')&&hd.includes('&amp; &quot;aspas&quot;'));
 r=await rq('/__og',{host:sl3+'.kattalo.online'});ok('imagem de prévia (/__og) serve a capa como imagem',r.s===200&&String(r.h.get('content-type')).includes('image/png')&&r.h.get('x-content-type-options')==='nosniff',r.s);
 r=await rq('/__og',{host:sl1+'.kattalo.online'});ok('/__og sem capa devolve 404',r.s===404,r.s);
 r=await rq('/__og');ok('/__og no domínio do painel devolve 404',r.s===404,r.s);
 }
 // ---- checkout próprio da página de vendas (Mercado Pago do cliente + e-mail de acesso)
 {const _f3=global.fetch;global.fetch=async(u,o)=>{if(String(u)==='https://mp.test/users/me')return{ok:true,status:200,json:async()=>({nickname:'ana_mp'}),text:async()=>'{"nickname":"ana_mp"}'};return _f3(u,o)};
 r=await rq('/api/integrations/mp',{method:'POST',cookie:ckA,body:{token:'APP_USR-xxxxxxxxxxxxxxxxxxxxxxxx'}});ok('cliente Pro conecta o Mercado Pago',r.s===200&&r.j.mp&&r.j.mp.on===1,r.t);
 const dj={name:'Curso DP',goal:'sales',sp:97,sd:197,mpay:1,sle:'oi@dp.com',phone:'+55 11 91234-5678'};
 r=await rq('/api/db',{method:'POST',cookie:ckA,body:{op:'set',path:'sites/dp0001',data:{j:JSON.stringify(dj),name:dj.name}}});const sdp=r.j&&r.j.slug;ok('publica página de vendas com checkout',!!sdp,r.t);
 const H=sdp+'.kattalo.online';
 r=await rq('/api/dpay',{host:H,method:'POST',body:{name:'',email:'x'}});ok('checkout próprio valida nome e e-mail',r.s===400,r.s);
 r=await rq('/api/dpay',{host:H,method:'POST',body:{name:'Carla Lima',email:'carla@ex.com',price:1,sp:1}});ok('checkout cria preferência com o preço do servidor (ignora preço do cliente)',r.s===200&&r.j.url==='https://mp.test/pay/x'&&xPref.items[0].unit_price===97&&xPref.payer.email==='carla@ex.com'&&/^dp0001:/.test(xPref.external_reference),r.t+JSON.stringify(xPref));
 r=await rq('/api/dpay/cfg',{method:'POST',body:{site:'dp0001',url:'https://area.dp.com/acesso'}});ok('config de acesso exige login',r.s===401,r.s);
 r=await rq('/api/dpay/cfg',{method:'POST',cookie:ckB,body:{site:'dp0001',url:'https://area.dp.com/acesso'}});ok('config de acesso só do dono do site',r.s===403,r.s);
 r=await rq('/api/dpay/cfg',{method:'POST',cookie:ckA,body:{site:'dp0001',url:'javascript:alert(1)'}});ok('link de acesso só aceita https',r.s===400,r.t);
 r=await rq('/api/dpay/cfg',{method:'POST',cookie:ckA,body:{site:'dp0001',url:'https://area.dp.com/acesso',msg:'Senha: 123'}});ok('dono salva link de acesso',r.s===200&&r.j.url==='https://area.dp.com/acesso',r.t);
 r=await rq('/api/db',{host:H,method:'POST',body:{op:'get',path:'sites/dp0001'}});ok('link de acesso NÃO aparece no JSON público do site',r.s===200&&!r.t.includes('area.dp.com'),r.t.slice(0,200));
 const n0=mails.length;xAmt=1;r=await rq('/api/mp/hook?s=dp0001&type=payment&data.id=321',{host:H,method:'POST'});await tick();await tick();
 ok('pagamento com valor diferente não libera acesso',mails.length===n0,mails.length-n0);
 xAmt=97;r=await rq('/api/mp/hook?s=dp0001&type=payment&data.id=322',{host:H,method:'POST'});await tick();await tick();await tick();
 const am=mails.filter(m=>m.to[0]==='carla@ex.com'&&/Seu acesso/.test(m.subject)).pop();ok('pagamento aprovado envia o e-mail de acesso ao comprador',!!am&&am.html.includes('https://area.dp.com/acesso')&&am.html.includes('Senha: 123'),am&&am.html.slice(0,200));
 ok('vendedor é avisado da venda',mails.some(m=>m.to[0]==='ana@ex.com'&&/Nova mensagem/.test(m.subject)&&m.html.includes('Venda aprovada')));
 const n1=mails.filter(m=>/Seu acesso/.test(m.subject)).length;r=await rq('/api/mp/hook?s=dp0001&type=payment&data.id=322',{host:H,method:'POST'});await tick();await tick();
 ok('webhook repetido não reenvia o acesso',mails.filter(m=>/Seu acesso/.test(m.subject)).length===n1);
 const dj2={...dj,mpay:0};await rq('/api/db',{method:'POST',cookie:ckA,body:{op:'set',path:'sites/dp0001',data:{j:JSON.stringify(dj2),name:dj.name}}});
 r=await rq('/api/dpay',{host:H,method:'POST',body:{name:'Carla Lima',email:'carla@ex.com'}});ok('sem o pagamento online ligado o checkout é recusado',r.s===409,r.s);
 global.fetch=_f3;}
 global.fetch=_f2;delete process.env.RESEND_API_KEY;
 // páginas legais + saúde + headers
 r=await rq('/privacidade');ok('política de privacidade',r.s===200&&r.t.includes('Política'));
 r=await rq('/healthz');ok('healthz',r.j&&r.j.ok);
 ok('headers de segurança',r.h.get('x-content-type-options')==='nosniff'&&r.h.get('x-frame-options')==='DENY');
 // login brute force
 let c429=0;for(let i=0;i<10;i++){const x=await rq('/login',{method:'POST',raw:'password=x'+i});if(x.s===429)c429++}ok('bloqueio de força bruta no login',c429>0,c429);
 // delete
 r=await rq('/api/db',{method:'POST',cookie:ck,body:{op:'delete',path:'sites/abc123'}});r=await rq('/',{host:'pizzaria-do-ze.kattalo.online'});ok('site despublicado some do subdomínio',r.s===404);
 console.log('\nRESULTADO',pass,'/',pass+fail);srv.close();process.exit(fail?1:0);
})().catch(e=>{console.error('ERRO',e);process.exit(2)});
