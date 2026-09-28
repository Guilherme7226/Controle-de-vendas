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

async function handleApi(request) {
  // Autorização e regras de negócio são validadas no Apps Script.
  // O Worker apenas faz o proxy, evitando uma segunda consulta por operação.
  return proxyToAppsScript(request);
}

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
      const fixed=html;
      const headers=new Headers(response.headers);
      headers.delete("content-length");
      return new Response(fixed,{status:response.status,statusText:response.statusText,headers});
    }

    return env.ASSETS.fetch(request);
  }
};
