import { MESSAGE_TYPES } from "../shared/messages.js";
import { loadSettings, saveSettings } from "../shared/storage.js";

const elements = {
  apiKey: document.querySelector("#apiKey"),
  baseUrl: document.querySelector("#baseUrl"),
  model: document.querySelector("#model"),
  targetLanguage: document.querySelector("#targetLanguage"),
  sourceText: document.querySelector("#sourceText"),
  translatedText: document.querySelector("#translatedText"),
  statusMessage: document.querySelector("#statusMessage"),
  saveSettingsButton: document.querySelector("#saveSettingsButton"),
  translatePageButton: document.querySelector("#translatePageButton"),
  restorePageButton: document.querySelector("#restorePageButton"),
  translateButton: document.querySelector("#translateButton"),
  translateForm: document.querySelector("#translateForm")
};

document.addEventListener("DOMContentLoaded", () => {
  void initializePopup();
});

async function initializePopup() {
  try {
    const settings = await loadSettings();
    applySettings(settings);
    bindEvents();
    setStatus("已加载默认设置，可以直接开始测试 popup 翻译。", "success");
  } catch (error) {
    bindEvents();
    setStatus(
      error instanceof Error ? error.message : "初始化失败，请刷新插件重试。",
      "error"
    );
  }
}

function bindEvents() {
  elements.saveSettingsButton.addEventListener("click", () => {
    void handleSaveSettings();
  });

  elements.translateForm.addEventListener("submit", (event) => {
    event.preventDefault();
    void handleTranslate();
  });

  elements.translatePageButton.addEventListener("click", () => {
    void handlePageTranslate();
  });

  elements.restorePageButton.addEventListener("click", () => {
    void handlePageRestore();
  });
}

function applySettings(settings) {
  elements.apiKey.value = settings.apiKey;
  elements.baseUrl.value = settings.baseUrl;
  elements.model.value = settings.model;
  elements.targetLanguage.value = settings.targetLanguage;
}

function collectSettings() {
  return {
    apiKey: elements.apiKey.value,
    baseUrl: elements.baseUrl.value,
    model: elements.model.value,
    targetLanguage: elements.targetLanguage.value
  };
}

async function handleSaveSettings() {
  toggleButtons(true);
  setStatus("正在保存设置...", "default");

  try {
    const settings = await saveSettings(collectSettings());
    applySettings(settings);
    setStatus("设置已保存。", "success");
  } catch (error) {
    setStatus(error instanceof Error ? error.message : "保存设置失败。", "error");
  } finally {
    toggleButtons(false);
  }
}

async function handleTranslate() {
  const text = elements.sourceText.value.trim();

  if (!text) {
    setStatus("请输入需要翻译的文本。", "error");
    elements.translatedText.value = "";
    return;
  }

  toggleButtons(true);
  setStatus("正在保存设置并请求翻译...", "default");
  elements.translatedText.value = "";

  try {
    await saveSettings(collectSettings());

    const response = await chrome.runtime.sendMessage({
      type: MESSAGE_TYPES.TRANSLATE_TEXT,
      payload: { text }
    });

    if (!response?.success) {
      throw new Error(response?.error ?? "翻译失败，请检查接口配置。");
    }

    elements.translatedText.value = response.translatedText;
    setStatus(`翻译完成，目标语言：${response.targetLanguage}。`, "success");
  } catch (error) {
    setStatus(error instanceof Error ? error.message : "翻译失败，请稍后重试。", "error");
  } finally {
    toggleButtons(false);
  }
}

async function handlePageTranslate() {
  toggleButtons(true);
  setStatus("正在保存设置并启动整页翻译...", "default");

  try {
    await saveSettings(collectSettings());

    const response = await chrome.runtime.sendMessage({
      type: MESSAGE_TYPES.REQUEST_PAGE_TRANSLATE
    });

    if (!response?.success) {
      throw new Error(response?.error ?? "整页翻译启动失败。");
    }

    setStatus("整页翻译已开始，请回到网页等待内容更新。", "success");
  } catch (error) {
    setStatus(error instanceof Error ? error.message : "整页翻译启动失败。", "error");
  } finally {
    toggleButtons(false);
  }
}

async function handlePageRestore() {
  toggleButtons(true);
  setStatus("正在恢复网页原文...", "default");

  try {
    const response = await chrome.runtime.sendMessage({
      type: MESSAGE_TYPES.REQUEST_PAGE_RESTORE
    });

    if (!response?.success) {
      throw new Error(response?.error ?? "恢复原文失败。");
    }

    setStatus("网页原文已恢复。", "success");
  } catch (error) {
    setStatus(error instanceof Error ? error.message : "恢复原文失败。", "error");
  } finally {
    toggleButtons(false);
  }
}

function toggleButtons(disabled) {
  elements.saveSettingsButton.disabled = disabled;
  elements.translatePageButton.disabled = disabled;
  elements.restorePageButton.disabled = disabled;
  elements.translateButton.disabled = disabled;
}

function setStatus(message, tone) {
  elements.statusMessage.textContent = message;
  elements.statusMessage.classList.remove("is-error", "is-success");

  if (tone === "error") {
    elements.statusMessage.classList.add("is-error");
  }

  if (tone === "success") {
    elements.statusMessage.classList.add("is-success");
  }
}
