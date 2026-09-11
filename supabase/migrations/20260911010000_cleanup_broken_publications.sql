-- Cleanup historical broken publication records created by the previous Facebook automation.
-- Removes only failed records, orphan drafts, expired scheduled records,
-- and scheduled records carrying an explicit error.
delete from public.posts
where status = 'failed'
   or (status = 'draft' and affiliate_link_id is null)
   or (status = 'scheduled' and (scheduled_at < now() or error_message is not null));
