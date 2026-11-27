-- Virtual accounts go, replaced by compensations (see docs/compensations.md).
-- Nothing is converted: one that still holds something stops the migration.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM book_account a
    WHERE a.kind = 'virtual'
      AND (a.opening_balance <> 0
        OR EXISTS (SELECT 1 FROM journal_entry e WHERE e.account_id = a.id)
        OR EXISTS (SELECT 1 FROM category_budget b WHERE b.account_id = a.id)
        OR EXISTS (SELECT 1 FROM import_batch i WHERE i.account_id = a.id)
        OR EXISTS (SELECT 1 FROM import_line l WHERE l.transfer_account_id = a.id))
  ) THEN
    RAISE EXCEPTION 'A virtual account is still in use: empty its entries, opening balance, budgets and statements, then update again';
  END IF;
END $$;--> statement-breakpoint
DELETE FROM "book_account" WHERE "kind" = 'virtual';--> statement-breakpoint
ALTER TABLE "book_account" DROP COLUMN "kind";--> statement-breakpoint
DROP TYPE "public"."account_kind";
