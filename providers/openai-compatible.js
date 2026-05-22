function normalizeBaseUrl(baseUrl) {
  const normalized = String(baseUrl ?? "").trim();

  if (!normalized) {
    throw new Error("请先填写 API Base URL。");
  }

  return normalized.endsWith("/") ? normalized : `${normalized}/`;
}

function extractContent(content) {
  if (typeof content === "string") {
    return content.trim();
  }

  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part?.text === "string") {
          return part.text;
        }

        return "";
      })
      .join("")
      .trim();
  }

  return "";
}

export async function translateText(settings, text) {
  const apiKey = String(settings?.apiKey ?? "").trim();
  const model = String(settings?.model ?? "").trim();
  const targetLanguage = String(settings?.targetLanguage ?? "简体中文").trim();

  if (!apiKey) {
    throw new Error("请先填写 API Key。");
  }

  if (!model) {
    throw new Error("请先填写模型名称。");
  }

  const endpoint = new URL("chat/completions", normalizeBaseUrl(settings?.baseUrl)).toString();
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 30000);

  try {
    const response = await fetch(endpoint, {
      method: "POST",
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model,
        temperature: 0.2,
        messages: [
          {
            role: "system",
            content:
              `你是一个只输出译文的翻译引擎。自动识别源语言，把用户输入翻译成${targetLanguage}。` +
              "保留原文的换行和语气，不要添加解释、标题、引号或额外说明。"
          },
          {
            role: "user",
            content: text
          }
        ]
      })
    });

    const data = await response.json();

    if (!response.ok) {
      const message = data?.error?.message;
      throw new Error(typeof message === "string" ? message : `接口请求失败（${response.status}）。`);
    }

    const translatedText = extractContent(data?.choices?.[0]?.message?.content);

    if (!translatedText) {
      throw new Error("接口已返回响应，但没有取到有效译文。");
    }

    return translatedText;
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new Error("翻译请求超时，请检查网络或接口响应速度。");
    }

    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}

export async function translateTextBatch(settings, texts) {
  const normalizedTexts = Array.isArray(texts)
    ? texts.map((text) => String(text ?? "").trim()).filter(Boolean)
    : [];

  if (normalizedTexts.length === 0) {
    return [];
  }

  const translatedTexts = [];

  for (const text of normalizedTexts) {
    translatedTexts.push(await translateText(settings, text));
  }

  return translatedTexts;
}
