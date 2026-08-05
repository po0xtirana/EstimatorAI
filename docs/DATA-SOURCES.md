# Phase 1 data source contract

The initial source is the official CanadaBuys open tender-notices dataset. The Government of Canada documents that its current files contain English and French values in the same row, use `CNST` for construction, identify notices with solicitation/reference numbers, and provide closing timestamps in UTC−0500.

Official references:

- Dataset landing page: <https://canadabuys.canada.ca/en/procurement-and-contracting-data>
- Dataset support and refresh schedule: <https://donnees-data.tpsgc-pwgsc.gc.ca/ba2/ac-cb/soutien-support-eng.html>
- Open Government dataset record: <https://open.canada.ca/data/en/dataset/6abd20d4-7a1c-4b38-baa2-9525d0bb2fd2>

The runtime dataset URL remains configuration, not hardcoded, because the Open Government resource URL can change. Polling must record an `ingestion_runs` row, retain the raw row, normalize valid records, count rejected rows, and upsert by `(source, source_record_id)`. No record is discarded solely because one language column is empty.
