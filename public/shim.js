// Emula as capacidades do Claude (sample/db/downloads) usando a API do servidor.
(function(){
  const post=async(u,b)=>{const r=await fetch(u,{method:'POST',headers:{'content-type':'application/json'},credentials:'same-origin',body:JSON.stringify(b)});let j=null;try{j=await r.json()}catch(e){}if(!r.ok){const e=new Error((j&&j.error)||('http '+r.status));e.status=r.status;throw e}return j};
  const blobToUrl=b=>new Promise((ok,no)=>{const f=new FileReader();f.onload=()=>ok(f.result);f.onerror=no;f.readAsDataURL(b)});
  const sample=async()=>{throw new Error('use sample.json')};
  sample.json=async(prompt,opts)=>{const imgs=opts&&opts.images?await Promise.all([].concat(opts.images).slice(0,4).map(blobToUrl)):[];const r=await post('/api/ai',{prompt:String(prompt),images:imgs});return r.value};
  sample.limits=async()=>({images:{maxCount:4}});
  const dbq=(coll)=>{const q={coll,lim:500};const api={orderBy(){return api},limit(n){q.lim=n;return api},async get(){const r=await post('/api/db',{op:'list',coll,limit:q.lim});const docs=r.docs.map(d=>({id:d.id,data:()=>d.data}));return{docs,size:docs.length,forEach:f=>docs.forEach(f)}},async add(data){return post('/api/db',{op:'add',coll,data})}};return api};
  const db={doc(path){return{async get(){const r=await post('/api/db',{op:'get',path});return{exists:!!r.exists,id:path.split('/').pop(),data:()=>r.data}},async set(data){return post('/api/db',{op:'set',path,data})},async delete(){return post('/api/db',{op:'delete',path})}}},collection:dbq};
  const downloads={async save({filename,data}){const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([data],{type:'application/octet-stream'}));a.download=filename;document.body.appendChild(a);a.click();setTimeout(()=>{URL.revokeObjectURL(a.href);a.remove()},500)}};
  const hosted=!(window.__CFG&&window.__CFG.site);
  window.claude={use:async n=>n==='sample'&&hosted?sample:n==='db'?db:n==='downloads'?downloads:null};
})();
