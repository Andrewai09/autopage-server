# Gera public/app.html (versão hospedada) a partir de app.src.html (versão do artefato Claude).
import re
s=open('app.src.html').read()
def r(a,b):
    global s
    assert s.count(a)>=1,'MISSING: '+a[:80]
    s=s.replace(a,b,1)
# link público: subdomínio quando hospedado
r("const BASE='https://claude.ai/artifact/KDVHmGMDecU8LceEKqBiiz';","const BASE='https://claude.ai/artifact/KDVHmGMDecU8LceEKqBiiz';const LINK=(id,sl)=>window.__ROOT?'https://'+(sl||id)+'.'+window.__ROOT:BASE+'#site-'+id;")
r("$('#pl').textContent=BASE+'#site-'+P.id;","$('#pl').textContent=LINK(P.id,P.slug);")
r("text:BASE+'#site-'+P.id,","text:LINK(P.id,P.slug),")
r("const u=id?BASE+'#site-'+id:$('#pl').textContent;","const u=id?LINK(id,(S.find(x=>x.id===id)||{}).slug):$('#pl').textContent;")
# slug guardado ao publicar
r("await db.doc('sites/'+P.id).set({j:j,name:P.name,at:Date.now()});done=true;break","const rs=await db.doc('sites/'+P.id).set({j:j,name:P.name,at:Date.now()});if(rs&&rs.slug)P.slug=rs.slug;done=true;break")
r("pubAt:+x.pubAt||0,","pubAt:+x.pubAt||0,slug:/^[a-z0-9-]{1,40}$/.test(x.slug)?x.slug:'',")
# rota por subdomínio e limite coerente com a publicação
r("const m=/^#site-([a-z0-9]+)$/.exec(location.hash);if(!m)return;","const m=/^#site-([a-z0-9]+)$/.exec(location.hash)||(window.__SITE_ID&&/^[a-z0-9]{1,16}$/.test(window.__SITE_ID)?[0,window.__SITE_ID]:null);if(!m)return;")
r("if(String(d.data().j).length>400000)throw 0;","if(String(d.data().j).length>1100000)throw 0;")
# texto de compartilhamento
r("Compartilhe este artefato pelo botão Share do Claude para seus clientes abrirem o link (eles precisam entrar no Claude). Visitas e cliques aparecem em Meus sites. Para hospedar fora, baixe o .html.","O link público de cada site abre para qualquer pessoa, sem login. Visitas e cliques aparecem em Meus sites. Para hospedar fora, baixe o .html.")
# conexão Meta
r('<label class="l">Dados do perfil: cole a bio','<div id="metaBox" hidden style="margin:10px 0"><button class="btn pri" type="button" onclick="metaConnect()">🔗 Conectar Instagram / Facebook do cliente</button><div class="mu" id="metaSt" style="margin-top:4px">Lê bio, endereço, telefone, horário e postagens pela API oficial da Meta.</div></div><label class="l">Dados do perfil: cole a bio')
r("let PR=[];","""let PR=[],META=null;
function metaConnect(){const w=window.open('/auth/meta/start','meta','width=560,height=720');if(!w){toast('Libere pop-ups para conectar');return}$('#metaSt').textContent='Aguardando autorização…'}
addEventListener('message',e=>{if(e.origin!==location.origin||!e.data||e.data.ap!=='meta')return;const d=e.data.data||{};if(d.error){$('#metaSt').textContent=d.error;toast(d.error);return}META=d;$('#c-bio').value=String(d.text||'').slice(0,5000);if(d.handle&&!$('#url').value.trim())$('#url').value='instagram.com/'+d.handle;$('#metaSt').textContent='✅ Conectado'+(d.name?': '+d.name:'')+'. Revise e clique em Gerar site.';det&&det()});
if(window.__CFG&&window.__CFG.meta)document.addEventListener('DOMContentLoaded',()=>{const b=document.getElementById('metaBox');if(b)b.hidden=false});""")
r("META=d;","META=d;META.p2=[];(d.photos||[]).slice(0,6).forEach(u=>{const im=new Image();im.onload=()=>{const k=Math.min(1,800/Math.max(im.width,im.height)),c=document.createElement('canvas');c.width=Math.max(1,im.width*k);c.height=Math.max(1,im.height*k);c.getContext('2d').drawImage(im,0,0,c.width,c.height);META.p2.push(c.toDataURL('image/jpeg',.72))};im.src=u});")
r("pays:'',cover:'',gal:[],","pays:'',cover:(META&&META.p2&&META.p2[0])||'',gal:((META&&META.p2)||[]).slice(1,7),")
r("P={id:Date.now().toString(36),name:nm,","P={id:Date.now().toString(36),name:(META&&META.name)||nm,")
r("phone:r.ph?'+'+r.ph:DEFPHS,","phone:r.ph?'+'+r.ph:(META&&META.phone&&META.phone.replace(/\\D/g,'').length>=10?'+'+(META.phone.replace(/\\D/g,'').length<=11?'55':'')+META.phone.replace(/\\D/g,''):DEFPHS),logo:(META&&META.logo)||'',")
# const nm precisa ser let
s=s.replace("n=sel||guess(r.hd+' '+$('#c-bio').value),nm=","n=sel||guess(r.hd+' '+$('#c-bio').value);let nm=",1) if False else s
# painéis Admin/Cliente
ui=open('hosted/ui.html').read();uj=open('hosted/qr.js').read()+'\n'+open('hosted/ui.js').read()
r('<section id="v-create">',ui+'<section id="v-create">')
r("['create','proc','edit','dash'].forEach","['create','proc','edit','dash','home','cli','vnd'].forEach")
r("if(v==='dash'){dash();evs()}","if(v==='dash'){dash();evs()}if(window.HX)HX(v);")
i=s.rindex("</script>\n</body>");s=s[:i]+uj+"\n"+s[i:]
# rascunhos locais por usuário
r("localStorage.getItem('ap_sites')","localStorage.getItem('ap_sites_'+((window.__U&&window.__U.id)||'x'))")
r("localStorage.setItem('ap_sites',","localStorage.setItem('ap_sites_'+((window.__U&&window.__U.id)||'x'),")
open('public/app.html','w').write(s)
print('ok',len(s))
