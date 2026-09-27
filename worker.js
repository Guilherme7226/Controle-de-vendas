const APPS_SCRIPT_URL = "https://script.google.com/macros/s/AKfycby-E-1j5rfU1eAMWX-5APMTMCK7C_0muyeV4FdM8JlbHTxKL47lqimoVlyuHdV0vcU4/exec";

async function proxyToAppsScript(request) {
  const headers = new Headers();
  const contentType = request.headers.get("content-type");
  if (contentType) headers.set("content-type", contentType);

  const options = {
    method: request.method,
    headers,
    redirect: "follow"
  };

  if (request.method !== "GET" && request.method !== "HEAD") {
    options.body = await request.arrayBuffer();
  }

  return fetch(APPS_SCRIPT_URL, options);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === "/api" || url.pathname === "/api/") {
      const response = await proxyToAppsScript(request);
      const responseHeaders = new Headers(response.headers);
      responseHeaders.delete("set-cookie");
      responseHeaders.delete("location");

      return new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers: responseHeaders
      });
    }

    return env.ASSETS.fetch(request);
  }
};
