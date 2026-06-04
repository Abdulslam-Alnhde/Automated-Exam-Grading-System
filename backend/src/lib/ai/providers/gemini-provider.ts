import axios from "axios";
import { AIProvider } from "../provider-interface";
import { AIContentPart, AIRequestOptions, AIResponse } from "../types";

function summarizeAxiosError(err: unknown): string {
  if (!axios.isAxiosError(err)) {
    return err instanceof Error ? err.message : String(err);
  }

  const status = err.response?.status;
  const statusText = err.response?.statusText;
  const data = err.response?.data as any;
  const providerMsg =
    (typeof data?.error === "string" && data.error) ||
    (typeof data?.error?.message === "string" && data.error.message) ||
    (typeof data?.message === "string" && data.message) ||
    "";
  const base = [status, statusText].filter(Boolean).join(" ");
  const detail = providerMsg || err.message || "";
  return [base, detail].filter(Boolean).join(" - ").trim();
}

function extractAssistantTextContent(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";

  return content
    .map((part) => {
      if (typeof part === "string") return part;
      if (part && typeof part === "object") {
        const text = (part as { text?: unknown }).text;
        if (typeof text === "string") return text;
      }
      return "";
    })
    .join("\n")
    .trim();
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function retryAfterMs(err: unknown): number | null {
  if (!axios.isAxiosError(err)) return null;
  const raw = err.response?.headers?.["retry-after"];
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (!value) return null;

  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds > 0) {
    return Math.min(seconds * 1000, 120000);
  }

  const dateMs = Date.parse(value);
  if (Number.isFinite(dateMs)) {
    return Math.min(Math.max(dateMs - Date.now(), 0), 120000);
  }

  return null;
}

/**
 * يحلّل رد Gemini 429 لاستخراج وقت إعادة المحاولة وما إذا كان الحدّ يوميًا.
 * مثال على البنية التي ترسلها Google:
 *   [{"error":{"code":429,"status":"RESOURCE_EXHAUSTED",
 *     "details":[
 *       {"@type":".../RetryInfo","retryDelay":"36s"},
 *       {"@type":".../QuotaFailure","violations":[
 *         {"quotaId":"GenerateRequestsPerDayPerProjectPerModel-FreeTier",...}
 *       ]}
 *     ]}}]
 */
function parseGeminiQuotaInfo(data: unknown): {
  retryAfterMs: number | null;
  isDailyQuota: boolean;
  quotaMetric?: string;
  providerMessage?: string;
} {
  let retryAfterMs: number | null = null;
  let isDailyQuota = false;
  let quotaMetric: string | undefined;
  let providerMessage: string | undefined;

  const root = Array.isArray(data) ? data[0] : data;
  const errorObj =
    root && typeof root === "object" ? (root as any).error ?? root : root;
  if (!errorObj || typeof errorObj !== "object") {
    return { retryAfterMs, isDailyQuota, quotaMetric, providerMessage };
  }

  if (typeof (errorObj as any).message === "string") {
    providerMessage = String((errorObj as any).message);
  }

  const details = Array.isArray((errorObj as any).details)
    ? ((errorObj as any).details as any[])
    : [];

  for (const detail of details) {
    const type = String(detail?.["@type"] || "");

    if (/RetryInfo/i.test(type)) {
      const rawDelay = String(detail?.retryDelay || "").trim();
      const match = rawDelay.match(/^(\d+(?:\.\d+)?)s$/i);
      const seconds = match ? Number(match[1]) : Number.NaN;
      if (Number.isFinite(seconds) && seconds > 0) {
        retryAfterMs = Math.min(Math.ceil(seconds * 1000), 120000);
      }
    }

    if (/QuotaFailure/i.test(type)) {
      const violations = Array.isArray(detail?.violations)
        ? (detail.violations as any[])
        : [];
      for (const violation of violations) {
        const id = String(violation?.quotaId || "");
        const metric = String(violation?.quotaMetric || "");
        if (/PerDay/i.test(id) || /per_day/i.test(metric)) {
          isDailyQuota = true;
        }
        if (!quotaMetric) quotaMetric = metric || id || undefined;
      }
    }
  }

  return { retryAfterMs, isDailyQuota, quotaMetric, providerMessage };
}

