"use client";

import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

const navItems = [{ label: "Bid cockpit", href: "/" }, { label: "Opportunities", href: "/tenders" }, { label: "Estimates", href: "/estimates" }, { label: "Operating model", href: "/trade-profiles" }, { label: "People & capacity", href: "/team" }, { label: "Jobs & learning", href: "/jobs" }, { label: "Reports", href: "/reports" }];

export default function AppFrame({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [previewMode, setPreviewMode] = useState(false);
  const [organizationName, setOrganizationName] = useState("Workspace");
  useEffect(() => setPreviewMode(document.cookie.includes("estimator_preview=1")), []);
  useEffect(() => { if (!pathname.startsWith("/login") && !pathname.startsWith("/onboarding") && !pathname.startsWith("/auth")) fetch("/api/company/readiness").then(async (response) => { if (!response.ok) return; const data = await response.json(); setOrganizationName(data.readiness?.organizationName ?? (document.cookie.includes("estimator_preview=1") ? "Preview workspace" : "Workspace")); }).catch(() => undefined); }, [pathname]);
  if (pathname.startsWith("/login") || pathname.startsWith("/onboarding") || pathname.startsWith("/auth")) return children;
  return <main className="shell"><aside className="sidebar"><div className="brand"><span className="brand-mark">E</span><span>EstimatorAI</span></div><p className="eyebrow">Workspace</p><nav aria-label="Primary navigation">{navItems.map((item) => <a className={pathname === item.href ? "nav-item active" : "nav-item"} href={item.href} key={item.href}>{item.label}</a>)}</nav><div className="sidebar-footer"><p>Canada construction intelligence</p><p>Private company workspace</p></div></aside><section className="content">{previewMode && <div className="preview-banner"><strong>Local preview mode</strong><span>Temporary access for reviewing the interface. Sign-in is still required for real company data.</span><a href="/preview?exit=1">Exit preview</a></div>}{pathname !== "/" && <header className="topbar"><div><p className="eyebrow">EstimatorAI workspace</p><h1>{navItems.find((item) => item.href === pathname)?.label ?? "Workspace"}</h1></div><div className="org-chip">{organizationName}</div></header>}{children}</section></main>;
}
