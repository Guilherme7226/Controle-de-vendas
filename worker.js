const APPS_SCRIPT_URL = "https://script.google.com/macros/s/AKfycby-E-1j5rfU1eAMWX-5APMTMCK7C_0muyeV4FdM8JlbHTxKL47lqimoVlyuHdV0vcU4/exec";

async function proxyToAppsScript(request) {
  let target = APPS_SCRIPT_URL;
  let method = request.method;
  let body;

  if (method !== "GET" && method !== "HEAD") {
    body = await request.arrayBuffer();
  }

  for (let i = 0; i < 5; i++) {
    const headers = new Headers();
    const contentType = request.headers.get("content-type");
    if (method !== "GET" && method !== "HEAD" && contentType) {
      headers.set("content-type", contentType);
    }

    const response = await fetch(target, {
      method,
      headers,
      body,
      redirect: "manual"
    });

    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (!location) return response;

      target = new URL(location, target).toString();

      // Apps Script ContentService first executes doPost/doGet,
      // then redirects to a one-time googleusercontent.com URL
      // containing the generated response. Retrieve that response with GET.
      method = "GET";
      body = undefined;
      continue;
    }

    return response;
  }

  return new Response(
    JSON.stringify({ok:false,error:"Redirecionamento excessivo no Apps Script."}),
    {
      status: 502,
      headers: {"content-type":"application/json;charset=UTF-8"}
    }
  );
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
