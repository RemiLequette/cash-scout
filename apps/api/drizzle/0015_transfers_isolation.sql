-- Book isolation for transfers (see 0006_journal_isolation.sql).
-- Members read; editors and owners write.

ALTER TABLE transfer ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY transfer_select ON transfer FOR SELECT
  USING (book_id IN (SELECT app_book_ids()));--> statement-breakpoint
CREATE POLICY transfer_write ON transfer FOR ALL
  USING (book_id IN (SELECT app_book_ids('editor')))
  WITH CHECK (book_id IN (SELECT app_book_ids('editor')));
