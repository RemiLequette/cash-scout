-- Book isolation for budget settlements (see 0008_budgets_isolation.sql).
-- Members read; editors and owners write.

ALTER TABLE budget_settlement ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY budget_settlement_select ON budget_settlement FOR SELECT
  USING (book_id IN (SELECT app_book_ids()));--> statement-breakpoint
CREATE POLICY budget_settlement_write ON budget_settlement FOR ALL
  USING (book_id IN (SELECT app_book_ids('editor')))
  WITH CHECK (book_id IN (SELECT app_book_ids('editor')));
