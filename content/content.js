(function initializeTranslator() {
  const MESSAGE_TYPES = Object.freeze({
    TRANSLATE_TEXT: "translate-text",
    TRANSLATE_TEXT_BATCH: "translate-text-batch",
    TRIGGER_SELECTION_TRANSLATE: "trigger-selection-translate",
    TRIGGER_PAGE_TRANSLATE: "trigger-page-translate",
    TRIGGER_PAGE_RESTORE: "trigger-page-restore"
  });

  const OVERLAY_ID = "selection-translator-root";
  const MAX_SELECTION_LENGTH = 1200;
  const MAX_PAGE_NODE_COUNT = 36;
  const MAX_PAGE_TEXT_LENGTH = 280;
  const state = {
    requestId: 0,
    lastSelectionSignature: "",
    selectionChangeTimer: null,
    pageTranslationActive: false,
    originalPageNodes: new Map()
  };

  window.__translatorContentScriptReady = true;

  document.addEventListener("mouseup", handleMouseUp);
  document.addEventListener("selectionchange", handleSelectionChange);
  document.addEventListener("keydown", handleKeyDown);
  document.addEventListener("mousedown", handlePointerDown, true);
  window.addEventListener("scroll", hideOverlay, true);

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type === MESSAGE_TYPES.TRIGGER_SELECTION_TRANSLATE) {
      void translateCurrentSelection({ source: "shortcut" })
        .then((response) => sendResponse(response))
        .catch((error) => {
          sendResponse({
            success: false,
            error: error instanceof Error ? error.message : "划词翻译失败。"
          });
        });

      return true;
    }

    if (message?.type === MESSAGE_TYPES.TRIGGER_PAGE_TRANSLATE) {
      void translateEntirePage()
        .then((response) => sendResponse(response))
        .catch((error) => {
          sendResponse({
            success: false,
            error: error instanceof Error ? error.message : "整页翻译失败。"
          });
        });

      return true;
    }

    if (message?.type === MESSAGE_TYPES.TRIGGER_PAGE_RESTORE) {
      const restored = restoreEntirePage();
      sendResponse(restored);
      return false;
    }

    return undefined;
  });

  function handleMouseUp(event) {
    if (isInsideOverlay(event.target) || state.pageTranslationActive) {
      return;
    }

    window.setTimeout(() => {
      void translateCurrentSelection({ source: "auto", eventTarget: event.target });
    }, 0);
  }

  function handleSelectionChange() {
    if (state.pageTranslationActive) {
      return;
    }

    window.clearTimeout(state.selectionChangeTimer);
    state.selectionChangeTimer = window.setTimeout(() => {
      void translateCurrentSelection({ source: "auto" });
    }, 120);
  }

  function handleKeyDown(event) {
    if (event.key === "Escape") {
      hideOverlay();
      return;
    }

    if ((event.ctrlKey || event.metaKey) && event.shiftKey && event.key.toLowerCase() === "y") {
      event.preventDefault();
      void translateCurrentSelection({ source: "shortcut" });
    }
  }

  function handlePointerDown(event) {
    if (!isInsideOverlay(event.target)) {
      hideOverlay();
    }
  }

  async function translateCurrentSelection(options) {
    const selected = readSelection(options?.eventTarget);

    if (!selected) {
      if (options?.source === "shortcut") {
        showError("请先选中网页中的文本。", null);
      }

      return { success: false, skipped: true };
    }

    if (selected.text.length > MAX_SELECTION_LENGTH) {
      showError("选中文本过长，请缩短后再试。", selected.rect);
      return { success: false, skipped: true };
    }

    const signature = `${selected.text}\n${Math.round(selected.rect.left)}\n${Math.round(selected.rect.top)}`;

    if (options?.source === "auto" && state.lastSelectionSignature === signature) {
      return { success: true, skipped: true };
    }

    state.lastSelectionSignature = signature;
    const requestId = ++state.requestId;
    showLoading(selected.rect, selected.text);

    try {
      const response = await chrome.runtime.sendMessage({
        type: MESSAGE_TYPES.TRANSLATE_TEXT,
        payload: { text: selected.text }
      });

      if (requestId !== state.requestId) {
        return { success: false, skipped: true };
      }

      if (!response?.success) {
        throw new Error(response?.error ?? "划词翻译失败。");
      }

      showTranslation(selected.rect, selected.text, response.translatedText, response.targetLanguage);
      return { success: true };
    } catch (error) {
      if (requestId !== state.requestId) {
        return { success: false, skipped: true };
      }

      showError(error instanceof Error ? error.message : "划词翻译失败。", selected.rect);
      return { success: false, error: error instanceof Error ? error.message : "划词翻译失败。" };
    }
  }

  async function translateEntirePage() {
    const entries = collectPageTextNodes();

    if (entries.length === 0) {
      showError("当前页面没有找到适合翻译的正文文本。", createViewportFallbackRect());
      return { success: false, error: "当前页面没有找到适合翻译的正文文本。" };
    }

    state.pageTranslationActive = true;
    state.requestId += 1;
    const requestId = state.requestId;
    showPageLoading(entries.length);

    try {
      const response = await chrome.runtime.sendMessage({
        type: MESSAGE_TYPES.TRANSLATE_TEXT_BATCH,
        payload: {
          texts: entries.map((entry) => entry.text)
        }
      });

      if (requestId !== state.requestId) {
        return { success: false, skipped: true };
      }

      if (!response?.success) {
        throw new Error(response?.error ?? "整页翻译失败。");
      }

      if (!Array.isArray(response.translatedTexts) || response.translatedTexts.length !== entries.length) {
        throw new Error("整页翻译返回的数据数量不匹配。");
      }

      applyPageTranslations(entries, response.translatedTexts);
      showPageSuccess(entries.length, response.targetLanguage);
      return { success: true, translatedCount: entries.length };
    } catch (error) {
      state.pageTranslationActive = false;
      showError(error instanceof Error ? error.message : "整页翻译失败。", createViewportFallbackRect());
      return { success: false, error: error instanceof Error ? error.message : "整页翻译失败。" };
    }
  }

  function restoreEntirePage() {
    if (state.originalPageNodes.size === 0) {
      showError("当前页面没有可恢复的整页翻译内容。", createViewportFallbackRect());
      return { success: false, error: "当前页面没有可恢复的整页翻译内容。" };
    }

    for (const [node, originalText] of state.originalPageNodes.entries()) {
      if (node.isConnected) {
        node.textContent = originalText;
      }
    }

    state.originalPageNodes.clear();
    state.pageTranslationActive = false;
    showPageRestored();
    return { success: true };
  }

  function collectPageTextNodes() {
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        if (!(node instanceof Text)) {
          return NodeFilter.FILTER_REJECT;
        }

        if (!node.parentElement) {
          return NodeFilter.FILTER_REJECT;
        }

        if (node.parentElement.closest(`#${OVERLAY_ID}`)) {
          return NodeFilter.FILTER_REJECT;
        }

        if (node.parentElement.closest("script, style, noscript, code, pre, svg, textarea, input")) {
          return NodeFilter.FILTER_REJECT;
        }

        const text = normalizePageText(node.textContent);

        if (!text || text.length < 12 || text.length > MAX_PAGE_TEXT_LENGTH) {
          return NodeFilter.FILTER_REJECT;
        }

        if (/^[\d\s.,:%/()\-–—]+$/.test(text)) {
          return NodeFilter.FILTER_REJECT;
        }

        const style = window.getComputedStyle(node.parentElement);

        if (style.display === "none" || style.visibility === "hidden") {
          return NodeFilter.FILTER_REJECT;
        }

        return NodeFilter.FILTER_ACCEPT;
      }
    });

    const entries = [];

    while (walker.nextNode() && entries.length < MAX_PAGE_NODE_COUNT) {
      const node = walker.currentNode;
      const text = normalizePageText(node.textContent);
      entries.push({ node, text });
    }

    return entries;
  }

  function applyPageTranslations(entries, translatedTexts) {
    state.originalPageNodes.clear();

    entries.forEach((entry, index) => {
      if (!entry.node.isConnected) {
        return;
      }

      state.originalPageNodes.set(entry.node, entry.node.textContent);
      entry.node.textContent = translatedTexts[index];
    });

    state.pageTranslationActive = true;
  }

  function readSelection(eventTarget) {
    const selection = document.getSelection();

    if (!selection || selection.rangeCount === 0 || selection.isCollapsed) {
      return null;
    }

    const text = normalizeInlineText(selection.toString());

    if (!text) {
      return null;
    }

    const range = selection.getRangeAt(0);
    const rect = range.getBoundingClientRect();

    if (!rect || (rect.width === 0 && rect.height === 0)) {
      return null;
    }

    if (isEditableSelection(range.commonAncestorContainer, eventTarget)) {
      return null;
    }

    return { text, rect };
  }

  function normalizeInlineText(text) {
    return String(text ?? "")
      .replace(/\s+/g, " ")
      .trim();
  }

  function normalizePageText(text) {
    return String(text ?? "")
      .replace(/\s+/g, " ")
      .trim();
  }

  function isEditableSelection(container, eventTarget) {
    const targetElement = resolveElement(eventTarget) ?? resolveElement(container);

    if (!targetElement) {
      return false;
    }

    return Boolean(
      targetElement.closest("input, textarea, [contenteditable=''], [contenteditable='true']")
    );
  }

  function resolveElement(node) {
    if (!node) {
      return null;
    }

    if (node.nodeType === Node.ELEMENT_NODE) {
      return node;
    }

    return node.parentElement ?? null;
  }

  function isInsideOverlay(target) {
    const element = resolveElement(target);
    return Boolean(element?.closest(`#${OVERLAY_ID}`));
  }

  function ensureOverlay() {
    let overlay = document.getElementById(OVERLAY_ID);

    if (overlay) {
      return overlay;
    }

    overlay = document.createElement("section");
    overlay.id = OVERLAY_ID;
    overlay.className = "selection-translator";
    overlay.innerHTML = `
      <header class="selection-translator__header">
        <div>
          <p class="selection-translator__eyebrow">Selection Translator</p>
          <h2 class="selection-translator__title">翻译助手</h2>
        </div>
        <button class="selection-translator__close" type="button" aria-label="关闭">×</button>
      </header>
      <p class="selection-translator__meta"></p>
      <p class="selection-translator__source"></p>
      <div class="selection-translator__body"></div>
    `;

    overlay.querySelector(".selection-translator__close")?.addEventListener("click", () => {
      hideOverlay();
    });

    document.documentElement.appendChild(overlay);
    return overlay;
  }

  function showLoading(rect, sourceText) {
    const overlay = ensureOverlay();
    overlay.dataset.state = "loading";
    overlay.querySelector(".selection-translator__meta").textContent = "正在翻译选中文本...";
    overlay.querySelector(".selection-translator__source").textContent = clipText(sourceText, 72);
    overlay.querySelector(".selection-translator__body").textContent = "请稍候";
    overlay.hidden = false;
    positionOverlay(overlay, rect);
  }

  function showTranslation(rect, sourceText, translatedText, targetLanguage) {
    const overlay = ensureOverlay();
    overlay.dataset.state = "success";
    overlay.querySelector(".selection-translator__meta").textContent = `已翻译为 ${targetLanguage}`;
    overlay.querySelector(".selection-translator__source").textContent = clipText(sourceText, 72);
    overlay.querySelector(".selection-translator__body").textContent = translatedText;
    overlay.hidden = false;
    positionOverlay(overlay, rect);
  }

  function showPageLoading(count) {
    const overlay = ensureOverlay();
    overlay.dataset.state = "loading";
    overlay.querySelector(".selection-translator__meta").textContent = "正在翻译整页正文...";
    overlay.querySelector(".selection-translator__source").textContent = `准备翻译 ${count} 段正文`; 
    overlay.querySelector(".selection-translator__body").textContent = "页面会逐步更新，请稍候。";
    overlay.hidden = false;
    positionOverlay(overlay, createViewportFallbackRect());
  }

  function showPageSuccess(count, targetLanguage) {
    const overlay = ensureOverlay();
    overlay.dataset.state = "success";
    overlay.querySelector(".selection-translator__meta").textContent = `整页翻译完成 · ${targetLanguage}`;
    overlay.querySelector(".selection-translator__source").textContent = `已更新 ${count} 段正文`;
    overlay.querySelector(".selection-translator__body").textContent = "如果想恢复原文，请回到 popup 点击“恢复原文”。";
    overlay.hidden = false;
    positionOverlay(overlay, createViewportFallbackRect());
  }

  function showPageRestored() {
    const overlay = ensureOverlay();
    overlay.dataset.state = "success";
    overlay.querySelector(".selection-translator__meta").textContent = "网页原文已恢复";
    overlay.querySelector(".selection-translator__source").textContent = "整页翻译状态已清除";
    overlay.querySelector(".selection-translator__body").textContent = "你可以重新执行整页翻译，或继续使用划词翻译。";
    overlay.hidden = false;
    positionOverlay(overlay, createViewportFallbackRect());
  }

  function showError(message, rect) {
    const overlay = ensureOverlay();
    overlay.dataset.state = "error";
    overlay.querySelector(".selection-translator__meta").textContent = "翻译失败";
    overlay.querySelector(".selection-translator__source").textContent = "";
    overlay.querySelector(".selection-translator__body").textContent = message;
    overlay.hidden = false;
    positionOverlay(overlay, rect ?? createViewportFallbackRect());
  }

  function positionOverlay(overlay, rect) {
    const top = rect.bottom + 14;
    const left = rect.left + rect.width / 2;

    overlay.style.top = `${Math.max(12, Math.min(top, window.innerHeight - 24))}px`;
    overlay.style.left = `${Math.max(12, Math.min(left, window.innerWidth - 12))}px`;

    window.requestAnimationFrame(() => {
      const bounds = overlay.getBoundingClientRect();
      const adjustedTop = Math.min(
        Math.max(12, top),
        window.innerHeight - bounds.height - 12
      );
      const adjustedLeft = Math.min(
        Math.max(12, left - bounds.width / 2),
        window.innerWidth - bounds.width - 12
      );

      overlay.style.top = `${adjustedTop}px`;
      overlay.style.left = `${adjustedLeft}px`;
    });
  }

  function createViewportFallbackRect() {
    return {
      left: window.innerWidth / 2 - 10,
      top: 24,
      bottom: 48,
      width: 20,
      height: 24
    };
  }

  function clipText(text, maxLength) {
    if (text.length <= maxLength) {
      return text;
    }

    return `${text.slice(0, maxLength)}…`;
  }

  function hideOverlay() {
    const overlay = document.getElementById(OVERLAY_ID);

    if (overlay) {
      overlay.hidden = true;
    }
  }
})();
