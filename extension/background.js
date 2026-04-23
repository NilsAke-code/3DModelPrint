// Receives messages from the web app (localhost:5173) via externally_connectable.
chrome.runtime.onMessageExternal.addListener((message, _sender, sendResponse) => {
  if (!message.url) {
    sendResponse({ error: "INVALID_MESSAGE" });
    return true;
  }

  if (message.type === "EXTRACT_MAKERWORLD_METADATA") {
    extractFromUrl(message.url).then(sendResponse).catch((e) =>
      sendResponse({ error: "BACKGROUND_ERROR", detail: String(e) })
    );
    return true;
  }

  if (message.type === "ACQUIRE_MAKERWORLD_FILE") {
    acquireFile(message.url).then(sendResponse).catch((e) =>
      sendResponse({ error: "BACKGROUND_ERROR", detail: String(e) })
    );
    return true;
  }

  sendResponse({ error: "INVALID_MESSAGE" });
  return true;
});

async function extractFromUrl(targetUrl) {
  // Fetch the page HTML directly from the service worker — no tab opened, user stays on web app.
  let html;
  try {
    const res = await fetch(targetUrl);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    html = await res.text();
  } catch (e) {
    return { error: "BACKGROUND_ERROR", detail: String(e) };
  }

  const match = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
  if (!match) return { error: "NEXT_DATA_MISSING" };

  let data;
  try { data = JSON.parse(match[1]); }
  catch (e) { return { error: "PARSE_FAILED", detail: String(e) }; }

  const design = data?.props?.pageProps?.design;
  if (!design) return { error: "DESIGN_INFO_MISSING" };

  const title             = design.title             ?? null;
  const summary           = design.summary           ?? null;
  const coverUrl          = design.coverUrl          ?? null;
  const coverLandscape    = design.coverLandscape    ?? null;
  const coverPortrait     = design.coverPortrait     ?? null;
  const designExtension   = design.designExtension   ?? null;
  const defaultInstanceId = design.defaultInstanceId ?? null;
  const instances = Array.isArray(design.instances)
    ? design.instances.map((inst) => ({
        id: inst.id ?? null,
        name: inst.name ?? null,
        designFiles: Array.isArray(inst.designFiles)
          ? inst.designFiles.map((f) => ({ filePath: f.filePath ?? null, type: f.type ?? null }))
          : [],
      }))
    : [];

  // ── Debug: dump all media-bearing fields so we can see the real structure ──
  const DEBUG_MEDIA_KEYS = [
    "pictures", "images", "gallery", "coverList", "picList",
    "designPictures", "modelPictures", "renderImages", "previewList",
  ];
  console.log("[MW debug] coverUrl:", design.coverUrl);
  console.log("[MW debug] coverLandscape:", design.coverLandscape);
  console.log("[MW debug] coverPortrait:", design.coverPortrait);
  for (const k of DEBUG_MEDIA_KEYS) {
    const v = design[k];
    if (v === undefined) { console.log(`[MW debug] design.${k}: (absent)`); continue; }
    if (!Array.isArray(v)) { console.log(`[MW debug] design.${k}: (not array)`, v); continue; }
    console.log(`[MW debug] design.${k}: ${v.length} items`);
    v.slice(0, 5).forEach((item, i) => console.log(`  [${i}]`, JSON.stringify(item)));
  }
  if (Array.isArray(design.instances)) {
    design.instances.forEach((inst, ii) => {
      console.log(`[MW debug] instance[${ii}] coverUrl:`, inst.coverUrl);
      for (const k of ["pictures", "images", "gallery", "coverList", "picList"]) {
        const v = inst[k];
        if (!Array.isArray(v)) continue;
        console.log(`[MW debug] instance[${ii}].${k}: ${v.length} items`);
        v.slice(0, 3).forEach((item, i) => console.log(`    [${i}]`, JSON.stringify(item)));
      }
    });
  }
  // ── End debug ──

  // Collect all available source image URLs (deduped, https only)
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

  addImg(coverLandscape);
  addImg(coverUrl);
  addImg(coverPortrait);

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

  console.log("[MW extract] sourceImages collected:", sourceImages.length);
  sourceImages.forEach((u, i) => console.log(`  [${i}]`, u));
  return { title, summary, coverUrl, coverLandscape, coverPortrait, designExtension, defaultInstanceId, instances, sourceImages };
}

