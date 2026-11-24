-- Book isolation for natures and balances (see 0004_reference_isolation.sql).
-- Members read; editors and owners write.

ALTER TABLE nature ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY nature_select ON nature FOR SELECT
  USING (book_id IN (SELECT app_book_ids()));--> statement-breakpoint
CREATE POLICY nature_write ON nature FOR ALL
  USING (book_id IN (SELECT app_book_ids('editor')))
  WITH CHECK (book_id IN (SELECT app_book_ids('editor')));--> statement-breakpoint

ALTER TABLE balance ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY balance_select ON balance FOR SELECT
  USING (book_id IN (SELECT app_book_ids()));--> statement-breakpoint
CREATE POLICY balance_write ON balance FOR ALL
  USING (book_id IN (SELECT app_book_ids('editor')))
  WITH CHECK (book_id IN (SELECT app_book_ids('editor')));--> statement-breakpoint

ALTER TABLE balance_nature ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY balance_nature_select ON balance_nature FOR SELECT
  USING (book_id IN (SELECT app_book_ids()));--> statement-breakpoint
CREATE POLICY balance_nature_write ON balance_nature FOR ALL
  USING (book_id IN (SELECT app_book_ids('editor')))
  WITH CHECK (book_id IN (SELECT app_book_ids('editor')));
