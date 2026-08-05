import { portfolioCashflow, projectCashflow } from "./cashflow";

const result = projectCashflow([{ month: "2026-08", costCents: 7000, billingCents: 10000 }, { month: "2026-09", costCents: 3000, billingCents: 0 }]);
if (result[0].netCashflowCents !== 3000 || result[0].marginPercent !== 30 || result[1].cumulativeCashflowCents !== 0) throw new Error("cashflow math failed");
if (portfolioCashflow([{ months: [{ month: "2026-08", costCents: 100, billingCents: 200 }] }, { months: [{ month: "2026-08", costCents: 50, billingCents: 100 }] }])[0].billingCents !== 300) throw new Error("portfolio rollup failed");