// ── File acquisition ─────────────────────────────────────────────────────────

const ACQUIRE_TIMEOUT_MS = 20000;
// Extra time given after CAPTCHA is detected — enough for a human to solve it.
const CAPTCHA_EXTRA_MS = 90000;

async function acquireFile(targetUrl) {
  console.log("[MW acquire] ── START ──────────────────────────────────────────");
  console.log("[MW acquire] targetUrl:", targetUrl);

  // Step 1: Find or open tab
  let tabId, windowId, opened;
  try {
    ({ tabId, windowId, opened } = await findOrOpenTab(targetUrl));
    console.log("[MW acquire] TAB_READY — tabId:", tabId, "windowId:", windowId, "opened:", opened);
  } catch (e) {
    console.error("[MW acquire] TAB_OPEN_FAILED:", e);
    return { error: "TAB_OPEN_FAILED", detail: String(e) };
  }

  // Step 2: Inject interceptor into MAIN world (before listener + before click)
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ["interceptor.js"],
      world: "MAIN",
    });
    console.log("[MW acquire] INTERCEPTOR_INJECTED — tabId:", tabId);
  } catch (e) {
    console.error("[MW acquire] INTERCEPTOR_INJECT_FAILED:", e);
    return { error: "INTERCEPTOR_INJECT_FAILED", detail: String(e) };
  }

  // Step 3: Re-inject content.js into ISOLATED world to guarantee a live
  // chrome.runtime context. The declaratively-injected instance may have a stale
  // context if the extension was reloaded since the tab was opened.
  // Clear the guard first so the new injection registers its postMessage listener.
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      func: () => { delete window.__mwContentScriptReady; },
      world: "ISOLATED",
    });
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ["content.js"],
      world: "ISOLATED",
    });
    console.log("[MW acquire] CONTENT_SCRIPT_REINJECTED");
  } catch (e) {
    console.warn("[MW acquire] CONTENT_SCRIPT_REINJECT_FAILED (proceeding):", e);
  }

  // Confirm the newly injected content script is alive
  const contentReady = await pingContentScript(tabId);
  if (contentReady) {
    console.log("[MW acquire] CONTENT_SCRIPT_READY");
  } else {
    console.warn("[MW acquire] CONTENT_SCRIPT_NOT_READY after re-injection — relay may fail");
  }

  // Step 4: Attach signed-URL listener BEFORE triggering the click
  let requestObserved = false;
  let captchaDetected = false;
  let modalDetected = false;
  let modalClickAttempted = false;
  let cancelListener = () => {};

  const signedUrlPromise = new Promise((resolve, reject) => {
    let timerId = setTimeout(handleTimeout, ACQUIRE_TIMEOUT_MS);

    function handleTimeout() {
      cancelListener();
      let stage;
      if (captchaDetected)                              stage = "CAPTCHA_REQUIRED";
      else if (modalClickAttempted && !requestObserved) stage = "REQUEST_NOT_OBSERVED_AFTER_MODAL_CLICK";
      else if (modalDetected && !modalClickAttempted)   stage = "DOWNLOAD_ALL_NOT_FOUND";
      else if (requestObserved)                         stage = "RESPONSE_NOT_OBSERVED";
      else                                              stage = "REQUEST_NOT_OBSERVED";
      console.warn("[MW acquire] TIMEOUT — stage:", stage);
      reject(new Error(stage));
    }

    function listener(msg, sender) {
      if (sender.tab?.id !== tabId) return;

      if (msg.type === "MW_REQUEST_OBSERVED") {
        requestObserved = true;
        if (modalClickAttempted) {
          console.log("[MW acquire] request observed after modal click — url:", msg.url, "method:", msg.method);
        } else {
          console.log("[MW acquire] REQUEST_OBSERVED — url:", msg.url, "method:", msg.method);
        }
        return;
      }

      if (msg.type === "MW_CAPTCHA_REQUIRED") {
        captchaDetected = true;
        console.warn("[MW acquire] CAPTCHA_REQUIRED — captchaId:", msg.captchaId, "— focusing tab, extending timeout by", CAPTCHA_EXTRA_MS, "ms");
        // Extend the timeout: give the user time to solve it.
        clearTimeout(timerId);
        timerId = setTimeout(handleTimeout, CAPTCHA_EXTRA_MS);
        // Focus the MakerWorld tab so the user sees the CAPTCHA modal.
        chrome.tabs.update(tabId, { active: true });
        chrome.tabs.get(tabId).then((tab) => {
          if (tab.windowId) chrome.windows.update(tab.windowId, { focused: true });
        }).catch(() => {});
        return;
      }

      if (msg.type === "MW_MODAL_DETECTED") {
        modalDetected = true;
        console.log("[MW acquire] modal detected — attempting Download All click");
        // Click "Download All" inside the modal — fire and forget (async inside sync listener)
        chrome.scripting.executeScript({
          target: { tabId },
          world: "MAIN",
          func: () => {
            const modals = Array.from(
              document.querySelectorAll('[class*="modal"], [class*="dialog"], [role="dialog"]')
            ).filter((el) => el.offsetParent !== null); // visible only

            for (const modal of modals) {
              const allEls = Array.from(modal.querySelectorAll("span, button, a, div[role='button']"));
              const btn = allEls.find((el) => /download all/i.test(el.innerText?.trim() ?? ""));
              if (btn) {
                console.log("[MW trigger] Download All button found — tag:", btn.tagName, "text:", btn.innerText?.trim());
                btn.focus();
                const opts = { bubbles: true, cancelable: true, view: window };
                btn.dispatchEvent(new PointerEvent("pointerdown", { ...opts, isPrimary: true }));
                btn.dispatchEvent(new MouseEvent("mousedown", { ...opts, buttons: 1 }));
                btn.dispatchEvent(new MouseEvent("mouseup", opts));
                btn.dispatchEvent(new MouseEvent("click", opts));
                return { ok: true };
              }
            }
            console.warn("[MW trigger] DOWNLOAD_ALL_NOT_FOUND — no matching button in visible modals");
            return { ok: false, reason: "button not found" };
          },
        }).then((results) => {
          const res = results?.[0]?.result;
          if (res?.ok) {
            modalClickAttempted = true;
            console.log("[MW acquire] Download All clicked — waiting for signed URL");
          } else {
            console.warn("[MW acquire] DOWNLOAD_ALL_NOT_FOUND — modal visible but button not clickable");
            cancelListener();
            reject(new Error("DOWNLOAD_ALL_NOT_FOUND"));
          }
        }).catch((e) => {
          console.error("[MW acquire] Download All click script failed:", e);
          cancelListener();
          reject(new Error("DOWNLOAD_ALL_NOT_FOUND"));
        });
        return;
      }

      if (msg.type !== "MW_SIGNED_URL_CAPTURED") return;

      clearTimeout(timerId);
      chrome.runtime.onMessage.removeListener(listener);

      console.log("[MW acquire] SIGNED_URL_CAPTURED — payload:", JSON.stringify(msg.payload));

      if (msg.payload?.error) {
        const detail = [
          msg.payload.error,
          msg.payload.stage ? "stage:" + msg.payload.stage : null,
          msg.payload.keysPresent ? "keys:" + JSON.stringify(msg.payload.keysPresent) : null,
          msg.payload.detail ?? null,
        ].filter(Boolean).join(" | ");
        reject(new Error(detail));
      } else {
        resolve(msg.payload.signedUrl);
      }
    }

    chrome.runtime.onMessage.addListener(listener);
    cancelListener = () => {
      clearTimeout(timerId);
      chrome.runtime.onMessage.removeListener(listener);
    };
    console.log("[MW acquire] LISTENER_ATTACHED");
  });

  // Step 5: Trigger download button click
  console.log("[MW acquire] TRIGGERING_CLICK — tabId:", tabId);
  let clickResult;
  try {
    clickResult = await chrome.scripting.executeScript({
      target: { tabId },
      world: "MAIN",
      func: () => {
        // Enumerate candidate elements for debugging
        const allInteractive = Array.from(document.querySelectorAll("span, button, a, div[role='button']"));
        const candidates = allInteractive
          .filter((el) => {
            const text = el.innerText?.trim() ?? "";
            const cls = el.className ?? "";
            return (
              text.toLowerCase().includes("download") ||
              cls.toLowerCase().includes("download") ||
              cls.toLowerCase().includes("primarybutton")
            );
          })
          .map((el) => ({
            tag: el.tagName,
            cls: (el.className ?? "").slice(0, 100),
            text: (el.innerText?.trim() ?? "").slice(0, 60),
          }));

        console.log("[MW trigger] download candidates:", JSON.stringify(candidates));

        // Primary target: span with class containing "primaryButton" and exact text
        const primaryTarget = allInteractive.find(
          (el) =>
            el.tagName === "SPAN" &&
            (el.className ?? "").includes("primaryButton") &&
            el.innerText?.trim() === "Download STL/CAD Files"
        );

        // Fallback: any element whose visible text contains "Download STL"
        const fallbackTarget = !primaryTarget
          ? allInteractive.find((el) =>
              el.innerText?.trim().toLowerCase().includes("download stl")
            )
          : null;

        const target = primaryTarget ?? fallbackTarget;

        if (!target) {
          console.warn("[MW trigger] CLICK_TARGET_NOT_FOUND — candidates:", JSON.stringify(candidates));
          return { error: "CLICK_TARGET_NOT_FOUND", candidates };
        }

        const used = primaryTarget ? "primary" : "fallback";
        console.log("[MW trigger] firing click on", used, "target — tag:", target.tagName, "class:", (target.className ?? "").slice(0, 80), "text:", target.innerText?.trim());

        target.focus();
        const opts = { bubbles: true, cancelable: true, view: window };
        target.dispatchEvent(new PointerEvent("pointerdown", { ...opts, isPrimary: true }));
        target.dispatchEvent(new MouseEvent("mousedown", { ...opts, buttons: 1 }));
        target.dispatchEvent(new MouseEvent("mouseup", opts));
        target.dispatchEvent(new MouseEvent("click", opts));

        return {
          ok: true,
          used,
          element: {
            tag: target.tagName,
            cls: (target.className ?? "").slice(0, 100),
            text: target.innerText?.trim(),
          },
        };
      },
    });
  } catch (e) {
    cancelListener();
    console.error("[MW acquire] SCRIPT_EXECUTE_FAILED:", e);
    if (opened && windowId !== null) chrome.windows.remove(windowId).catch(() => {});
    return { error: "CLICK_SCRIPT_FAILED", detail: String(e) };
  }

  const clickRes = clickResult?.[0]?.result;
  console.log("[MW acquire] CLICK_RESULT:", JSON.stringify(clickRes));

  if (clickRes?.error === "CLICK_TARGET_NOT_FOUND") {
    cancelListener();
    if (opened && windowId !== null) chrome.windows.remove(windowId).catch(() => {});
    return {
      error: "CLICK_TARGET_NOT_FOUND",
      detail: "candidates: " + JSON.stringify(clickRes.candidates ?? []),
    };
  }

  console.log("[MW acquire] primary click succeeded — waiting for request or modal");

  // Inject modal detection polling: runs for up to 1500ms after the primary click.
  // If a visible dialog/modal containing "Download All" appears, posts MW_MODAL_DETECTED.
  chrome.scripting.executeScript({
    target: { tabId },
    world: "MAIN",
    func: () => {
      const POLL_INTERVAL = 200;
      const POLL_MAX = 1500;
      let elapsed = 0;
      const poll = setInterval(() => {
        elapsed += POLL_INTERVAL;
        const modals = Array.from(
          document.querySelectorAll('[class*="modal"], [class*="dialog"], [role="dialog"]')
        ).filter((el) => el.offsetParent !== null);

        for (const modal of modals) {
          const hasDownloadAll = Array.from(
            modal.querySelectorAll("span, button, a, div[role='button']")
          ).some((el) => /download all/i.test(el.innerText?.trim() ?? ""));

          if (hasDownloadAll) {
            clearInterval(poll);
            console.log("[MW trigger] modal with Download All detected — posting MW_MODAL_DETECTED");
            window.postMessage({ type: "MW_MODAL_DETECTED" }, "*");
            return;
          }
        }

        if (elapsed >= POLL_MAX) {
          clearInterval(poll);
        }
      }, POLL_INTERVAL);
    },
  }).catch((e) => {
    console.warn("[MW acquire] modal detection script failed (non-fatal):", e);
  });

  // Step 6: Await signed URL (listener runs until timeout or resolution)
  let signedUrl;
  try {
    signedUrl = await signedUrlPromise;
    console.log("[MW acquire] SUCCESS — signedUrl:", signedUrl);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[MW acquire] FAILED — error:", msg);
    if (opened && windowId !== null) chrome.windows.remove(windowId).catch(() => {});
    // Classify the error into the standard codes
    if (msg.includes("CAPTCHA_REQUIRED")) return { error: "CAPTCHA_REQUIRED", detail: msg };
    if (msg.includes("DOWNLOAD_ALL_NOT_FOUND")) return { error: "DOWNLOAD_ALL_NOT_FOUND", detail: msg };
    if (msg.includes("REQUEST_NOT_OBSERVED_AFTER_MODAL_CLICK")) return { error: "REQUEST_NOT_OBSERVED_AFTER_MODAL_CLICK", detail: msg };
    if (msg.includes("REQUEST_NOT_OBSERVED")) return { error: "REQUEST_NOT_OBSERVED", detail: msg };
    if (msg.includes("RESPONSE_NOT_OBSERVED")) return { error: "RESPONSE_NOT_OBSERVED", detail: msg };
    if (msg.includes("URL_NOT_FOUND_IN_RESPONSE")) return { error: "URL_NOT_FOUND_IN_RESPONSE", detail: msg };
    return { error: "SIGNED_URL_TIMEOUT", detail: msg };
  }

  if (opened && windowId !== null) {
    chrome.windows.remove(windowId).catch(() => {});
  }

  return { signedUrl };
}

