import { translateText, translateTextBatch } from "../providers/openai-compatible.js";
import { MESSAGE_TYPES } from "../shared/messages.js";
import { loadSettings } from "../shared/storage.js";

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === MESSAGE_TYPES.TRANSLATE_TEXT) {
    void handleTranslateMessage(message)
      .then((response) => sendResponse(response))
      .catch((error) => {
        sendResponse({
          success: false,
          error: error instanceof Error ? error.message : "翻译失败，请稍后重试。"
        });
      });

    return true;
  }

  if (message?.type === MESSAGE_TYPES.TRANSLATE_TEXT_BATCH) {
    void handleTranslateBatchMessage(message)
      .then((response) => sendResponse(response))
      .catch((error) => {
        sendResponse({
          success: false,
          error: error instanceof Error ? error.message : "批量翻译失败，请稍后重试。"
        });
      });

    return true;
  }

  if (
    message?.type === MESSAGE_TYPES.REQUEST_PAGE_TRANSLATE ||
    message?.type === MESSAGE_TYPES.REQUEST_PAGE_RESTORE
  ) {
    void forwardPageAction(message)
      .then((response) => sendResponse(response))
      .catch((error) => {
        sendResponse({
          success: false,
          error: error instanceof Error ? error.message : "整页翻译请求失败。"
        });
      });

    return true;
  }

  return undefined;
});

chrome.commands.onCommand.addListener((command) => {
  if (command !== MESSAGE_TYPES.TRIGGER_SELECTION_TRANSLATE) {
    return;
  }

  void triggerSelectionTranslation();
});

async function handleTranslateMessage(message) {
  const text = String(message?.payload?.text ?? "").trim();

  if (!text) {
    return {
      success: false,
      error: "请输入需要翻译的文本。"
    };
  }

  try {
    const settings = await loadSettings();
    const translatedText = await translateText(settings, text);

    return {
      success: true,
      translatedText,
      targetLanguage: settings.targetLanguage
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "翻译失败，请稍后重试。"
    };
  }
}

async function handleTranslateBatchMessage(message) {
  const texts = Array.isArray(message?.payload?.texts)
    ? message.payload.texts.map((text) => String(text ?? "").trim()).filter(Boolean)
    : [];

  if (texts.length === 0) {
    return {
      success: false,
      error: "没有可翻译的文本片段。"
    };
  }

  try {
    const settings = await loadSettings();
    const translatedTexts = await translateTextBatch(settings, texts);

    return {
      success: true,
      translatedTexts,
      targetLanguage: settings.targetLanguage
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "批量翻译失败，请稍后重试。"
    };
  }
}

async function triggerSelectionTranslation() {
  const tabId = await getActiveTabId();

  if (!tabId) {
    return;
  }

  try {
    await ensureContentScript(tabId);
    await chrome.tabs.sendMessage(tabId, {
      type: MESSAGE_TYPES.TRIGGER_SELECTION_TRANSLATE
    });
  } catch (_error) {
    // Ignore unsupported pages or tabs without our content script.
  }
}

async function forwardPageAction(message) {
  const targetTabId = message?.payload?.tabId;
  const tabId =
    typeof targetTabId === "number" ? targetTabId : await getLastFocusedPageTabId();

  if (!tabId) {
    return {
      success: false,
      error: "没有找到可用的网页标签页。"
    };
  }

  await ensureContentScript(tabId);

  const response = await chrome.tabs.sendMessage(tabId, {
    type:
      message.type === MESSAGE_TYPES.REQUEST_PAGE_TRANSLATE
        ? MESSAGE_TYPES.TRIGGER_PAGE_TRANSLATE
        : MESSAGE_TYPES.TRIGGER_PAGE_RESTORE
  });

  return response ?? { success: true };
}

async function getActiveTabId() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab?.id ?? null;
}

async function getLastFocusedPageTabId() {
  const tabs = await chrome.tabs.query({ lastFocusedWindow: true });
  const pageTab = tabs.find((tab) =>
    typeof tab.url === "string" && (tab.url.startsWith("http://") || tab.url.startsWith("https://"))
  );

  return pageTab?.id ?? null;
}

async function ensureContentScript(tabId) {
  const [existing] = await chrome.scripting.executeScript({
    target: { tabId },
    func: () => Boolean(window.__translatorContentScriptReady)
  });

  if (existing?.result) {
    return;
  }

  await chrome.scripting.insertCSS({
    target: { tabId },
    files: ["content/content.css"]
  });

  await chrome.scripting.executeScript({
    target: { tabId },
    files: ["content/content.js"]
  });
}
