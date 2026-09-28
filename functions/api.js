const APPS_SCRIPT_URL = "https://script.google.com/macros/s/AKfycby-E-1j5rfU1eAMWX-5APMTMCK7C_0muyeV4FdM8JlbHTxKL47lqimoVlyuHdV0vcU4/exec";

function corsHeaders(request) {
  const origin = request.headers.get("Origin");
  return {
    "Access-Control-Allow-Origin": origin || "*",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Vary": "Origin"
  };
}

async function proxyToAppsScript(request) {
  const method = request.method;
  const body = method === "GET" || method === "HEAD" ? undefined : await request.arrayBuffer();
  let target = APPS_SCRIPT_URL;
  const visited = new Set();

  for (let attempt = 0; attempt < 10; attempt++) {
    if (visited.has(target)) {
      return new Response(JSON.stringify({ok:false,error:"Loop de redirecionamento no Apps Script."}), {
        status: 502,
        headers: {"Content-Type":"application/json; charset=utf-8", ...corsHeaders(request)}
      });
    }
    visited.add(target);

    const headers = new Headers();
    const contentType = request.headers.get("Content-Type");
    if (contentType && method !== "GET" && method !== "HEAD") {
      headers.set("Content-Type", contentType);
    }
    const accept = request.headers.get("Accept");
    if (accept) headers.set("Accept", accept);

    const response = await fetch(target, {
      method,
      headers,
      body,
      redirect: "manual"
    });

    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("Location");
      if (!location) {
        return new Response(response.body, {
          status: response.status,
          headers: {...Object.fromEntries(response.headers), ...corsHeaders(request)}
        });
      }
      target = new URL(location, target).toString();
      continue;
    }

    const outHeaders = new Headers(response.headers);
    outHeaders.delete("set-cookie");
    outHeaders.set("Access-Control-Allow-Origin", request.headers.get("Origin") || "*");
    outHeaders.set("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
    outHeaders.set("Access-Control-Allow-Headers", "Content-Type");
    outHeaders.set("Vary", "Origin");

    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers: outHeaders
    });
  }

  return new Response(JSON.stringify({ok:false,error:"Muitos redirecionamentos no Apps Script."}), {
    status: 502,
    headers: {"Content-Type":"application/json; charset=utf-8", ...corsHeaders(request)}
  });
}

export async function onRequest(context) {
  const request = context.request;

  if (request.method === "OPTIONS") {
    return new Response(null, {status: 204, headers: corsHeaders(request)});
  }

  try {
    return await proxyToAppsScript(request);
  } catch (error) {
    return new Response(JSON.stringify({
      ok: false,
      error: "Falha ao conectar ao Apps Script.",
      detail: String(error && error.message ? error.message : error)
    }), {
      status: 502,
      headers: {"Content-Type":"application/json; charset=utf-8", ...corsHeaders(request)}
    });
  }
}
