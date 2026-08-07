import { readdir } from "node:fs/promises";

async function main() {
  const files = (await readdir("supabase/migrations")).filter((file) => file.endsWith(".sql")).sort();
  if (!files.length) throw new Error("No canonical Supabase migrations found");
  const prefixes = files.map((file) => file.split("_")[0]);
  const duplicates = prefixes.filter((prefix, index) => index > 0 && prefix === prefixes[index - 1]);
  if (duplicates.length) throw new Error(`Duplicate migration prefixes found: ${duplicates.join(", ")}`);
  console.log(`Verified ${files.length} canonical Supabase migrations.`);
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
