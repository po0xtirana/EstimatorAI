import { NextRequest, NextResponse } from "next/server";
import { Resend, type EmailReceivedEvent } from "resend";
import { extractPdf, sha256 } from "../../../../src/ingestion/document-processing";
import { extractScopeFromText } from "../../../../src/ingestion/scope-extractor";
import { normalizeTenderEmail, plainEmailText, tenderInboxTokenHash, tenderInboxTokens } from "../../../../src/ingestion/tender-email";
import { enqueueTenderAnalysisForOrganization, upsertCanonicalTender } from "../../../../src/ingestion/tender-intelligence";
import { applicationPool } from "../../../../src/lib/postgres";
import { createAdminClient } from "../../../../src/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_ATTACHMENTS = 8;
const MAX_ATTACHMENT_BYTES = 15 * 1024 * 1024;

function documentType(filename: string): "specification" | "drawing" | "bill_of_quantities" | "addendum" | "schedule" | "other" {
  if (/addend|amend/i.test(filename)) return "addendum";
  if (/drawing|plan|architect/i.test(filename)) return "drawing";
  if (/boq|bill.?of.?quant|pricing|bid.?form/i.test(filename)) return "bill_of_quantities";
  if (/schedule/i.test(filename)) return "schedule";
  if (/spec/i.test(filename)) return "specification";
  return "other";
}

async function registerExtractedDocument(admin: any, organizationId: string, tenderId: string, input: { name: string; bytes?: Buffer; text: string; pages?: Array<{ page: number; text: string }>; sourceUrl?: string | null; metadata: Record<string, unknown> }) {
  const fileHash = sha256(input.bytes ?? input.text);
  const prior = await admin.from("tender_documents").select("id").eq("organization_id", organizationId).eq("tender_id", tenderId).eq("file_hash", fileHash).maybeSingle();
  if (prior.data) return { inserted: false, scopeCount: 0 };
  const type = input.name.endsWith(".eml.txt") ? "notice" : documentType(input.name);
  const document = await admin.from("tender_documents").insert({
    organization_id: organizationId,
    tender_id: tenderId,
    file_name: input.name.slice(0, 240),
    document_type: type,
    source_url: input.sourceUrl ?? null,
    file_hash: fileHash,
    processing_status: input.text ? "processed" : "needs_review",
    extracted_text: input.text || null,
    page_count: input.pages?.length || null,
    metadata: input.metadata
  }).select("id").single();
  if (document.error || !document.data) throw new Error(`Unable to register ${input.name}`);
  const extracted = input.pages?.length ? input.pages.flatMap((page) => extractScopeFromText(page.text, page.page)) : extractScopeFromText(input.text);
  if (extracted.length) {
    const scope = await admin.from("tender_scope_items").insert(extracted.map((item) => ({
      organization_id: organizationId,
      tender_id: tenderId,
      tender_document_id: document.data.id,
      task_key: item.taskKey,
      description: item.description,
      quantity: item.quantity,
      unit: item.unit,
      source_page: item.sourcePage ?? null,
      evidence_text: item.evidenceText,
      confidence: item.confidence,
      review_status: "needs_review",
      attributes: { extractionMethod: input.metadata.extractionMethod ?? "inbound_email" }
    })));
    if (scope.error) throw new Error(`Unable to save extracted scope from ${input.name}`);
  }
  return { inserted: true, scopeCount: extracted.length };
}

async function downloadAttachment(url: string): Promise<Buffer | null> {
  const response = await fetch(url, { signal: AbortSignal.timeout(20_000), redirect: "follow" });
  if (!response.ok) return null;
  const declared = Number(response.headers.get("content-length") ?? 0);
  if (declared > MAX_ATTACHMENT_BYTES) return null;
  const bytes = Buffer.from(await response.arrayBuffer());
  return bytes.length <= MAX_ATTACHMENT_BYTES ? bytes : null;
}

