const URL_ONLY_LINE = /^https?:\/\/\S+$/i;

export function isUrlOnlyRecipeInput(text: string): boolean {
  const t = text.trim();
  if (!t) return false;
  const lines = t
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  return lines.length === 1 && URL_ONLY_LINE.test(lines[0]!);
}

function stripTagsToText(html: string): string {
  let s = html.replace(/<script[\s\S]*?<\/script>/gi, " ");
  s = s.replace(/<style[\s\S]*?<\/style>/gi, " ");
  s = s.replace(/<br\s*\/?>/gi, "\n");
  s = s.replace(/<\/(p|div|h[1-6]|li|tr)>/gi, "\n");
  s = s.replace(/<[^>]+>/g, " ");
  s = s.replace(/&nbsp;/gi, " ");
  s = s.replace(/&amp;/g, "&");
  s = s.replace(/&lt;/g, "<");
  s = s.replace(/&gt;/g, ">");
  s = s.replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)));
  s = s.replace(/\s+/g, " ");
  return s.trim();
}

const MAX_BYTES = 1_500_000;
const FETCH_TIMEOUT_MS = 15_000;

function allowedUrl(u: URL): boolean {
  return u.protocol === "http:" || u.protocol === "https:";
}

/**
 * Best-effort fetch of a recipe page as plain text for parsing.
 */
export async function fetchUrlAsRecipePlainText(
  rawUrl: string,
): Promise<{ ok: true; text: string; finalUrl: string } | { ok: false }> {
  let url: URL;
  try {
    url = new URL(rawUrl.trim());
  } catch {
    return { ok: false };
  }
  if (!allowedUrl(url)) return { ok: false };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url.toString(), {
      signal: controller.signal,
      redirect: "follow",
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        Accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
      },
    });
    if (!res.ok) return { ok: false };

    const reader = res.body?.getReader();
    if (!reader) {
      const t = await res.text();
      if (!t || t.length < 80) return { ok: false };
      const plain = stripTagsToText(t).slice(0, 120_000);
      return plain.length >= 40 ? { ok: true, text: plain, finalUrl: res.url } : { ok: false };
    }

    const chunks: Uint8Array[] = [];
    let total = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) {
        total += value.byteLength;
        if (total > MAX_BYTES) {
          await reader.cancel().catch(() => {});
          return { ok: false };
        }
        chunks.push(value);
      }
    }

    const buf = Buffer.concat(chunks.map((c) => Buffer.from(c)));
    const charsetMatch = /charset=([^";]+)/i.exec(res.headers.get("content-type") ?? "");
    const charset = charsetMatch?.[1]?.trim().toLowerCase() ?? "utf-8";
    let html: string;
    try {
      html = new TextDecoder(charset === "utf8" ? "utf-8" : charset).decode(buf);
    } catch {
      html = buf.toString("utf-8");
    }

    const plain = stripTagsToText(html).slice(0, 120_000);
    if (plain.length < 80) return { ok: false };
    return { ok: true, text: plain, finalUrl: res.url };
  } catch {
    return { ok: false };
  } finally {
    clearTimeout(timer);
  }
}

export type ResolvedRecipeInput =
  | { kind: "text"; text: string; sourceUrl: string | null }
  | { kind: "url_blocked" };

export async function resolveVisualiseInput(text: string): Promise<ResolvedRecipeInput> {
  const trimmed = text.trim();
  if (!isUrlOnlyRecipeInput(trimmed)) {
    return { kind: "text", text: trimmed, sourceUrl: null };
  }
  const fetched = await fetchUrlAsRecipePlainText(trimmed);
  if (!fetched.ok) {
    return { kind: "url_blocked" };
  }
  return { kind: "text", text: fetched.text, sourceUrl: fetched.finalUrl };
}
