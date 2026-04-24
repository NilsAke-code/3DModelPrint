// Guard against re-injection: content.js may be injected multiple times into the
// same tab (once for extract, once for acquire). Without this guard each injection
// adds a new postMessage listener, causing duplicate MW_SIGNED_URL_CAPTURED messages
// that trigger "Receiving end does not exist" errors in the background.
if (!window.__mwContentScriptReady) {
  window.__mwContentScriptReady = true;
  console.log("[MW content] READY — relay listeners attached");

  // ── Relay interceptor messages (MAIN world → background) ───────────────────
  window.addEventListener("message", (event) => {
    if (event.source !== window) return;
    const type = event.data?.type;

    if (type === "MW_REQUEST_OBSERVED") {
      console.log("[MW content] relaying MW_REQUEST_OBSERVED — url:", event.data.url);
      try {
        chrome.runtime.sendMessage({ type: "MW_REQUEST_OBSERVED", url: event.data.url, method: event.data.method });
      } catch (e) {
        console.warn("[MW content] sendMessage MW_REQUEST_OBSERVED failed:", e);
      }
      return;
    }

    if (type === "MW_CAPTCHA_REQUIRED") {
      console.warn("[MW content] relaying MW_CAPTCHA_REQUIRED — captchaId:", event.data.captchaId);
      try {
        chrome.runtime.sendMessage({ type: "MW_CAPTCHA_REQUIRED", captchaId: event.data.captchaId });
      } catch (e) {
        console.warn("[MW content] sendMessage MW_CAPTCHA_REQUIRED failed:", e);
      }
      return;
    }

    if (type === "MW_MODAL_DETECTED") {
      console.log("[MW content] relaying MW_MODAL_DETECTED");
      try {
        chrome.runtime.sendMessage({ type: "MW_MODAL_DETECTED" });
      } catch (e) {
        console.warn("[MW content] sendMessage MW_MODAL_DETECTED failed:", e);
      }
      return;
    }

    if (type === "MW_SIGNED_URL") {
      console.log("[MW content] relaying MW_SIGNED_URL — payload:", event.data);
      try {
        chrome.runtime.sendMessage({ type: "MW_SIGNED_URL_CAPTURED", payload: event.data });
        console.log("[MW content] MW_SIGNED_URL_CAPTURED forwarded to background");
      } catch (e) {
        console.warn("[MW content] sendMessage MW_SIGNED_URL_CAPTURED failed:", e);
      }
    }
  });
}

