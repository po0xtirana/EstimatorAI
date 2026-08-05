import { NextResponse } from "next/server";
import { requireOrganizationContext } from "../../../../../src/auth/org-context";
import { extractScopeFromText } from "../../../../../src/ingestion/scope-extractor";
import { createAdminClient } from "../../../../../src/lib/supabase/admin";

export const dynamic = "force-dynamic";

function tenderId(request: Request) { return new URL(request.url).pathname.split("/").filter(Boolean).at(-2); }

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
    const body = await request.json();
    if (!id || !body.fileName || !body.documentType) return NextResponse.json({ error: "File name and document type are required" }, { status: 400 });
    const { data, error } = await admin.from("tender_documents").insert({ organization_id: ctx.organizationId, tender_id: id, file_name: String(body.fileName).trim(), document_type: body.documentType, version_label: body.versionLabel || null, source_url: body.sourceUrl || null, storage_path: body.storagePath || null, processing_status: body.extractedText ? "processed" : "pending", extracted_text: body.extractedText || null, page_count: body.pageCount ? Number(body.pageCount) : null, metadata: body.metadata ?? {} }).select("*").single();
    if (error) return NextResponse.json({ error: "Failed to save tender document" }, { status: 500 });
    if (data && body.extractedText) {
      const extractedScope = extractScopeFromText(String(body.extractedText));
      if (extractedScope.length) await admin.from("tender_scope_items").insert(extractedScope.map((item) => ({ organization_id: ctx.organizationId, tender_id: id, tender_document_id: data.id, trade_profile_id: body.tradeProfileId ?? null, task_key: item.taskKey, description: item.description, quantity: item.quantity, unit: item.unit, evidence_text: item.evidenceText, confidence: item.confidence, review_status: "needs_review" })));
    }
    return NextResponse.json({ document: data }, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to save document" }, { status: 500 });
  }
}
