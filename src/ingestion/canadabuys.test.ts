import { normalizeCanadaBuysCsv } from "./canadabuys";

const sample = `solicitationNumber-numeroSollicitation,title-titre-eng,title-titre-fra,procurementCategory-categorieApprovisionnement,tenderClosingDate-appelOffresdateCloture\nABC-1,"Window, replacement",Remplacement de fenêtres,CNST,2026-08-10 14:30:00\nFR-ONLY,,Peinture,SRV,2026-08-11 10:00:00`;

const records = normalizeCanadaBuysCsv(sample);
if (records.length !== 2) throw new Error("expected two valid bilingual records");
if (records[0].title.en !== "Window, replacement") throw new Error("quoted CSV field failed");
if (records[0].procurementCategory !== "construction") throw new Error("construction classification failed");
if (records[0].closingAt !== "2026-08-10T19:30:00.000Z") throw new Error("UTC-0500 closing conversion failed");
if (records[1].title.en !== null || records[1].title.fr !== "Peinture") throw new Error("French-only record failed");

const liveShape = `title-titre-eng,title-titre-fra,solicitationNumber-numeroSollicitation,procurementCategory-categorieApprovisionnement,tenderClosingDate-appelOffresDateCloture,contractingEntityName-nomEntitContractante-eng,noticeURL-URLavis-eng,tenderDescription-descriptionAppelOffres-eng\nRenovation, Rénovation,CB-2,*CNST,2026-08-20T14:00:00,Public Works,https://example.test/cb-2,Paint and drywall works`;
const liveRecord = normalizeCanadaBuysCsv(liveShape)[0];
if (liveRecord.procurementCategory !== "construction") throw new Error("live construction code failed");
if (liveRecord.buyerName !== "Public Works") throw new Error("live buyer header failed");
if (liveRecord.description.en !== "Paint and drywall works") throw new Error("live description header failed");
if (liveRecord.sourceUrl !== "https://example.test/cb-2") throw new Error("live URL header failed");
if (liveRecord.closingAt !== "2026-08-20T19:00:00.000Z") throw new Error("live closing header failed");

const publicationRecord = normalizeCanadaBuysCsv(`title-titre-eng,solicitationNumber-numeroSollicitation,publicationDate-datePublication\nRecent,RECENT,2026-08-02T14:00:00`)[0];
if (publicationRecord.publishedAt !== "2026-08-02T19:00:00.000Z") throw new Error("publication date header failed");
