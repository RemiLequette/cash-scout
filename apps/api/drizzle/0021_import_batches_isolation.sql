-- Book isolation for statement import batches (see 0002_book_isolation.sql).
-- A statement holds account numbers and labels: only editors and owners see and change it.

ALTER TABLE import_batch ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY import_batch_all ON import_batch FOR ALL
  USING (book_id IN (SELECT app_book_ids('editor')))
  WITH CHECK (book_id IN (SELECT app_book_ids('editor')));--> statement-breakpoint
ALTER TABLE import_line ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY import_line_all ON import_line FOR ALL
  USING (book_id IN (SELECT app_book_ids('editor')))
  WITH CHECK (book_id IN (SELECT app_book_ids('editor')));
