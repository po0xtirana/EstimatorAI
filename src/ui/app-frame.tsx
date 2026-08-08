"use client";

import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

const navGroups = [
  { label: "Work queue", items: [{ label: "Bid cockpit", href: "/" }, { label: "Opportunities", href: "/tenders" }, { label: "Tender sources", href: "/tender-sources" }, { label: "Estimates", href: "/estimates" }] },
  { label: "Company model", items: [{ label: "Operating model", href: "/trade-profiles" }, { label: "People & capacity", href: "/team" }] },
  { label: "Performance", items: [{ label: "Jobs & learning", href: "/jobs" }, { label: "Reports", href: "/reports" }, { label: "Settings", href: "/settings" }] }
];
const navItems = navGroups.flatMap((group) => group.items);

export default function AppFrame({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [previewMode, setPreviewMode] = useState(false);
  const [organizationName, setOrganizationName] = useState("Workspace");
  const activeNav = navItems.find((item) => pathname === item.href || (item.href !== "/" && pathname.startsWith(`${item.href}/`)));
  useEffect(() => setPreviewMode(document.cookie.includes("estimator_preview=1")), []);
  useEffect(() => { if (!pathname.startsWith("/login") && !pathname.startsWith("/onboarding") && !pathname.startsWith("/auth")) fetch("/api/company/readiness").then(async (response) => { if (!response.ok) return; const data = await response.json(); setOrganizationName(data.readiness?.organizationName ?? (document.cookie.includes("estimator_preview=1") ? "Preview workspace" : "Workspace")); }).catch(() => undefined); }, [pathname]);
  if (pathname.startsWith("/login") || pathname.startsWith("/onboarding") || pathname.startsWith("/auth") || pathname.startsWith("/pricing")) return children;
  return <main className="shell"><aside className="sidebar"><div className="brand"><span className="brand-mark">E</span><span>EstimatorAI</span></div><div className="workspace-label"><span className="workspace-dot" /> Contractor workspace</div><div className="nav-groups">{navGroups.map((group) => <div className="nav-group" key={group.label}><p className="sidebar-label">{group.label}</p><nav aria-label={group.label}>{group.items.map((item) => { const isActive = activeNav?.href === item.href; return <a className={isActive ? "nav-item active" : "nav-item"} href={item.href} key={item.href} aria-current={isActive ? "page" : undefined}><span>{item.label}</span>{isActive && <span className="nav-arrow" aria-hidden="true">↗</span>}</a>; })}</nav></div>)}</div><div className="sidebar-footer"><p className="sidebar-footer-kicker">EstimatorAI</p><p>Built for confident bids.</p><p>Private company workspace</p></div></aside><section className="content">{previewMode && <div className="preview-banner"><strong>Local preview mode</strong><span>Temporary access for reviewing the interface. Sign-in is still required for real company data.</span><a href="/preview?exit=1">Exit preview</a></div>}{pathname !== "/" && <header className="topbar"><div><p className="eyebrow">EstimatorAI workspace</p><h1>{activeNav?.label ?? "Workspace"}</h1></div><div className="org-chip"><span className="org-chip-label">Company</span><strong>{organizationName}</strong></div></header>}{children}</section></main>;
}