// ── Ping content script ───────────────────────────────────────────────────────

async function pingContentScript(tabId) {
  try {
    const response = await chrome.tabs.sendMessage(tabId, { type: "MW_PING" });
    return response?.ready === true;
  } catch {
    return false;
  }
}

// ── Tab management ────────────────────────────────────────────────────────────

// Returns { tabId, windowId, opened }.
// Reuses an existing MakerWorld tab without touching its focus.
// If no matching tab exists, opens one in a separate minimized window so
// the user is never redirected away from the web app.
async function findOrOpenTab(targetUrl) {
  const targetPathname = new URL(targetUrl).pathname;
  // Match by pathname only so hash fragments (e.g. #profileId-...) are ignored.
  const allMwTabs = await chrome.tabs.query({ url: "https://makerworld.com/*" });
  const match = allMwTabs.find((t) => {
    try { return new URL(t.url).pathname === targetPathname; } catch { return false; }
  });

  if (match) {
    console.log("[MW acquire] reusing existing tab:", match.id, "url:", match.url);
    return { tabId: match.id, windowId: null, opened: false };
  }

  console.log("[MW acquire] opening new tab for:", targetUrl);
  const win = await chrome.windows.create({ url: targetUrl, focused: false, state: "minimized" });
  const tabId = win.tabs[0].id;
  await waitForTabLoad(tabId);
  return { tabId, windowId: win.id, opened: true };
}

// Waits for a tab to reach status "complete".
// Checks current status first to avoid a race where the tab loads before
// the onUpdated listener is attached (e.g. cached pages that load instantly).
async function waitForTabLoad(tabId) {
  const tab = await chrome.tabs.get(tabId);
  if (tab.status === "complete") {
    console.log("[MW acquire] tab already complete — skipping wait");
    return;
  }
  return new Promise((resolve) => {
    function onUpdated(id, info) {
      if (id === tabId && info.status === "complete") {
        chrome.tabs.onUpdated.removeListener(onUpdated);
        console.log("[MW acquire] tab load complete — tabId:", tabId);
        resolve();
      }
    }
    chrome.tabs.onUpdated.addListener(onUpdated);
  });
}
