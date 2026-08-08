import { createHash, randomBytes } from "node:crypto";
import type { NormalizedTender } from "./canadabuys";

const TENDER_TERMS = /\b(tender|rfp|rfq|rfsq|itt|bid|procurement|solicitation|construction|renovation|restoration|roof|painting|fit[- ]?out)\b/i;
const CONSTRUCTION_TERMS = /\b(construction|renovation|restoration|roof|painting|fit[- ]?out|drywall|demolition|contractor)\b/i;

export function newTenderInboxToken(): string {
  return randomBytes(18).toString("base64url");
}

export function tenderInboxTokenHash(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function tenderInboxAddress(token: string, domain: string): string {
  const cleanDomain = domain.trim().toLowerCase().replace(/^@/, "");
  if (!/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(cleanDomain)) throw new Error("A valid TENDER_INBOUND_DOMAIN is required");
  return `tender-${token}@${cleanDomain}`;
}

export function tenderInboxTokens(recipients: string[]): string[] {
  return recipients.flatMap((recipient) => {
    const match = recipient.toLowerCase().match(/(?:^|[<\s])tender-([a-z0-9_-]{20,})@/i);
    return match ? [match[1]] : [];
  });
}

function decodeHtml(value: string): string {
  const entities: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };
  return value.replace(/&(#x?[0-9a-f]+|amp|lt|gt|quot|apos|nbsp);/gi, (_, entity: string) => {
    if (entity[0] === "#") {
      const hex = entity[1]?.toLowerCase() === "x";
      const code = Number.parseInt(entity.slice(hex ? 2 : 1), hex ? 16 : 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : " ";
    }
    return entities[entity.toLowerCase()] ?? " ";
  });
}

export function plainEmailText(text: string | null | undefined, html: string | null | undefined): string {
  if (text?.trim()) return text.replace(/\r\n/g, "\n").trim();
  if (!html) return "";
  return decodeHtml(html
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<(?:br|\/p|\/div|\/li|\/tr|\/h[1-6])\s*>/gi, "\n")
    .replace(/<[^>]+>/g, " "))
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function emailLinks(text: string, html: string | null | undefined): string[] {
  const candidates = `${text}\n${html ?? ""}`.match(/https?:\/\/[^\s<>"')\]]+/gi) ?? [];
  return Array.from(new Set(candidates.map((url) => decodeHtml(url).replace(/[.,;:]$/, "")))).slice(0, 20);
}

function cleanSubject(subject: string): string {
  return subject.replace(/^\s*((re|fw|fwd)\s*:\s*)+/i, "").replace(/\s+/g, " ").trim().slice(0, 500) || "Tender invitation";
}

function solicitationNumber(subject: string, body: string): string | null {
  const input = `${subject}\n${body.slice(0, 3000)}`;
  const labelled = input.match(/(?:solicitation|tender|rfp|rfq|rfsq|itt|bid)(?:\s+(?:no|number|id))?\s*[#:]?\s*([a-z0-9][a-z0-9._/-]{3,})/i);
  return labelled?.[1]?.replace(/[.,;:]$/, "").toUpperCase() ?? null;
}

function closingTimestamp(input: string): string | null {
  const labelled = input.match(/(?:closing|closes|deadline|due)(?:\s+(?:date|on|by))?\s*[:\-]?\s*((?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s+\d{1,2},?\s+20\d{2}(?:\s+(?:at\s+)?\d{1,2}:\d{2}\s*(?:am|pm)?)?|20\d{2}-\d{2}-\d{2}(?:[t\s]\d{1,2}:\d{2}(?::\d{2})?)?)/i);
  if (!labelled) return null;
  const value = labelled[1].replace(/\s+at\s+/i, " ");
  const hasZone = /(?:z|[+-]\d{2}:?\d{2}|\b(?:est|edt)\b)$/i.test(value);
  const month = value.match(/^(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)/i)?.[1]?.toLowerCase();
  const easternOffset = month && ["mar", "apr", "may", "jun", "jul", "aug", "sep", "oct"].includes(month) ? "GMT-0400" : "GMT-0500";
  const explicit = hasZone ? value : /^20\d{2}-\d{2}-\d{2}/.test(value) ? `${value}-04:00` : `${value} ${easternOffset}`;
  const parsed = Date.parse(explicit);
  return Number.isNaN(parsed) ? null : new Date(parsed).toISOString();
}

function buyerName(sender: string): string | null {
  const display = sender.match(/^\s*"?([^"<]+?)"?\s*</)?.[1]?.trim();
  if (display && !display.includes("@")) return display.slice(0, 250);
  const domain = sender.match(/@([^>\s]+)/)?.[1]?.split(".")[0];
  return domain ? domain.replace(/[-_]+/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase()) : null;
}

export type InboundTenderEmail = {
  sourceKey: string;
  emailId: string;
  messageId: string;
  sender: string;
  subject: string;
  createdAt: string;
  text: string | null;
  html: string | null;
  attachmentCount: number;
};

export function normalizeTenderEmail(email: InboundTenderEmail): NormalizedTender {
  const body = plainEmailText(email.text, email.html);
  const title = cleanSubject(email.subject);
  const solicitation = solicitationNumber(title, body);
  const links = emailLinks(body, email.html);
  const sourceUrl = links.find((url) => !/resend\.(?:com|dev)/i.test(url)) ?? null;
  const combined = `${title}\n${body}`;
  return {
    source: email.sourceKey,
    sourceRecordId: solicitation ?? email.messageId ?? email.emailId,
    solicitationNumber: solicitation,
    title: { en: title, fr: null },
    description: { en: body.slice(0, 12_000) || null, fr: null },
    buyerName: buyerName(email.sender),
    procurementCategory: CONSTRUCTION_TERMS.test(combined) ? "construction" : TENDER_TERMS.test(combined) ? "unknown" : "other",
    procurementCode: null,
    estimatedValueCents: null,
    currency: "CAD",
    publishedAt: email.createdAt,
    closingAt: closingTimestamp(combined),
    sourceUrl,
    rawPayload: {
      received_email_id: email.emailId,
      message_id: email.messageId,
      sender: email.sender,
      attachment_count: String(email.attachmentCount),
      links: JSON.stringify(links),
      revision: email.messageId
    }
  };
}
