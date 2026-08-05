export type MonthlyCashflowInput = {
  month: string;
  costCents: number;
  billingCents: number;
};

export type MonthlyCashflow = MonthlyCashflowInput & {
  netCashflowCents: number;
  cumulativeCashflowCents: number;
  marginCents: number;
  marginPercent: number | null;
};

export function projectCashflow(months: MonthlyCashflowInput[]): MonthlyCashflow[] {
  let cumulative = 0;
  return months.map((month) => {
    if (!/^\d{4}-\d{2}$/.test(month.month)) throw new Error(`Invalid month: ${month.month}`);
    if (!Number.isSafeInteger(month.costCents) || month.costCents < 0) throw new Error(`Invalid cost for ${month.month}`);
    if (!Number.isSafeInteger(month.billingCents) || month.billingCents < 0) throw new Error(`Invalid billing for ${month.month}`);
    const net = month.billingCents - month.costCents;
    cumulative += net;
    return { ...month, netCashflowCents: net, cumulativeCashflowCents: cumulative, marginCents: net, marginPercent: month.billingCents ? Math.round((net / month.billingCents) * 10000) / 100 : null };
  });
}

export function portfolioCashflow(projects: Array<{ months: MonthlyCashflowInput[] }>): MonthlyCashflow[] {
  const grouped = new Map<string, MonthlyCashflowInput>();
  for (const project of projects) for (const month of project.months) {
    const current = grouped.get(month.month) ?? { month: month.month, costCents: 0, billingCents: 0 };
    current.costCents += month.costCents;
    current.billingCents += month.billingCents;
    grouped.set(month.month, current);
  }
  return projectCashflow(Array.from(grouped.values()).sort((a, b) => a.month.localeCompare(b.month)));
}
