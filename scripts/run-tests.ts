const tests = [
  "../src/capability/classifier.test.ts",
  "../src/finance/cashflow.test.ts",
  "../src/ingestion/scope-extractor.test.ts",
  "../src/ingestion/canadabuys.test.ts",
  "../src/matching/engine.test.ts",
  "../src/estimation/profile.test.ts",
  "../src/estimation/engine.test.ts",
  "../src/estimation/accuracy.test.ts",
  "../src/learning/estimator-workbook.test.ts",
  "../src/learning/hierarchical-model.test.ts",
  "../src/notifications/match-alert.test.ts"
];

async function main() {
  for (const test of tests) {
    const module = await import(test);
    if (module.default instanceof Promise) await module.default;
  }
  console.log(`Executed ${tests.length} test modules.`);
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
