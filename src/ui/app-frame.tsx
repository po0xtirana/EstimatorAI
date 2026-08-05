"use client";

import { usePathname } from "next/navigation";

const navItems = [{ label: "Overview", href: "/" }, { label: "Tender feed", href: "/tenders" }, { label: "Company team", href: "/team" }, { label: "Cost profile", href: "/cost-profile" }, { label: "Reports", href: "/reports" }];

export default function AppFrame({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  if (pathname.startsWith("/login") || pathname.startsWith("/onboarding") || pathname.startsWith("/auth")) return children;
  return <main className="shell"><aside className="sidebar"><div className="brand"><span className="brand-mark">E</span><span>EstimatorAI</span></div><p className="eyebrow">Workspace</p><nav aria-label="Primary navigation">{navItems.map((item) => <a className={pathname === item.href ? "nav-item active" : "nav-item"} href={item.href} key={item.href}>{item.label}</a>)}</nav><div className="sidebar-footer"><p>Canada construction intelligence</p><p>Private company workspace</p></div></aside><section className="content">{pathname !== "/" && <header className="topbar"><div><p className="eyebrow">EstimatorAI workspace</p><h1>{navItems.find((item) => item.href === pathname)?.label ?? "Workspace"}</h1></div><div className="org-chip">Demo organization</div></header>}{children}</section></main>;
}
