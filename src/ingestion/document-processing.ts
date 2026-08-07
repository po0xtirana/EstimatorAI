import { createHash } from "node:crypto";

export type ExtractedPdfPage = { page: number; text: string };

export type ExtractedPdf = {
  text: string;
  pageCount: number;
  pages: ExtractedPdfPage[];
};

export function sha256(value: Buffer | string): string {
  return createHash("sha256").update(value).digest("hex");
}

export async function extractPdf(buffer: Buffer): Promise<ExtractedPdf> {
  const { PDFParse } = await import("pdf-parse");
  const parser = new PDFParse({ data: buffer });
  try {
    const result = await parser.getText({ parsePageInfo: true });
    const pages = (result.pages ?? []).map((page: { num?: number; text?: string }, index: number) => ({
      page: Number(page.num ?? index + 1),
      text: String(page.text ?? "").trim()
    })).filter((page: ExtractedPdfPage) => page.text.length > 0);
    return { text: String(result.text ?? "").trim(), pageCount: Number(result.total ?? pages.length), pages };
  } finally {
    await parser.destroy();
  }
}

export function absoluteDocumentLinks(baseUrl: string, html: string): string[] {
  const links = new Set<string>();
  const pattern = /href\s*=\s*["']([^"']+)["']/gi;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(html)) !== null) {
    try {
      const url = new URL(match[1], baseUrl).toString();
      if (/\.pdf(?:$|[?#])/i.test(url) || /(?:pdf|attachment|document|download)/i.test(url)) links.add(url);
    } catch {
      // Ignore malformed links from public tender pages.
    }
  }
  return Array.from(links).slice(0, 8);
}

export async function fetchPublicDocument(url: string): Promise<{ url: string; bytes: Buffer; contentType: string } | null> {
  if (!/^https?:\/\//i.test(url)) return null;
  const response = await fetch(url, { redirect: "follow", signal: AbortSignal.timeout(15_000), headers: { accept: "application/pdf,text/html;q=0.9,text/plain;q=0.8,*/*;q=0.1" } });
  if (!response.ok) return null;
  const contentType = response.headers.get("content-type") ?? "";
  const length = Number(response.headers.get("content-length") ?? 0);
  if (length > 15 * 1024 * 1024) return null;
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length > 15 * 1024 * 1024) return null;
  return { url: response.url || url, bytes, contentType };
}
