-- Book isolation for compensations (see 0015_transfers_isolation.sql).
-- Members read; editors and owners write.

ALTER TABLE compensation ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY compensation_select ON compensation FOR SELECT
  USING (book_id IN (SELECT app_book_ids()));--> statement-breakpoint
CREATE POLICY compensation_write ON compensation FOR ALL
  USING (book_id IN (SELECT app_book_ids('editor')))
  WITH CHECK (book_id IN (SELECT app_book_ids('editor')));
