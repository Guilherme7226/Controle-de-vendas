// Proxy estável do frontend para o Apps Script.
const APPS_SCRIPT_URL = "https://script.google.com/macros/s/AKfycby-E-1j5rfU1eAMWX-5APMTMCK7C_0muyeV4FdM8JlbHTxKL47lqimoVlyuHdV0vcU4/exec";

async function proxyToAppsScript(request) {
  const headers = new Headers();
  const contentType = request.headers.get("content-type");
  const accept = request.headers.get("accept");
  if (contentType) headers.set("content-type", contentType);
  if (accept) headers.set("accept", accept);
  else headers.set("accept", "application/json");

  const init = {method: request.method, headers, redirect: "follow"};
  if (request.method !== "GET" && request.method !== "HEAD") init.body = await request.arrayBuffer();

  const response = await fetch(APPS_SCRIPT_URL, init);
  const responseHeaders = new Headers(response.headers);
  responseHeaders.delete("set-cookie");
  responseHeaders.delete("location");
  responseHeaders.set("cache-control", "no-store, no-cache, must-revalidate");
  return new Response(response.body, {status: response.status, statusText: response.statusText, headers: responseHeaders});
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/api" || url.pathname === "/api/") {
      try { return await proxyToAppsScript(request); }
      catch (error) {
        return new Response(JSON.stringify({ok:false,error:"Falha ao comunicar com o Apps Script: "+String(error && error.message || error)}), {
          status: 502, headers: {"content-type":"application/json; charset=UTF-8","cache-control":"no-store"}
        });
      }
    }
    return env.ASSETS.fetch(request);
  }
};