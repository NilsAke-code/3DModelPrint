// Injected into world: "MAIN" by the background script.
// Intercepts fetch and XHR to capture the MakerWorld download API response.
// Posts the signed URL to the page via window.postMessage so content.js can relay it.

(function () {
  if (window.__mwInterceptorInstalled) {
    console.log("[MW interceptor] already installed — skipping re-patch");
    return;
  }
  window.__mwInterceptorInstalled = true;
  console.log("[MW interceptor] INSTALLED — patching fetch + XHR");

  // Specific capture pattern for the known download endpoint.
  const CAPTURE_PATTERN = /\/api\/v1\/design-service\/(design\/[^/?]+\/model|instance\/[^/?]+\/f3mf)/;

  // Broad scan pattern — logs ANY potentially download-related request so we can
  // discover what endpoint MakerWorld actually uses if CAPTURE_PATTERN is stale.
  const SCAN_PATTERN = /\/(download|design-service|f3mf|model-file|signed|presigned|zip|stl|cad)/i;

  const POST_TYPE = "MW_SIGNED_URL";

  function postToContent(payload) {
    window.postMessage({ type: POST_TYPE, ...payload }, "*");
  }

  function logBroadScan(method, url, status, text) {
    if (!SCAN_PATTERN.test(url)) return;
    let parsed = null;
    try { parsed = JSON.parse(text); } catch { /* not JSON */ }
    console.log(
      "[MW interceptor] [SCAN]",
      method, url,
      "→ status:", status,
      "| keys:", parsed ? Object.keys(parsed) : "(not JSON)",
      "| preview:", text.slice(0, 300)
    );
  }

  function tryExtractUrl(json) {
    if (!json || typeof json !== "object") return null;
    // Flat paths
    if (typeof json.url === "string" && json.url.startsWith("http")) return json.url;
    if (typeof json.downloadUrl === "string") return json.downloadUrl;
    if (typeof json.signedUrl === "string") return json.signedUrl;
    if (typeof json.fileUrl === "string") return json.fileUrl;
    // Nested under .data
    if (json.data) {
      const d = json.data;
      if (typeof d.url === "string" && d.url.startsWith("http")) return d.url;
      if (typeof d.downloadUrl === "string") return d.downloadUrl;
      if (typeof d.signedUrl === "string") return d.signedUrl;
      if (typeof d.fileUrl === "string") return d.fileUrl;
    }
    // Nested under .result
    if (json.result) {
      const r = json.result;
      if (typeof r.url === "string" && r.url.startsWith("http")) return r.url;
      if (typeof r.downloadUrl === "string") return r.downloadUrl;
      if (typeof r.signedUrl === "string") return r.signedUrl;
      if (typeof r.fileUrl === "string") return r.fileUrl;
    }
    // Deep search: any string value starting with https that looks like a signed URL
    return deepFindSignedUrl(json, 0);
  }

  function deepFindSignedUrl(obj, depth) {
    if (depth > 4 || !obj || typeof obj !== "object") return null;
    for (const key of Object.keys(obj)) {
      const val = obj[key];
      if (typeof val === "string" && val.startsWith("https") && val.includes("?")) {
        // Heuristic: signed URLs contain query params
        return val;
      }
      if (typeof val === "object" && val !== null) {
        const found = deepFindSignedUrl(val, depth + 1);
        if (found) return found;
      }
    }
    return null;
  }

  function handleResponseText(method, url, status, text) {
    // Always run broad scan for discovery
    logBroadScan(method, url, status, text);

    if (!CAPTURE_PATTERN.test(url)) return;

    console.log("[MW interceptor] CAPTURE_MATCH — method:", method, "url:", url, "status:", status);
    console.log("[MW interceptor] raw body (first 500):", text.slice(0, 500));

    // 418 = MakerWorld CAPTCHA challenge. Don't fail — notify background to focus
    // the tab so the user can solve it. Keep listening for the follow-up 200 request.
    if (status === 418) {
      let captchaId = null;
      try { captchaId = JSON.parse(text)?.captchaId ?? null; } catch { /* ok */ }
      console.warn("[MW interceptor] CAPTCHA_REQUIRED — captchaId:", captchaId, "— waiting for user to solve");
      window.postMessage({ type: "MW_CAPTCHA_REQUIRED", captchaId }, "*");
      return; // do NOT post an error — stay alive and keep intercepting
    }

    let json;
    try {
      json = JSON.parse(text);
    } catch (e) {
      console.warn("[MW interceptor] JSON_PARSE_FAILED:", e.message);
      postToContent({
        error: "URL_NOT_FOUND_IN_RESPONSE",
        stage: "JSON_PARSE_FAILED",
        detail: e.message,
        raw: text.slice(0, 500),
      });
      return;
    }

    const topKeys = Object.keys(json);
    console.log("[MW interceptor] response top-level keys:", topKeys);
    console.log("[MW interceptor] full JSON (first 1000):", JSON.stringify(json).slice(0, 1000));

    const signedUrl = tryExtractUrl(json);
    if (signedUrl) {
      console.log("[MW interceptor] SIGNED_URL_FOUND:", signedUrl);
      postToContent({ signedUrl });
    } else {
      console.warn("[MW interceptor] URL_NOT_FOUND — top keys:", topKeys, "full:", JSON.stringify(json).slice(0, 1000));
      postToContent({
        error: "URL_NOT_FOUND_IN_RESPONSE",
        stage: "KEYS_CHECKED",
        keysPresent: topKeys,
        raw: JSON.stringify(json).slice(0, 2000),
      });
    }
  }

  function notifyRequestObserved(method, url) {
    console.log("[MW interceptor] REQUEST_OBSERVED — method:", method, "url:", url);
    window.postMessage({ type: "MW_REQUEST_OBSERVED", url, method }, "*");
  }

  // ── Patch fetch ─────────────────────────────────────────────────────────────
  const _fetch = window.fetch;
  window.fetch = async function (input, init) {
    const url =
      typeof input === "string" ? input
      : input instanceof URL ? input.href
      : input?.url ?? "";
    const method = (init?.method ?? "GET").toUpperCase();

    const response = await _fetch.apply(this, arguments);

    if (CAPTURE_PATTERN.test(url)) {
      notifyRequestObserved(method, url);
      response.clone().text().then((text) => {
        handleResponseText(method, url, response.status, text);
      }).catch((e) => {
        console.warn("[MW interceptor] failed to read fetch response body:", e);
      });
    } else if (SCAN_PATTERN.test(url)) {
      // Log for discovery only (don't await — fire and forget)
      response.clone().text().then((text) => {
        logBroadScan(method, url, response.status, text);
      }).catch(() => {});
    }

    return response;
  };

  // ── Patch XHR ────────────────────────────────────────────────────────────────
  const _open = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function (method, url) {
    this.__mwMethod = (typeof method === "string" ? method : "GET").toUpperCase();
    this.__mwUrl = typeof url === "string" ? url : String(url);
    return _open.apply(this, arguments);
  };

  const _send = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.send = function () {
    const url = this.__mwUrl || "";
    const method = this.__mwMethod || "GET";

    if (CAPTURE_PATTERN.test(url)) {
      notifyRequestObserved(method, url);
      this.addEventListener("load", () => {
        handleResponseText(method, url, this.status, this.responseText);
      });
    } else if (SCAN_PATTERN.test(url)) {
      this.addEventListener("load", () => {
        logBroadScan(method, url, this.status, this.responseText);
      });
    }

    return _send.apply(this, arguments);
  };
})();
