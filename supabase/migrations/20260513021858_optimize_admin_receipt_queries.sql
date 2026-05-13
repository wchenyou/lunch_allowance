-- Query-path indexes for admin receipt dashboards, statistics exports, and photo ZIP exports.
-- These keep department-scoped date/status/category filters efficient as receipt volume grows.

create index if not exists receipts_department_date_idx
  on public.receipts (department_id, receipt_date desc, created_at desc);

create index if not exists receipts_department_status_date_idx
  on public.receipts (department_id, status, receipt_date desc, created_at desc);

create index if not exists receipts_category_idx
  on public.receipts ((metadata->>'category'));

create index if not exists receipt_claims_profile_receipt_idx
  on public.receipt_claims (profile_id, receipt_id);

create index if not exists receipt_attachments_receipt_object_idx
  on public.receipt_attachments (receipt_id, object_path);
