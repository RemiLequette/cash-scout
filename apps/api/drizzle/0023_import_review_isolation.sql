-- Book isolation for import rules (see 0002_book_isolation.sql).
-- Rules are managed by editors and owners, who are also the ones who import.

ALTER TABLE import_rule ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY import_rule_all ON import_rule FOR ALL
  USING (book_id IN (SELECT app_book_ids('editor')))
  WITH CHECK (book_id IN (SELECT app_book_ids('editor')));