// ── Internal message handlers (always re-registered — lightweight, idempotent) ──
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  // Readiness ping from background
  if (message.type === "MW_PING") {
    console.log("[MW content] PING received — responding PONG");
    sendResponse({ type: "MW_PONG", ready: true });
    return true;
  }

  if (message.type !== "EXTRACT_MAKERWORLD_METADATA") return false;

  const el = document.getElementById("__NEXT_DATA__");
  if (!el) {
    sendResponse({ error: "NEXT_DATA_MISSING" });
    return true;
  }

  let data;
  try {
    data = JSON.parse(el.textContent || "");
  } catch (e) {
    sendResponse({ error: "PARSE_FAILED", detail: String(e) });
    return true;
  }

  const design = data?.props?.pageProps?.design;
  if (!design) {
    sendResponse({ error: "DESIGN_INFO_MISSING" });
    return true;
  }

  const title = design.title ?? null;
  const summary = design.summary ?? null;
  const coverUrl = design.coverUrl ?? null;
  const coverLandscape = design.coverLandscape ?? null;
  const coverPortrait = design.coverPortrait ?? null;
  const designExtension = design.designExtension ?? null;
  const defaultInstanceId = design.defaultInstanceId ?? null;

  const categories = Array.isArray(design.categories)
    ? design.categories.map((c) => ({ id: c.id ?? 0, name: c.name ?? "", slug: c.slug ?? undefined }))
    : [];
  const instances = Array.isArray(design.instances)
    ? design.instances.map((inst) => ({
        id: inst.id ?? null,
        name: inst.name ?? null,
        designFiles: Array.isArray(inst.designFiles)
          ? inst.designFiles.map((f) => ({ filePath: f.filePath ?? null, type: f.type ?? null }))
          : [],
      }))
    : [];

  // Collect all available source image URLs (deduped by filename, https only)
  const sourceImages = [];
  const seen = new Set();
  function addImg(url) {
    if (url && typeof url === "string") {
      const trimmed = url.trim();
      if (!trimmed.startsWith("https://")) return;
      let key = trimmed;
      try {
        const u = new URL(trimmed);
        const filename = u.pathname.split("/").filter(Boolean).pop() || "";
        key = filename || (u.origin + u.pathname);
      } catch {}
      if (seen.has(key)) return;
      seen.add(key);
      sourceImages.push(trimmed);
    }
  }
  function addFromItem(item) {
    if (typeof item === "string") { addImg(item); return; }
    if (item && typeof item === "object") {
      for (const key of ["url", "pictureUrl", "coverUrl", "src", "thumbnailUrl"]) {
        if (item[key]) addImg(item[key]);
      }
    }
  }

  // ── Gallery DOM scrape (live tab — rendered DOM is available) ────────────
  const GALLERY_SELECTORS = [
    ".swiper-wrapper",
    '[class*="gallery"]',
    '[class*="carousel"]',
    '[class*="slider"]',
  ];
  const CDN_RE_CONTENT  = /makerworld\.com|bambu-lab\.com/i;
  const SKIP_RE_CONTENT = /avatar|icon|logo|badge|profile/i;

  function parseSrcset(srcset) {
    if (!srcset) return null;
    let best = null, bestW = -1;
    for (const part of srcset.split(",")) {
      const [url, desc] = part.trim().split(/\s+/);
      if (!url) continue;
      const w = desc ? parseInt(desc, 10) : 0;
      if (w > bestW) { bestW = w; best = url; }
    }
    return best;
  }

  let galleryContainer = null;
  for (const sel of GALLERY_SELECTORS) {
    const el = document.querySelector(sel);
    if (el) { galleryContainer = el; break; }
  }
  console.log("[MW gallery] container:", galleryContainer
    ? (galleryContainer.className || galleryContainer.tagName) : "NONE");

  if (galleryContainer) {
    for (const img of galleryContainer.querySelectorAll("img")) {
      if (img.naturalWidth > 0 && img.naturalWidth < 200) continue;
      if (SKIP_RE_CONTENT.test(img.src)) continue;
      const ss = img.getAttribute("srcset");
      if (ss) addImg(parseSrcset(ss) || "");
      addImg(img.currentSrc || img.src || img.getAttribute("src") || "");
    }
    for (const source of galleryContainer.querySelectorAll("source[srcset]")) {
      addImg(parseSrcset(source.getAttribute("srcset")) || "");
    }
    for (const vid of galleryContainer.querySelectorAll("video[poster]")) {
      addImg(vid.getAttribute("poster") || "");
    }
    console.log("[MW gallery] images collected from container:", sourceImages.length);
  }

  const ARRAY_KEYS = ["pictures", "images", "gallery", "coverList", "picList",
                      "designPictures", "modelPictures", "renderImages", "previewList"];

  for (const key of ARRAY_KEYS) {
    const arr = design[key];
    if (Array.isArray(arr)) arr.forEach(addFromItem);
  }

  // Instance-level images (per color/variant)
  if (Array.isArray(design.instances)) {
    for (const inst of design.instances) {
      addImg(inst.coverUrl ?? null);
      for (const key of ARRAY_KEYS) {
        const arr = inst[key];
        if (Array.isArray(arr)) arr.forEach(addFromItem);
      }
    }
  }

  sendResponse({
    title,
    summary,
    coverUrl,
    coverLandscape,
    coverPortrait,
    designExtension,
    defaultInstanceId,
    instances,
    sourceImages,
    categories,
  });
  return true;
});
