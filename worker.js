const APPS_SCRIPT_URL = "https://script.google.com/macros/s/AKfycby-E-1j5rfU1eAMWX-5APMTMCK7C_0muyeV4FdM8JlbHTxKL47lqimoVlyuHdV0vcU4/exec";

async function proxyToAppsScript(request) {
  let target = APPS_SCRIPT_URL;
  let method = request.method;
  let body;

  if (method !== "GET" && method !== "HEAD") body = await request.arrayBuffer();

  const visited = new Set();
  for (let i = 0; i < 10; i++) {
    const headers = new Headers();
    const contentType = request.headers.get("content-type");
    if (method !== "GET" && method !== "HEAD" && contentType) headers.set("content-type", contentType);

    const response = await fetch(target, {method, headers, body, redirect:"manual"});
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (!location) return response;
      target = new URL(location, target).toString();
      if (visited.has(target)) return new Response(JSON.stringify({ok:false,error:"O Apps Script entrou em um redirecionamento circular."}), {status:502,headers:{"content-type":"application/json;charset=UTF-8"}});
      visited.add(target);
      method = "GET";
      body = undefined;
      continue;
    }
    return response;
  }

  return new Response(JSON.stringify({ok:false,error:"Redirecionamento excessivo no Apps Script."}), {status:502,headers:{"content-type":"application/json;charset=UTF-8"}});
}

async function appsScriptJson(payload) {
  const response = await fetch(APPS_SCRIPT_URL, {
    method:"POST",
    headers:{"content-type":"text/plain;charset=UTF-8"},
    body:JSON.stringify(payload),
    redirect:"follow"
  });
  return response.json();
}

async function isConfirmedClientOrder(data) {
  const token=String(data?.token||"").trim();
  const id=String(data?.id||"").trim();
  if(!token||!id)return false;

  const result=await appsScriptJson({action:"cliente_dados",data:{token}});
  if(!result?.ok)return false;

  const pedidos=Array.isArray(result.data?.pedidos)?result.data.pedidos:[];
  const pedido=pedidos.find(p=>String(p?.id||"").trim()===id);
  return String(pedido?.status||"").trim()==="Confirmado";
}

async function handleApi(request) {
  if(request.method!=="POST")return proxyToAppsScript(request);

  let payload;
  try{payload=await request.clone().json()}catch(_){return proxyToAppsScript(request)}

  const action=String(payload?.action||"").trim();
  const data=payload?.data||{};

  // Proteção no proxy: cliente nunca consegue editar/excluir pedido confirmado.
  if(action==="cliente_editar_pedido"||action==="cliente_excluir_pedido"){
    try{
      if(await isConfirmedClientOrder(data)){
        return new Response(JSON.stringify({ok:false,error:"Pedido já confirmado. Somente o administrador pode alterá-lo ou excluí-lo."}),{status:403,headers:{"content-type":"application/json;charset=UTF-8"}});
      }
    }catch(_){
      // O Apps Script continua sendo o destino final da requisição.
    }
  }

  return proxyToAppsScript(request);
}

const CLIENT_DELETE_HANDLER=`
<script>
document.addEventListener('click',async e=>{
  if(!e.target.classList.contains('order-delete'))return;
  const id=e.target.dataset.id;
  const s=typeof session==='function'?session():null;
  if(!id||!s)return;
  if(!confirm('Excluir este pedido?'))return;
  e.target.disabled=true;
  const j=await api('cliente_excluir_pedido',{token:s.token,id});
  if(!j){e.target.disabled=false;return;}
  currentPedidos=currentPedidos.filter(o=>String(o.id)!==String(id));
  editingOrderId=null;
  quantities={};
  if(typeof renderStock==='function')renderStock(stock);
  if(typeof renderOrders==='function')renderOrders(currentPedidos,currentVendas);
  showMsg('Pedido excluído com sucesso.','success');
});
</script>`;

export default {
  async fetch(request, env) {
    const url=new URL(request.url);

    if(url.pathname==="/api"||url.pathname==="/api/"){
      const response=await handleApi(request);
      const responseHeaders=new Headers(response.headers);
      responseHeaders.delete("set-cookie");
      responseHeaders.delete("location");
      return new Response(response.body,{status:response.status,statusText:response.statusText,headers:responseHeaders});
    }

    const pathname=url.pathname.toLowerCase();
    if(pathname==="/cliente.html"||pathname==="/cliente"){
      const response=await env.ASSETS.fetch(request);
      const html=await response.text();
      const fixed=html
        .replace("(o.status==='Reservado'||o.status==='Confirmado')","(o.status==='Reservado')")
        .replace("</script>",CLIENT_DELETE_HANDLER+"</script>");
      const headers=new Headers(response.headers);
      headers.delete("content-length");
      return new Response(fixed,{status:response.status,statusText:response.statusText,headers});
    }

    return env.ASSETS.fetch(request);
  }
};
