"use client";

import { ChangeEvent, FormEvent, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";

type Tender = { id: string; title_en: string | null; description_en: string | null; buyer_name: string | null; estimated_value_cents: number | null; closing_at: string | null; source_url: string | null };
type Profile = { id: string; name: string; trade_slug: string };
type Scope = { id: string; task_key: string | null; description: string; quantity: number | null; unit: string | null; confidence: number | null; review_status: string };
type Document = { id: string; file_name: string; document_type: string; processing_status: string; source_url: string | null; metadata?: { revision?: number; needsOcr?: boolean } };

const money = (cents: number | null) => cents === null ? "-" : new Intl.NumberFormat("en-CA", { style: "currency", currency: "CAD" }).format(cents / 100);

export default function TenderDetailPage() {
  const params = useParams();
  const router = useRouter();
  const id = typeof params.id === "string" ? params.id : "";
  const [tender, setTender] = useState<Tender | null>(null);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [scope, setScope] = useState<Scope[]>([]);
  const [documents, setDocuments] = useState<Document[]>([]);
  const [profileId, setProfileId] = useState("");
  const [description, setDescription] = useState("");
  const [taskKey, setTaskKey] = useState("");
  const [quantity, setQuantity] = useState("");
  const [unit, setUnit] = useState("m2");
  const [documentName, setDocumentName] = useState("");
  const [documentType, setDocumentType] = useState("specification");
  const [documentText, setDocumentText] = useState("");
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function load() {
    const [tenderResponse, profileResponse, scopeResponse, documentResponse] = await Promise.all([fetch(`/api/tenders/${id}`), fetch("/api/trade-profiles"), fetch(`/api/tenders/${id}/scope`), fetch(`/api/tenders/${id}/documents`)]);
    const tenderData = await tenderResponse.json();
    const profileData = await profileResponse.json();
    const scopeData = await scopeResponse.json();
    const documentData = await documentResponse.json();
    if (!tenderResponse.ok) throw new Error(tenderData.error);
    setTender(tenderData.tender);
    setProfiles(profileData.profiles ?? []);
    setScope(scopeData.scopeItems ?? []);
    setDocuments(documentData.documents ?? []);
    if (!profileId && profileData.profiles?.[0]) setProfileId(profileData.profiles[0].id);
  }

  useEffect(() => { if (id) load().catch((error) => setMessage(error instanceof Error ? error.message : "Unable to load tender")); }, [id]);

  async function addScope(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    const response = await fetch(`/api/tenders/${id}/scope`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ tradeProfileId: profileId || null, taskKey, description, quantity: quantity ? Number(quantity) : null, unit, confidence: 65 }) });
    const data = await response.json();
    setMessage(response.ok ? "Scope item added." : data.error);
    if (response.ok) { setDescription(""); setTaskKey(""); setQuantity(""); await load(); }
    setBusy(false);
  }

  async function addDocument(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    const requestBody = selectedFile ? (() => { const body = new FormData(); body.append("file", selectedFile); body.append("fileName", documentName); body.append("documentType", documentType); body.append("tradeProfileId", profileId || ""); return body; })() : JSON.stringify({ fileName: documentName, documentType, extractedText: documentText, tradeProfileId: profileId || null });
    const response = await fetch(`/api/tenders/${id}/documents`, { method: "POST", headers: selectedFile ? undefined : { "Content-Type": "application/json" }, body: requestBody });
    const data = await response.json();
    setMessage(response.ok ? "Tender document registered and scope quantities extracted." : data.error);
    if (response.ok) { setDocumentName(""); setDocumentText(""); setSelectedFile(null); await load(); }
    setBusy(false);
  }

  async function loadTextFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    setSelectedFile(file);
    setDocumentName(file.name);
    try {
      if (/\.pdf$/i.test(file.name) || file.type === "application/pdf") {
        setDocumentText("");
        setMessage(`${file.name} is ready. EstimatorAI will extract its text when you register it.`);
      } else {
        setDocumentText(await file.text());
        setMessage(`Loaded ${file.name}. Review the text before registering it.`);
      }
    } catch {
      setMessage("This file could not be read in the browser. Paste its text instead.");
    }
  }

  async function generate() {
    setBusy(true);
    const response = await fetch("/api/estimates", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ tenderId: id, tradeProfileId: profileId }) });
    const data = await response.json();
    setBusy(false);
    if (!response.ok) { setMessage(data.error); return; }
    router.push(`/estimates/${data.estimate.id}`);
  }

  if (!tender) return <main className="empty-page"><p className="eyebrow accent">Tender workspace</p><h1>Loading opportunity</h1><p>{message ?? "Loading tender package..."}</p></main>;

  return <main className="empty-page">
    <div className="profile-header"><div><p className="eyebrow accent">Tender workspace</p><h1>{tender.title_en ?? "Untitled opportunity"}</h1><p className="empty-page-copy">{tender.buyer_name ?? "Buyer not listed"} - Closes {tender.closing_at ? new Date(tender.closing_at).toLocaleDateString("en-CA") : "not listed"} - Estimated value {money(tender.estimated_value_cents)}</p></div>{tender.source_url && <a className="button secondary-button" href={tender.source_url} target="_blank" rel="noopener noreferrer">Open source -&gt;</a>}</div>
    {message && <p className="auth-message" role="status">{message}</p>}
    <section className="profile-card"><div className="profile-card-heading"><div><h2>Choose the operating model</h2><p className="muted">Trade selection controls crews, productivity, materials, and cost assumptions.</p></div></div><select value={profileId} onChange={(event) => setProfileId(event.target.value)}>{profiles.map((profile) => <option value={profile.id} key={profile.id}>{profile.name}</option>)}</select>{!profiles.length && <p className="error-text">Create a trade profile before generating an estimate.</p>}</section>
    <div className="detail-grid">
      <section className="profile-card"><div className="profile-card-heading"><div><h2>Tender package</h2><p className="muted">Upload text files or PDFs. Text PDFs are extracted automatically; scanned PDFs are flagged for OCR/manual review.</p></div></div>{documents.map((document) => <div className="input-row" key={document.id}><div><span>{document.file_name}</span><small>{document.document_type} - {document.processing_status}{document.metadata?.revision ? ` - revision ${document.metadata.revision}` : ""}{document.metadata?.needsOcr ? " - OCR/manual review required" : ""}</small></div></div>)}<form className="stack-form" onSubmit={addDocument}><input type="file" accept=".pdf,.txt,.md,.csv,.json,application/pdf,text/plain,text/csv,application/json" onChange={loadTextFile} /><input value={documentName} onChange={(event) => setDocumentName(event.target.value)} placeholder="Document name, e.g. Scope.pdf" required /><select value={documentType} onChange={(event) => setDocumentType(event.target.value)}><option value="specification">Specification</option><option value="drawing">Drawing</option><option value="bill_of_quantities">Bill of quantities</option><option value="addendum">Addendum</option><option value="schedule">Schedule</option></select><textarea value={documentText} onChange={(event) => { setDocumentText(event.target.value); setSelectedFile(null); }} placeholder="Paste extracted text or notes from the document for evidence capture" rows={4} /><button className="text-button" type="submit" disabled={busy}>Register document -&gt;</button></form></section>
      <section className="profile-card"><div className="profile-card-heading"><div><h2>Scope and quantities</h2><p className="muted">Add only scope facts here. EstimatorAI generates hours and costs from the operating model.</p></div></div>{scope.map((item) => <div className="input-row" key={item.id}><div><span>{item.description}</span><small>{item.task_key ?? "Unmapped task"} - {item.confidence ?? "-"}% confidence - {item.review_status}</small></div><strong>{item.quantity ?? "-"} {item.unit ?? ""}</strong></div>)}<form className="stack-form" onSubmit={addScope}><input value={description} onChange={(event) => setDescription(event.target.value)} placeholder="Scope description" required /><input value={taskKey} onChange={(event) => setTaskKey(event.target.value)} placeholder="Task key, e.g. paint-walls" /><div className="form-grid"><input type="number" step="0.01" value={quantity} onChange={(event) => setQuantity(event.target.value)} placeholder="Quantity" /><input value={unit} onChange={(event) => setUnit(event.target.value)} placeholder="Unit" /></div><button className="text-button" type="submit" disabled={busy}>Add scope item -&gt;</button></form></section>
    </div>
    <div className="onboarding-actions"><p className="muted">The generated estimate will show every missing quantity, unsupported task, capacity gap, and rate issue as a review exception.</p><button className="button" type="button" onClick={generate} disabled={busy || !profileId || !scope.length}>{busy ? "Generating estimate..." : "Generate automated estimate ->"}</button></div>
  </main>;
}