export class GeminiProvider implements AIProvider {
  readonly name = "gemini";
  private apiKey: string;
  private baseUrl: string;
  private timeoutMs: number;
  private rateLimitRetries: number;
  private rateLimitBackoffMs: number;

  constructor(
    apiKey: string,
    baseUrl = "https://generativelanguage.googleapis.com/v1beta/openai"
  ) {
    this.apiKey = apiKey;
    this.baseUrl = baseUrl.replace(/\/+$/, "");
    this.timeoutMs = Math.max(
      15000,
      Math.min(600000, Number(process.env.AI_REQUEST_TIMEOUT_MS) || 300000)
    );
    const configuredRateLimitRetries = Number(process.env.GEMINI_RATE_LIMIT_RETRIES);
    this.rateLimitRetries = Math.max(
      0,
      Math.min(
        3,
        Number.isFinite(configuredRateLimitRetries)
          ? configuredRateLimitRetries
          : 1
      )
    );
    this.rateLimitBackoffMs = Math.max(
      10000,
      Math.min(120000, Number(process.env.GEMINI_RATE_LIMIT_BACKOFF_MS) || 65000)
    );
  }

  async generateContent(
    parts: AIContentPart[],
    options: AIRequestOptions
  ): Promise<AIResponse> {
    if (!this.apiKey || !this.apiKey.trim()) {
      throw new Error("GEMINI_API_KEY is missing. Set it in your environment/.env.");
    }

    const messages: any[] = [];

    const systemInstruction = options.systemInstruction ? {
      parts: [{ text: options.systemInstruction }]
    } : undefined;

    const hasImages = parts.some((p) => !!p.image);
    const apiParts: any[] = parts.map((p) => {
      if (p.pdf) {
        throw new Error(
          "Native PDF parts are not supported by the Gemini endpoint here. Convert PDF files before sending them."
        );
      }
      if (p.image) {
        return {
          inlineData: {
            mimeType: p.image.mimeType || "image/jpeg",
            data: p.image.base64,
          },
        };
      }
      return { text: p.text || "" };
    });

    const contents = [
      {
        role: "user",
        parts: apiParts
      }
    ];

    const generationConfig: Record<string, unknown> = {
      temperature: options.temperature,
      maxOutputTokens: options.maxTokens,
    };
    if (options.responseMimeType === "application/json") {
      generationConfig.responseMimeType = "application/json";
    }

    const body: Record<string, unknown> = {
      contents,
      generationConfig,
    };
    if (systemInstruction) {
      body.systemInstruction = systemInstruction;
    }

    // Only Gemini 2.5 "thinking" models honor reasoning_effort. Sending it to
    // non-thinking models (e.g. gemini-2.0-flash) could be rejected, so guard it.
    if (options.reasoningEffort && /2\.5/.test(String(options.model))) {
      body.reasoning_effort = options.reasoningEffort;
    }

    let response;
    // Native endpoint URL
    const nativeUrl = `https://generativelanguage.googleapis.com/v1beta/models/${options.model}:generateContent?key=${this.apiKey}`;
    const headers = { "Content-Type": "application/json" };
    
    for (let attempt = 0; attempt <= this.rateLimitRetries; attempt += 1) {
      try {
        response = await axios.post(nativeUrl, body, {
          headers,
          timeout: this.timeoutMs,
        });
        break;
      } catch (err) {
        const status = axios.isAxiosError(err) ? err.response?.status : undefined;
        const isRateLimited = status === 429;
        const quotaInfo = isRateLimited
          ? parseGeminiQuotaInfo(
              axios.isAxiosError(err) ? err.response?.data : undefined
            )
          : null;

        // الحدّ اليومي للخطة المجانية لا يُصلَح بإعادة المحاولة في الجلسة نفسها،
        // لذلك نتوقّف فورًا ونرفع خطأً مُعَلَّمًا حتى تُجرَّب نماذج أخرى أو يرى
        // المستخدم رسالة واضحة بدل الانتظار 30 ثانية بلا فائدة.
        if (isRateLimited && quotaInfo?.isDailyQuota) {
          const summary = summarizeAxiosError(err);
          if (axios.isAxiosError(err) && err.response?.data) {
            console.error(
              `[gemini] ${status} (daily quota) response body:`,
              typeof err.response.data === "string"
                ? err.response.data.slice(0, 1500)
                : JSON.stringify(err.response.data).slice(0, 1500)
            );
          }
          const retrySeconds = quotaInfo.retryAfterMs
            ? Math.ceil(quotaInfo.retryAfterMs / 1000)
            : null;
          const detail = [
            summary,
            quotaInfo.quotaMetric ? `quota=${quotaInfo.quotaMetric}` : "",
            retrySeconds ? `retry-after=${retrySeconds}s` : "",
            `model=${options.model}`,
          ]
            .filter(Boolean)
            .join(" | ");
          const error = new Error(
            `gemini daily quota exhausted (429). ${detail}`
          ) as Error & {
            isGeminiDailyQuotaExhausted?: boolean;
            isGeminiRateLimited?: boolean;
            retryAfterMs?: number | null;
            quotaMetric?: string;
            modelName?: string;
          };
          error.isGeminiDailyQuotaExhausted = true;
          error.isGeminiRateLimited = true;
          error.retryAfterMs = quotaInfo.retryAfterMs;
          error.quotaMetric = quotaInfo.quotaMetric;
          error.modelName = options.model;
          throw error;
        }

        if (isRateLimited && attempt < this.rateLimitRetries) {
          // وقت الانتظار: نُعطي الأولوية لـ RetryInfo داخل جسم رد Google،
          // ثم لرأس Retry-After، وأخيراً للخلفية الأسية.
          const suggestedMs =
            quotaInfo?.retryAfterMs ??
            retryAfterMs(err) ??
            this.rateLimitBackoffMs * Math.max(1, attempt + 1);
          const delayMs = Math.min(suggestedMs, 120000);
          console.warn(
            `[gemini] rate limited (429). Waiting ${Math.ceil(
              delayMs / 1000
            )}s before retry ${attempt + 2}/${this.rateLimitRetries + 1}.`
          );
          await sleep(delayMs);
          continue;
        }

      const summary = summarizeAxiosError(err);

      if (axios.isAxiosError(err) && err.response?.data) {
        console.error(
          `[gemini] ${status} response body:`,
          typeof err.response.data === "string"
            ? err.response.data.slice(0, 1500)
            : JSON.stringify(err.response.data).slice(0, 1500)
        );
      }

      if (status === 401 || status === 403) {
        throw new Error(`gemini auth error (${status}). ${summary}`);
      }
      if (status === 429) {
        const retrySeconds = quotaInfo?.retryAfterMs
          ? Math.ceil(quotaInfo.retryAfterMs / 1000)
          : null;
        const detail = [
          summary,
          retrySeconds ? `retry-after=${retrySeconds}s` : "",
          `model=${options.model}`,
        ]
          .filter(Boolean)
          .join(" | ");
        const error = new Error(`gemini rate limited (429). ${detail}`) as Error & {
          isGeminiRateLimited?: boolean;
          retryAfterMs?: number | null;
          modelName?: string;
        };
        error.isGeminiRateLimited = true;
        error.retryAfterMs = quotaInfo?.retryAfterMs ?? null;
        error.modelName = options.model;
        throw error;
      }
      if (status && status >= 500) {
        throw new Error(`gemini server error (${status}). ${summary}`);
      }
      if (
        axios.isAxiosError(err) &&
        (err.code === "ECONNABORTED" || /timeout/i.test(summary))
      ) {
        throw new Error(`gemini request timeout. ${summary}`);
      }
      throw new Error(`gemini request failed. ${summary}`);
      }
    }

    if (!response) {
      throw new Error("gemini request failed before receiving a response.");
    }

    const result = response.data;
    // Native API returns candidates[0].content.parts[0].text
    const text = result?.candidates?.[0]?.content?.parts?.[0]?.text;
    
    if (typeof text !== "string" || !text.trim()) {
      const finishReason = result?.candidates?.[0]?.finishReason ?? "";
      if (String(finishReason).toLowerCase() === "max_tokens") {
        throw new Error(
          `gemini response was truncated by the output token limit. Increase maxTokens for this extraction flow.`
        );
      }
      throw new Error(`gemini returned an empty response. finish_reason=${String(finishReason)}.`);
    }
    
    return {
      text,
      raw: result,
      usage: {
        promptTokens: result?.usageMetadata?.promptTokenCount ?? 0,
        completionTokens: result?.usageMetadata?.candidatesTokenCount ?? 0,
        totalTokens: result?.usageMetadata?.totalTokenCount ?? 0,
      },
    };
  }
}
