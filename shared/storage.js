export const DEFAULT_SETTINGS = Object.freeze({
  apiKey: "",
  baseUrl: "https://api.openai.com/v1",
  model: "gpt-4o-mini",
  targetLanguage: "简体中文"
});

export async function loadSettings() {
  const settings = await chrome.storage.local.get(DEFAULT_SETTINGS);

  return {
    ...DEFAULT_SETTINGS,
    ...settings
  };
}

export async function saveSettings(partialSettings) {
  const baseUrl = String(partialSettings?.baseUrl ?? DEFAULT_SETTINGS.baseUrl).trim();
  const model = String(partialSettings?.model ?? DEFAULT_SETTINGS.model).trim();
  const targetLanguage = String(
    partialSettings?.targetLanguage ?? DEFAULT_SETTINGS.targetLanguage
  ).trim();

  const nextSettings = {
    apiKey: String(partialSettings?.apiKey ?? "").trim(),
    baseUrl: baseUrl || DEFAULT_SETTINGS.baseUrl,
    model: model || DEFAULT_SETTINGS.model,
    targetLanguage: targetLanguage || DEFAULT_SETTINGS.targetLanguage
  };

  await chrome.storage.local.set(nextSettings);

  return loadSettings();
}
