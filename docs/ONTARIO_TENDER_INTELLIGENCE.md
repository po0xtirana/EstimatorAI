# Ontario Tender Intelligence Launch

EstimatorAI’s product promise is one workflow: monitor connected Ontario tender sources, rank opportunities against a contractor’s real capabilities, and prepare an evidence-backed first estimate for qualified work.

## What is implemented

- A source registry distinguishes public feeds, licensed sources, customer-authorized portals, and estimating-email intake.
- CanadaBuys is the first active connector. The scheduled ingestion checks all enabled connectors every four hours; analysis jobs run every two hours.
- There is no 100-record cap. Each active connector must paginate through its complete available feed.
- Canonical fingerprints merge duplicate notices while source references preserve where each listing came from.
- Immutable revision snapshots detect scope, value, and deadline changes. New revisions enqueue a fresh organization analysis and generate amendment alerts.
- Source outages, connection requirements, access mode, scan interval, and last success are visible in the product.
- Restricted portals are never bypassed. MERX, Biddingo, Bonfire, Bids&Tenders, and the Ontario Tenders Portal remain connection-required until licensed or customer-authorized integration is configured.
- Company matching includes trades, regions, bonding, crew capacity, certifications, project-size rules, preferred buyers and project types, excluded work, and bounded relevance feedback.
- Viable opportunities remain in the primary feed. Not-viable opportunities stay searchable under **All scanned**.
- Mandatory certification gaps stop automatic estimating and send the opportunity to review.
- Qualified tenders continue through the existing document evidence, scope extraction, deterministic estimate, exception, approval, workbook comparison, and actual-job learning workflow.

## Ontario renovation baseline

New renovation and fit-out operating models include site protection, selective demolition and disposal, drywall, acoustic ceilings, painting, flooring, doors and hardware, millwork, minor mechanical and electrical coordination, mobilization, supervision, safety, permits, inspection, and closeout. Three starter crew formations provide alternatives for general renovation, demolition/protection, and drywall/finishes.

These are starter assumptions only. A contractor must review loaded rates, productivity, crew availability, waste, allowances, risk, and commercial rules before relying on an estimate.

## Source onboarding policy

1. Prefer documented public feeds and open datasets.
2. Use a commercial connector only with a valid EstimatorAI or customer licence.
3. Use restricted-portal credentials only with explicit customer authorization and the portal’s permission.
4. Use tender-notification forwarding when documents cannot be retrieved through a lawful connector.
5. Show a clear processing exception when a document is unavailable; never imply that it was analyzed.

## Pilot offer

- 90-day Ontario ICI renovation pilot: CAD $99/month plus HST.
- Concierge operating-model setup and tender-source configuration.
- Ten historical estimate/actual pairs and three live tenders in shadow mode.
- Founding plan after pilot: CAD $199/month plus HST while continuously subscribed, for one company, three users, and up to 25 fully analyzed tender packages monthly.
- The public pilot page is available at `/pricing`.

EstimatorAI remains an estimator copilot. It does not approve or submit bids automatically.
