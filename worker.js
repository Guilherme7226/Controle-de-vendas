export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === "/supabase-config") {
      return new Response(JSON.stringify({
        url: env.SUPABASE_URL || "https://lsevhjjklsnqegrpkiku.supabase.co",
        key: env.SUPABASE_PUBLISHABLE_KEY || ""
      }), {
        headers: {
          "content-type": "application/json; charset=UTF-8",
          "cache-control": "no-store"
        }
      });
    }

    const assetResponse = await env.ASSETS.fetch(request);
    const contentType = assetResponse.headers.get("content-type") || "";
    if (contentType.includes("text/html")) {
      const headers = new Headers(assetResponse.headers);
      headers.set("cache-control", "no-store, no-cache, must-revalidate, max-age=0");
      headers.set("pragma", "no-cache");
      return new Response(assetResponse.body, {
        status: assetResponse.status,
        statusText: assetResponse.statusText,
        headers
      });
    }
    return assetResponse;
  }
};