const navItems = [{ label: "Overview", href: "/" }, { label: "Tender feed", href: "/tenders" }, { label: "Cost profile", href: "/cost-profile" }, { label: "Reports", href: "/reports" }];

export default function HomePage() {
  return (
    <main className="shell">
      <aside className="sidebar">
        <div className="brand"><span className="brand-mark">B</span><span>BidPilot</span></div>
        <p className="eyebrow">Workspace</p>
        <nav aria-label="Primary navigation">
          {navItems.map((item, index) => <a className={index === 0 ? "nav-item active" : "nav-item"} href={item.href} key={item.label}>{item.label}</a>)}
        </nav>
        <div className="sidebar-footer"><p className="muted">CanadaBuys workspace</p><p className="muted">Phase 0 foundation</p></div>
      </aside>
      <section className="content">
        <header className="topbar"><div><p className="eyebrow">Tuesday, August 3, 2026</p><h1>Good morning</h1></div><div className="org-chip">Demo organization <span>⌄</span></div></header>
        <div className="notice"><span className="notice-dot" /> Your workspace is ready. Tender ingestion will appear here once Phase 1 is approved.</div>
        <section className="hero"><div><p className="eyebrow accent">Estimator workspace</p><h2>Price the work you can win.</h2><p className="hero-copy">BidPilot brings public tenders, company costs, and transparent estimating into one calm workspace.</p><button className="button" type="button">Set up cost profile <span>→</span></button></div><div className="hero-art" aria-hidden="true"><div className="art-card card-back" /><div className="art-card card-front"><span className="art-line wide" /><span className="art-line" /><span className="art-line short" /><div className="art-total">$ —</div></div></div></section>
        <section className="section-heading"><div><p className="eyebrow">At a glance</p><h3>Your bid pipeline</h3></div><span className="muted">No live tenders yet</span></section>
        <div className="metrics"><Metric label="Open tenders" value="—" detail="Awaiting CanadaBuys connection" /><Metric label="Potential matches" value="—" detail="Capability profile not configured" /><Metric label="Active estimates" value="0" detail="Ready when you are" /></div>
        <section className="empty-state"><div className="empty-icon">＋</div><h3>Make your first estimate auditable</h3><p>Add staff roles, crew compositions, material costs, and overheads. Every value stays editable and traceable to your company profile.</p><a href="#">Open cost profile <span>→</span></a></section>
      </section>
    </main>
  );
}

function Metric({ label, value, detail }: { label: string; value: string; detail: string }) {
  return <article className="metric"><p className="muted">{label}</p><strong>{value}</strong><p className="metric-detail">{detail}</p></article>;
}
