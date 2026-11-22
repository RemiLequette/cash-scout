-- Existing books get their default language as their only language.
INSERT INTO book_language (book_id, language)
SELECT id, default_language FROM book
ON CONFLICT DO NOTHING;--> statement-breakpoint

-- Book isolation for the reference data (see 0002_book_isolation.sql).
-- Members read; editors and owners write. Book languages are book settings: owners only.

ALTER TABLE book_language ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY book_language_select ON book_language FOR SELECT
  USING (book_id IN (SELECT app_book_ids()));--> statement-breakpoint
CREATE POLICY book_language_write ON book_language FOR ALL
  USING (book_id IN (SELECT app_book_ids('owner')))
  WITH CHECK (book_id IN (SELECT app_book_ids('owner')));--> statement-breakpoint

ALTER TABLE category_group ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY category_group_select ON category_group FOR SELECT
  USING (book_id IN (SELECT app_book_ids()));--> statement-breakpoint
CREATE POLICY category_group_write ON category_group FOR ALL
  USING (book_id IN (SELECT app_book_ids('editor')))
  WITH CHECK (book_id IN (SELECT app_book_ids('editor')));--> statement-breakpoint

ALTER TABLE category ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY category_select ON category FOR SELECT
  USING (book_id IN (SELECT app_book_ids()));--> statement-breakpoint
CREATE POLICY category_write ON category FOR ALL
  USING (book_id IN (SELECT app_book_ids('editor')))
  WITH CHECK (book_id IN (SELECT app_book_ids('editor')));--> statement-breakpoint

ALTER TABLE sub_category ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY sub_category_select ON sub_category FOR SELECT
  USING (book_id IN (SELECT app_book_ids()));--> statement-breakpoint
CREATE POLICY sub_category_write ON sub_category FOR ALL
  USING (book_id IN (SELECT app_book_ids('editor')))
  WITH CHECK (book_id IN (SELECT app_book_ids('editor')));--> statement-breakpoint

ALTER TABLE payment_type ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY payment_type_select ON payment_type FOR SELECT
  USING (book_id IN (SELECT app_book_ids()));--> statement-breakpoint
CREATE POLICY payment_type_write ON payment_type FOR ALL
  USING (book_id IN (SELECT app_book_ids('editor')))
  WITH CHECK (book_id IN (SELECT app_book_ids('editor')));--> statement-breakpoint

ALTER TABLE book_account ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY book_account_select ON book_account FOR SELECT
  USING (book_id IN (SELECT app_book_ids()));--> statement-breakpoint
CREATE POLICY book_account_write ON book_account FOR ALL
  USING (book_id IN (SELECT app_book_ids('editor')))
  WITH CHECK (book_id IN (SELECT app_book_ids('editor')));
