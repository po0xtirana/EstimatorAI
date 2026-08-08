import { NextRequest, NextResponse } from "next/server";
import { requireOrganizationContext } from "../../../../../src/auth/org-context";
import { newTenderInboxToken, tenderInboxAddress, tenderInboxTokenHash } from "../../../../../src/ingestion/tender-email";
import { createAdminClient } from "../../../../../src/lib/supabase/admin";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function canManage(role: string): boolean { return role === "owner" || role === "admin"; }

export async function POST(request: NextRequest, { params }: { params: Promise<{ sourceKey: string }> }) {
  try {
    const ctx = await requireOrganizationContext();
    if (!canManage(ctx.role)) return NextResponse.json({ error: "Only an owner or admin can manage tender-source connections" }, { status: 403 });
    const { sourceKey } = await params;
    const domain = process.env.TENDER_INBOUND_DOMAIN;
    if (!domain || !process.env.RESEND_API_KEY || !process.env.RESEND_WEBHOOK_SECRET) return NextResponse.json({ error: "Tender inbox receiving is not configured yet. Set TENDER_INBOUND_DOMAIN, RESEND_API_KEY, and RESEND_WEBHOOK_SECRET on the server." }, { status: 503 });
    const admin = createAdminClient();
    if (!admin) return NextResponse.json({ error: "Supabase admin not configured" }, { status: 500 });
    const { data: source, error: sourceError } = await admin.from("tender_sources").select("source_key,name,access_mode,connector_kind,connection_status").eq("source_key", sourceKey).maybeSingle();
    if (sourceError || !source) return NextResponse.json({ error: "Tender source not found" }, { status: 404 });
    if (source.connector_kind === "canadabuys_csv") return NextResponse.json({ error: "CanadaBuys is already connected through its public feed" }, { status: 409 });
    if (source.connection_status === "paused" || sourceKey === "seao") return NextResponse.json({ error: "This source is not available for new connections" }, { status: 409 });

    const body = await request.json().catch(() => ({}));
    const existing = await admin.from("organization_tender_source_connections").select("id,forwarding_address,status").eq("organization_id", ctx.organizationId).eq("source_key", sourceKey).maybeSingle();
    if (existing.data?.forwarding_address && !body.rotate && existing.data.status !== "paused") {
      return NextResponse.json({ connection: existing.data, reused: true });
    }

    const token = newTenderInboxToken();
    const forwardingAddress = tenderInboxAddress(token, domain);
    const payload = {
      organization_id: ctx.organizationId,
      source_key: sourceKey,
      status: "verifying",
      connection_type: "email_forwarding",
      forwarding_address: forwardingAddress,
      secret_hash: tenderInboxTokenHash(token),
      configuration: { intakeProvider: "resend", verification: "first_verified_email", sourceName: source.name },
      last_attempt_at: new Date().toISOString(),
      last_error: null,
      revoked_at: null,
      updated_at: new Date().toISOString()
    };
    const result = await admin.from("organization_tender_source_connections").upsert(payload, { onConflict: "organization_id,source_key" }).select("id,source_key,status,connection_type,forwarding_address,verified_at,last_email_at,processed_email_count,last_error").single();
    if (result.error) return NextResponse.json({ error: "Unable to create the private tender inbox" }, { status: 500 });
    return NextResponse.json({ connection: result.data, reused: false });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to connect tender source" }, { status: 401 });
  }
}

export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ sourceKey: string }> }) {
  try {
    const ctx = await requireOrganizationContext();
    if (!canManage(ctx.role)) return NextResponse.json({ error: "Only an owner or admin can manage tender-source connections" }, { status: 403 });
    const { sourceKey } = await params;
    const admin = createAdminClient();
    if (!admin) return NextResponse.json({ error: "Supabase admin not configured" }, { status: 500 });
    const result = await admin.from("organization_tender_source_connections").update({ status: "paused", forwarding_address: null, secret_hash: null, revoked_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq("organization_id", ctx.organizationId).eq("source_key", sourceKey);
    if (result.error) return NextResponse.json({ error: "Unable to revoke the tender inbox" }, { status: 500 });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to revoke tender source" }, { status: 401 });
  }
}
