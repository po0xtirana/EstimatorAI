import { NextResponse } from "next/server";
import { requireOrganizationContext } from "../../../../../src/auth/org-context";
import { WORKBOOK_MAX_BYTES, type WorkbookKind } from "../../../../../src/learning/estimator-workbook";
import { importEstimatorWorkbook, loadEstimateWorkbookLearning, reviewWorkbookLine } from "../../../../../src/learning/workbook-service";
import { createAdminClient } from "../../../../../src/lib/supabase/admin";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const kinds: WorkbookKind[] = ["labor", "material", "equipment", "subcontractor", "overhead", "risk", "markup", "unknown"];
function estimateId(request: Request) { return new URL(request.url).pathname.split("/").filter(Boolean).at(-2) ?? ""; }

export async function GET(request: Request) {
  try {
    const ctx = await requireOrganizationContext();
    const admin = createAdminClient();
    if (!admin) return NextResponse.json({ error: "Supabase admin not configured" }, { status: 500 });
    return NextResponse.json(await loadEstimateWorkbookLearning(admin, ctx.organizationId, estimateId(request)));
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to load estimator workbook comparisons" }, { status: 401 });
  }
}

export async function POST(request: Request) {
  try {
    const ctx = await requireOrganizationContext();
    if (!["owner", "admin", "estimator"].includes(ctx.role)) return NextResponse.json({ error: "Only an owner, admin, or estimator can upload an estimator workbook" }, { status: 403 });
    const contentLength = Number(request.headers.get("content-length") ?? 0);
    if (contentLength > WORKBOOK_MAX_BYTES + 1024 * 128) return NextResponse.json({ error: "The workbook is larger than the 12 MB upload limit." }, { status: 413 });
    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File)) return NextResponse.json({ error: "Choose an estimator workbook to upload." }, { status: 400 });
    const extension = file.name.toLowerCase().split(".").pop();
    if (!extension || !["xlsx", "xlsm", "csv", "xls"].includes(extension)) return NextResponse.json({ error: "Upload an .xlsx, .xlsm, or .csv estimator workbook." }, { status: 415 });
    const buffer = Buffer.from(await file.arrayBuffer());
    const admin = createAdminClient();
    if (!admin) return NextResponse.json({ error: "Supabase admin not configured" }, { status: 500 });
    const result = await importEstimatorWorkbook(admin, { organizationId: ctx.organizationId, authSubject: ctx.authSubject, estimateId: estimateId(request), fileName: file.name, mimeType: file.type, buffer });
    const learning = await loadEstimateWorkbookLearning(admin, ctx.organizationId, estimateId(request));
    return NextResponse.json({ ...learning, duplicate: result.duplicate }, { status: result.duplicate ? 200 : 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to process estimator workbook";
    return NextResponse.json({ error: message }, { status: /not supported|Upload an/.test(message) ? 415 : /larger|empty/.test(message) ? 413 : 422 });
  }
}

export async function PATCH(request: Request) {
  try {
    const ctx = await requireOrganizationContext();
    if (!["owner", "admin", "estimator"].includes(ctx.role)) return NextResponse.json({ error: "Only an owner, admin, or estimator can review workbook lines" }, { status: 403 });
    const body = await request.json();
    const lineId = typeof body.lineId === "string" ? body.lineId : "";
    const normalizedKind = body.normalizedKind as WorkbookKind;
    if (!lineId || !kinds.includes(normalizedKind)) return NextResponse.json({ error: "A workbook line and cost category are required." }, { status: 400 });
    const admin = createAdminClient();
    if (!admin) return NextResponse.json({ error: "Supabase admin not configured" }, { status: 500 });
    await reviewWorkbookLine(admin, { organizationId: ctx.organizationId, estimateId: estimateId(request), lineId, normalizedKind, accepted: body.accepted !== false });
    return NextResponse.json(await loadEstimateWorkbookLearning(admin, ctx.organizationId, estimateId(request)));
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to review workbook line" }, { status: 422 });
  }
}
