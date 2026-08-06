import { NextResponse } from "next/server";
import { requireOrganizationContext } from "../../../../../src/auth/org-context";
import { extractPdf, sha256 } from "../../../../../src/ingestion/document-processing";
import { extractScopeFromText } from "../../../../../src/ingestion/scope-extractor";
import { createAdminClient } from "../../../../../src/lib/supabase/admin";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function tenderId(request: Request) { return new URL(request.url).pathname.split("/").filter(Boolean).at(-2); }

function stringValue(value: FormDataEntryValue | null) { return typeof value === "string" ? value : ""; }

export async function GET(request: Request) {
  try {
    const ctx = await requireOrganizationContext();
    const admin = createAdminClient();
    if (!admin) return NextResponse.json({ error: "Supabase admin not configured" }, { status: 500 });
    const id = tenderId(request);
    const { data, error } = await admin.from("tender_documents").select("*").eq("organization_id", ctx.organizationId).eq("tender_id", id).order("created_at", { ascending: false });
    if (error) return NextResponse.json({ error: "Failed to load tender documents" }, { status: 500 });
    return NextResponse.json({ documents: data ?? [] });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to load documents" }, { status: 401 });
  }
}

export async function POST(request: Request) {
  try {
    const ctx = await requireOrganizationContext();
    const admin = createAdminClient();
    if (!admin) return NextResponse.json({ error: "Supabase admin not configured" }, { status: 500 });
    const id = tenderId(request);
    if (!id) return NextResponse.json({ error: "Tender ID is required" }, { status: 400 });

    const contentType = request.headers.get("content-type") ?? "";
    let fileName = "";
    let documentType = "other";
    let versionLabel: string | null = null;
    let sourceUrl: string | null = null;
    let storagePath: string | null = null;
    let tradeProfileId: string | null = null;
    let extractedText = "";
    let pageCount: number | null = null;
    let extractedPages: Array<{ page: number; text: string }> = [];
    let rawBytes: Buffer | null = null;
    let extractionMethod = "manual_text";
    let needsOcr = false;
    let metadata: Record<string, unknown> = {};

    if (contentType.includes("multipart/form-data")) {
      const form = await request.formData();
      const uploaded = form.get("file");
      fileName = stringValue(form.get("fileName")) || (uploaded instanceof File ? uploaded.name : "");
      documentType = stringValue(form.get("documentType")) || "other";
      versionLabel = stringValue(form.get("versionLabel")) || null;
      sourceUrl = stringValue(form.get("sourceUrl")) || null;
      storagePath = stringValue(form.get("storagePath")) || null;
      tradeProfileId = stringValue(form.get("tradeProfileId")) || null;
      if (uploaded instanceof File) {
        rawBytes = Buffer.from(await uploaded.arrayBuffer());
        const isPdf = uploaded.type === "application/pdf" || /\.pdf$/i.test(uploaded.name);
        if (isPdf) {
          const parsed = await extractPdf(rawBytes);
          extractedText = parsed.text;
          pageCount = parsed.pageCount;
          extractedPages = parsed.pages;
          extractionMethod = "pdf_text";
          needsOcr = !extractedText;
        } else {
          extractedText = await uploaded.text();
          extractionMethod = "text_file";
        }
      } else {
        extractedText = stringValue(form.get("extractedText"));
      }
    } else {
      const body = await request.json();
      fileName = typeof body.fileName === "string" ? body.fileName.trim() : "";
      documentType = typeof body.documentType === "string" ? body.documentType : "other";
      versionLabel = body.versionLabel ? String(body.versionLabel) : null;
      sourceUrl = body.sourceUrl ? String(body.sourceUrl) : null;
      storagePath = body.storagePath ? String(body.storagePath) : null;
      tradeProfileId = body.tradeProfileId ? String(body.tradeProfileId) : null;
      extractedText = typeof body.extractedText === "string" ? body.extractedText : "";
      pageCount = body.pageCount ? Number(body.pageCount) : null;
      metadata = body.metadata && typeof body.metadata === "object" ? body.metadata : {};
    }

    if (!fileName || !documentType) return NextResponse.json({ error: "File name and document type are required" }, { status: 400 });
    const hashInput = rawBytes ?? Buffer.from(extractedText, "utf8");
    const fileHash = sha256(hashInput);
    const { data: priorDocuments } = await admin.from("tender_documents").select("id, file_hash, version_label, created_at, metadata").eq("organization_id", ctx.organizationId).eq("tender_id", id).eq("file_name", fileName).order("created_at", { ascending: false });
    const duplicate = (priorDocuments ?? []).find((document) => document.file_hash === fileHash);
    if (duplicate) return NextResponse.json({ document: duplicate, duplicate: true, message: "This document version was already registered." });
    const revision = (priorDocuments?.length ?? 0) + 1;
    const latest = priorDocuments?.[0] ?? null;
    const documentMetadata = { ...metadata, extractionMethod, revision, supersedesDocumentId: latest?.id ?? null, needsOcr };
    const processingStatus = extractedText.trim() ? "processed" : needsOcr ? "needs_review" : "pending";
    const { data, error } = await admin.from("tender_documents").insert({ organization_id: ctx.organizationId, tender_id: id, file_name: fileName, document_type: documentType, version_label: versionLabel, source_url: sourceUrl, storage_path: storagePath, file_hash: fileHash, processing_status: processingStatus, extracted_text: extractedText || null, page_count: pageCount, metadata: documentMetadata }).select("*").single();
    if (error) return NextResponse.json({ error: "Failed to save tender document" }, { status: 500 });
    if (data && extractedText.trim()) {
      const extractedScope = extractedPages.length
        ? extractedPages.flatMap((page) => extractScopeFromText(page.text, page.page))
        : extractScopeFromText(extractedText);
      if (extractedScope.length) await admin.from("tender_scope_items").insert(extractedScope.map((item) => ({ organization_id: ctx.organizationId, tender_id: id, tender_document_id: data.id, trade_profile_id: tradeProfileId, task_key: item.taskKey, description: item.description, quantity: item.quantity, unit: item.unit, source_page: item.sourcePage ?? null, evidence_text: item.evidenceText, confidence: item.confidence, review_status: "needs_review" })));
    }
    return NextResponse.json({ document: data, needsOcr, revision }, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to process document" }, { status: 422 });
  }
}
