// Testes de integração do servidor (sem dependências externas).
process.env.ROOT_DOMAIN='kattalo.online';process.env.ADMIN_PASSWORD='segredo123';process.env.SESSION_SECRET='x'.repeat(40);
process.env.DATA_FILE='/tmp/ap-test-data.json';process.env.PORT='3917';process.env.META_APP_ID='111';process.env.META_APP_SECRET='sec';process.env.ANTHROPIC_API_KEY='k';
require('fs').rmSync('/tmp/ap-test-data.json',{force:true});
const {main}=require('./server');
let pass=0,fail=0;const ok=(n,c,x)=>{c?pass++:fail++;console.log((c?'PASS ':'FAIL ')+n+(c?'':' -> '+x))};
const B='http://127.0.0.1:3917';
const http=require('http');
const rq=(path,{host='app.kattalo.online',method='GET',body,cookie,raw}={})=>new Promise((ok,no)=>{const h={host};if(cookie)h.cookie=cookie;let b;if(raw){b=raw;h['content-type']='application/x-www-form-urlencoded'}else if(body){b=JSON.stringify(body);h['content-type']='application/json'}
 if(b)h['content-length']=Buffer.byteLength(b);const q=http.request({host:'127.0.0.1',port:3917,path,method,headers:h},res=>{let t='';res.on('data',c=>t+=c);res.on('end',()=>{let j=null;try{j=JSON.parse(t)}catch(e){}ok({s:res.statusCode,t,j,h:{get:k=>{const v=res.headers[k.toLowerCase()];return Array.isArray(v)?v[0]:v}}})})});q.on('error',no);if(b)q.write(b);q.end()});
(async()=>{
 const {srv}=await main();
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
 // site por subdomínio
 r=await rq('/',{host:'pizzaria-do-ze.kattalo.online'});ok('subdomínio serve o site sem login',r.s===200&&r.t.includes('window.__SITE_ID="abc123"')&&!r.t.includes('type=password'),r.s);
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
 r=await rq('/api/db',{method:'POST',cookie:ck,body:{op:'list',coll:'events',limit:100}});ok('admin lista eventos',r.j&&r.j.docs.length===2,JSON.stringify(r.j));
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
