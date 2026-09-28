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

function jsonResponse(data, status, request) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      ...corsHeaders(request)
    }
  });
}

async function proxyToAppsScript(request) {
  const method = request.method;
  const body = method === "GET" || method === "HEAD"
    ? undefined
    : await request.text();

  const headers = new Headers();
  headers.set("Accept", "application/json");
  if (body !== undefined) {
    headers.set("Content-Type", "text/plain;charset=UTF-8");
  }

  const response = await fetch(APPS_SCRIPT_URL, {
    method,
    headers,
    body,
    redirect: "follow",
    cf: { cacheTtl: 0, cacheEverything: false }
  });

  const text = await response.text();

  if (!text.trim()) {
    return jsonResponse({
      ok: false,
      error: "O Apps Script respondeu vazio.",
      status: response.status
    }, 502, request);
  }

  try {
    return jsonResponse(JSON.parse(text), response.status, request);
  } catch (_) {
    return jsonResponse({
      ok: false,
      error: "O Apps Script não retornou JSON válido.",
      status: response.status,
      detail: text.slice(0, 1000)
    }, 502, request);
  }
}

export async function onRequest(context) {
  const request = context.request;

  if (request.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: corsHeaders(request)
    });
  }

  try {
    return await proxyToAppsScript(request);
  } catch (error) {
    return jsonResponse({
      ok: false,
      error: "Falha ao conectar ao Apps Script.",
      detail: String(error && error.message ? error.message : error)
    }, 502, request);
  }
}
