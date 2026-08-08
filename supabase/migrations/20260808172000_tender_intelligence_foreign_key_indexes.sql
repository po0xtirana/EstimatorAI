-- Cover foreign keys used by ingestion cleanup and opportunity analysis joins.

create index if not exists source_connections_source_idx on organization_tender_source_connections (source_key);
create index if not exists tender_analyses_tender_id_idx on tender_analyses (tender_id);
create index if not exists tender_analyses_trade_profile_id_idx on tender_analyses (trade_profile_id);
create index if not exists tender_processing_jobs_tender_id_idx on tender_processing_jobs (tender_id);
create index if not exists tender_relevance_feedback_tender_id_idx on tender_relevance_feedback (tender_id);
create index if not exists tender_revisions_source_key_idx on tender_revisions (source_key);

