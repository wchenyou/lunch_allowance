-- PostgreSQL grants EXECUTE on new functions to PUBLIC by default. The server
-- calls these RPCs with the service role only, so keep them off the public API
-- surface for anon/authenticated clients.

revoke execute on function public.rls_auto_enable() from public, anon, authenticated;
revoke execute on function public.save_receipt_with_claims(uuid, date, uuid, text, text, numeric, text, text, public.receipt_status, jsonb) from public, anon, authenticated;
revoke execute on function public.mark_receipts_status(uuid[], public.receipt_status) from public, anon, authenticated;

grant execute on function public.save_receipt_with_claims(uuid, date, uuid, text, text, numeric, text, text, public.receipt_status, jsonb) to service_role;
grant execute on function public.mark_receipts_status(uuid[], public.receipt_status) to service_role;
