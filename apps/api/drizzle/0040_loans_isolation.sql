-- Book isolation for loans and their events (see 0038_splits_isolation.sql).
-- Members read; editors and owners write.

ALTER TABLE loan ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY loan_select ON loan FOR SELECT
  USING (book_id IN (SELECT app_book_ids()));--> statement-breakpoint
CREATE POLICY loan_write ON loan FOR ALL
  USING (book_id IN (SELECT app_book_ids('editor')))
  WITH CHECK (book_id IN (SELECT app_book_ids('editor')));--> statement-breakpoint
ALTER TABLE loan_event ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY loan_event_select ON loan_event FOR SELECT
  USING (book_id IN (SELECT app_book_ids()));--> statement-breakpoint
CREATE POLICY loan_event_write ON loan_event FOR ALL
  USING (book_id IN (SELECT app_book_ids('editor')))
  WITH CHECK (book_id IN (SELECT app_book_ids('editor')));
