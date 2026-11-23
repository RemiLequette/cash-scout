-- Book isolation for budgets (see 0002_book_isolation.sql).
-- Members read; editors and owners write.

ALTER TABLE budget_profile ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY budget_profile_select ON budget_profile FOR SELECT
  USING (book_id IN (SELECT app_book_ids()));--> statement-breakpoint
CREATE POLICY budget_profile_write ON budget_profile FOR ALL
  USING (book_id IN (SELECT app_book_ids('editor')))
  WITH CHECK (book_id IN (SELECT app_book_ids('editor')));--> statement-breakpoint

ALTER TABLE category_budget ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY category_budget_select ON category_budget FOR SELECT
  USING (book_id IN (SELECT app_book_ids()));--> statement-breakpoint
CREATE POLICY category_budget_write ON category_budget FOR ALL
  USING (book_id IN (SELECT app_book_ids('editor')))
  WITH CHECK (book_id IN (SELECT app_book_ids('editor')));
