import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { recordActualLearningEvidence, refreshLearningModel } from "../src/learning/learning-service";
import { createAdminClient } from "../src/lib/supabase/admin";

function loadLocalEnvironment() {
  const file = resolve(process.cwd(), ".env.local");
  if (!existsSync(file)) return;
  for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
    const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (!match || process.env[match[1]]) continue;
    process.env[match[1]] = match[2].trim().replace(/^[\x27"]|[\x27"]$/g, "");
  }
}

async function main() {
  loadLocalEnvironment();
  const admin = createAdminClient();
  if (!admin) throw new Error("Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SECRET_KEY before rebuilding learning models");
  const actuals = await admin.from("contract_actuals").select("*").neq("reconciliation_status", "rejected").order("created_at", { ascending: true });
  if (actuals.error) throw new Error(`Unable to load actuals: ${actuals.error.message}`);
  const profileIds = new Map<string, Set<string>>();
  for (const actual of actuals.data ?? []) {
    const result = await recordActualLearningEvidence(admin, { organizationId: actual.organization_id, contractId: actual.contract_id, actual, createdBy: "learning-rebuild", deferRefresh: true });
    if (!result?.tradeProfileId) continue;
    const profiles = profileIds.get(actual.organization_id) ?? new Set<string>();
    profiles.add(result.tradeProfileId);
    profileIds.set(actual.organization_id, profiles);
  }
  let models = 0;
  for (const [organizationId, profiles] of Array.from(profileIds.entries())) {
    for (const profileId of Array.from(profiles)) {
      await refreshLearningModel(admin, organizationId, profileId, "learning-rebuild");
      models += 1;
    }
  }
  console.log(`Rebuilt ${models} learning model${models === 1 ? "" : "s"} from ${actuals.data?.length ?? 0} actual rows.`);
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
