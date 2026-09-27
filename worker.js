const APPS_SCRIPT_URL = "https://script.google.com/macros/s/AKfycbxfSvv3IiaRxKZIZpWhDd5ZgdIEP4NAyIfpDnWw-zpNjEQg25q2Rbn9NnXkHtEjJiWL/exec";

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === "/api" || url.pathname === "/api/") {
      const init = {
        method: request.method,
        redirect: "follow",
        headers: {}
      };

      const contentType = request.headers.get("content-type");
      if (contentType) init.headers["content-type"] = contentType;

      if (request.method !== "GET" && request.method !== "HEAD") {
        init.body = await request.arrayBuffer();
      }

      const upstream = await fetch(APPS_SCRIPT_URL, init);
      return new Response(upstream.body, {
        status: upstream.status,
        statusText: upstream.statusText,
        headers: upstream.headers
      });
    }

    return env.ASSETS.fetch(request);
  }
};
