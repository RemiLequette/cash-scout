-- Book isolation for splits (see 0015_transfers_isolation.sql).
-- Members read; editors and owners write.

ALTER TABLE split ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY split_select ON split FOR SELECT
  USING (book_id IN (SELECT app_book_ids()));--> statement-breakpoint
CREATE POLICY split_write ON split FOR ALL
  USING (book_id IN (SELECT app_book_ids('editor')))
  WITH CHECK (book_id IN (SELECT app_book_ids('editor')));