export async function POST(request: NextRequest) {
  const webhookSecret = process.env.RESEND_WEBHOOK_SECRET;
  const apiKey = process.env.RESEND_API_KEY;
  const admin = createAdminClient();
  if (!webhookSecret || !apiKey || !admin) return NextResponse.json({ error: "Tender email intake is not configured" }, { status: 503 });
  const payload = await request.text();
  const eventId = request.headers.get("svix-id");
  const timestamp = request.headers.get("svix-timestamp");
  const signature = request.headers.get("svix-signature");
  if (!eventId || !timestamp || !signature) return NextResponse.json({ error: "Missing webhook signature" }, { status: 400 });
  const resend = new Resend(apiKey);
  let event: EmailReceivedEvent;
  try {
    const verified = resend.webhooks.verify({ payload, headers: { id: eventId, timestamp, signature }, webhookSecret });
    if (verified.type !== "email.received") return NextResponse.json({ accepted: true, ignored: verified.type });
    event = verified;
  } catch {
    return NextResponse.json({ error: "Invalid webhook signature" }, { status: 401 });
  }

  const tokens = tenderInboxTokens([...event.data.to, ...(event.data.received_for ?? [])]);
  let connection: any = null;
  for (const token of tokens) {
    const candidate = await admin.from("organization_tender_source_connections").select("id,organization_id,source_key,status").eq("secret_hash", tenderInboxTokenHash(token)).in("status", ["verifying", "connected", "error"]).maybeSingle();
    if (candidate.data) { connection = candidate.data; break; }
  }
  if (!connection) return NextResponse.json({ accepted: true, ignored: "unknown_or_revoked_address" });

  const existing = await admin.from("tender_email_events").select("id,status,tender_id").eq("provider", "resend").eq("provider_event_id", eventId).maybeSingle();
  if (existing.data?.status === "processed") return NextResponse.json({ accepted: true, duplicate: true, tenderId: existing.data.tender_id });
  if (existing.data?.status === "processing") return NextResponse.json({ accepted: true, processing: true }, { status: 202 });
  let intakeId = existing.data?.id as string | undefined;
  if (intakeId) {
    await admin.from("tender_email_events").update({ status: "processing", last_error: null, updated_at: new Date().toISOString() }).eq("id", intakeId);
  } else {
    const inserted = await admin.from("tender_email_events").insert({ organization_id: connection.organization_id, connection_id: connection.id, source_key: connection.source_key, provider_event_id: eventId, provider_email_id: event.data.email_id, message_id: event.data.message_id, sender: event.data.from, recipients: event.data.to, subject: event.data.subject, status: "processing", attachment_count: event.data.attachments?.length ?? 0, received_at: event.data.created_at, metadata: { receivedFor: event.data.received_for ?? [] } }).select("id").single();
    if (inserted.error || !inserted.data) {
      if (inserted.error?.code === "23505") return NextResponse.json({ accepted: true, duplicate: true });
      return NextResponse.json({ error: "Unable to register tender email" }, { status: 500 });
    }
    intakeId = inserted.data.id;
  }

  try {
    const received = await resend.emails.receiving.get(event.data.email_id, { html_format: "cid" });
    if (received.error || !received.data) throw new Error(received.error?.message ?? "Unable to retrieve tender email");
    const email = received.data;
    const normalized = normalizeTenderEmail({ sourceKey: connection.source_key, emailId: email.id, messageId: email.message_id, sender: email.from, subject: email.subject, createdAt: email.created_at, text: email.text, html: email.html, attachmentCount: email.attachments.length });
    const client = await applicationPool().connect();
    let canonical;
    try {
      await client.query("begin");
      canonical = await upsertCanonicalTender(client, normalized);
      await enqueueTenderAnalysisForOrganization(client, canonical, connection.organization_id, { force: true });
      await client.query("commit");
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }

    const body = plainEmailText(email.text, email.html);
    let scopeCount = 0;
    if (body) {
      const notice = await registerExtractedDocument(admin, connection.organization_id, canonical.tenderId, { name: `email-${email.id}.eml.txt`, text: body, metadata: { extractionMethod: "verified_inbound_email", provider: "resend", emailId: email.id, messageId: email.message_id, sender: email.from } });
      scopeCount += notice.scopeCount;
    }
    const attachmentErrors: string[] = [];
    for (const attachment of email.attachments.slice(0, MAX_ATTACHMENTS)) {
      if (!/pdf/i.test(attachment.content_type) && !/\.pdf$/i.test(attachment.filename ?? "")) continue;
      try {
        const signed = await resend.emails.receiving.attachments.get({ emailId: email.id, id: attachment.id });
        if (signed.error || !signed.data) throw new Error(signed.error?.message ?? "Attachment URL unavailable");
        const bytes = await downloadAttachment(signed.data.download_url);
        if (!bytes) throw new Error("Attachment download failed or exceeded 15 MB");
        const parsed = await extractPdf(bytes);
        const saved = await registerExtractedDocument(admin, connection.organization_id, canonical.tenderId, { name: attachment.filename ?? `tender-attachment-${attachment.id}.pdf`, bytes, text: parsed.text, pages: parsed.pages, metadata: { extractionMethod: "verified_inbound_pdf", provider: "resend", emailId: email.id, attachmentId: attachment.id, needsOcr: !parsed.text } });
        scopeCount += saved.scopeCount;
      } catch (error) {
        attachmentErrors.push(`${attachment.filename ?? attachment.id}: ${error instanceof Error ? error.message : "processing failed"}`);
      }
    }
    const now = new Date().toISOString();
    await admin.from("tender_email_events").update({ status: "processed", tender_id: canonical.tenderId, processed_at: now, updated_at: now, metadata: { receivedFor: event.data.received_for ?? [], scopeCount, attachmentErrors }, last_error: attachmentErrors.length ? attachmentErrors.join("; ").slice(0, 2000) : null }).eq("id", intakeId);
    const connectionUpdate: Record<string, unknown> = { status: "connected", last_email_at: now, last_success_at: now, last_error: attachmentErrors.length ? "Tender received; one or more attachments need review" : null, updated_at: now };
    if (connection.status !== "connected") connectionUpdate.verified_at = now;
    await admin.from("organization_tender_source_connections").update(connectionUpdate).eq("id", connection.id);
    await admin.rpc("increment_tender_connection_email_count", { connection_id_input: connection.id });
    return NextResponse.json({ accepted: true, tenderId: canonical.tenderId, scopeCount, attachmentErrors: attachmentErrors.length });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Tender email processing failed";
    await admin.from("tender_email_events").update({ status: "failed", last_error: message.slice(0, 2000), updated_at: new Date().toISOString() }).eq("id", intakeId);
    await admin.from("organization_tender_source_connections").update({ status: "error", last_error: message.slice(0, 1000), last_attempt_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq("id", connection.id);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
