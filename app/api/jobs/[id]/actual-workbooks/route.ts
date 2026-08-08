import { NextResponse } from "next/server";
import { requireOrganizationContext } from "../../../../../src/auth/org-context";
import { importActualJobWorkbook, loadActualJobWorkbook, reviewActualJobWorkbookLine } from "../../../../../src/learning/job-workbook-service";
import { WORKBOOK_MAX_BYTES, type WorkbookKind } from "../../../../../src/learning/estimator-workbook";
import { createAdminClient } from "../../../../../src/lib/supabase/admin";

export const dynamic = "force-dynamic";

function jobId(request: Request) { return new URL(request.url).pathname.split("/").filter(Boolean).at(-2); }

export async function GET(request: Request) {
  try {
    const ctx = await requireOrganizationContext();
    const admin = createAdminClient();
    const id = jobId(request);
    if (!admin) return NextResponse.json({ error: "Supabase admin not configured" }, { status: 500 });
    if (!id) return NextResponse.json({ error: "Job ID is required" }, { status: 400 });
    return NextResponse.json(await loadActualJobWorkbook(admin, ctx.organizationId, id));
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to load job-cost workbooks" }, { status: 401 });
  }
}

export async function POST(request: Request) {
  try {
    const ctx = await requireOrganizationContext();
    if (!["owner", "admin", "estimator"].includes(ctx.role)) return NextResponse.json({ error: "Only an owner, admin, or estimator can import job actuals" }, { status: 403 });
    const admin = createAdminClient();
    const id = jobId(request);
    if (!admin) return NextResponse.json({ error: "Supabase admin not configured" }, { status: 500 });
    if (!id) return NextResponse.json({ error: "Job ID is required" }, { status: 400 });
    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File)) return NextResponse.json({ error: "Choose an Excel or CSV job-cost workbook" }, { status: 400 });
    if (file.size > WORKBOOK_MAX_BYTES) return NextResponse.json({ error: "The workbook is larger than the 12 MB upload limit" }, { status: 413 });
    const controlTotalValue = form.get("controlTotalCents");
    const result = await importActualJobWorkbook(admin, {
      organizationId: ctx.organizationId,
      authSubject: ctx.authSubject,
      contractId: id,
      fileName: file.name,
      mimeType: file.type,
      buffer: Buffer.from(await file.arrayBuffer()),
      finalReconciled: form.get("finalReconciled") === "true",
      controlTotalCents: typeof controlTotalValue === "string" && controlTotalValue ? Number(controlTotalValue) : null
    });
    return NextResponse.json({ ...result, ...(await loadActualJobWorkbook(admin, ctx.organizationId, id)) }, { status: result.duplicate ? 200 : 201 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to process the job-cost workbook" }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  try {
    const ctx = await requireOrganizationContext();
    if (!["owner", "admin", "estimator"].includes(ctx.role)) return NextResponse.json({ error: "Only an owner, admin, or estimator can review job actuals" }, { status: 403 });
    const admin = createAdminClient();
    const id = jobId(request);
    if (!admin) return NextResponse.json({ error: "Supabase admin not configured" }, { status: 500 });
    if (!id) return NextResponse.json({ error: "Job ID is required" }, { status: 400 });
    const body = await request.json();
    const kind = String(body.normalizedKind ?? "unknown") as WorkbookKind;
    if (!body.lineId) return NextResponse.json({ error: "Workbook line ID is required" }, { status: 400 });
    return NextResponse.json(await reviewActualJobWorkbookLine(admin, { organizationId: ctx.organizationId, authSubject: ctx.authSubject, contractId: id, lineId: body.lineId, normalizedKind: kind, accepted: Boolean(body.accepted) }));
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to review the job-cost line" }, { status: 500 });
  }
}
