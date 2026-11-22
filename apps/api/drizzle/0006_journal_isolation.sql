-- Book isolation for the journal (see 0002_book_isolation.sql).
-- Members read; editors and owners write.

ALTER TABLE journal_entry ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY journal_entry_select ON journal_entry FOR SELECT
  USING (book_id IN (SELECT app_book_ids()));--> statement-breakpoint
CREATE POLICY journal_entry_write ON journal_entry FOR ALL
  USING (book_id IN (SELECT app_book_ids('editor')))
  WITH CHECK (book_id IN (SELECT app_book_ids('editor')));
