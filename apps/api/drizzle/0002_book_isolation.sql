-- Book isolation (see ARCHITECTURE.md, Book isolation).
--
-- The API runs every query as the role cashscout_app, which is subject to
-- row-level security. Each request sets app.user_id in its transaction; a
-- session without it sees no book data at all.
--
-- The helper functions are SECURITY DEFINER: they run as the owner of the
-- tables, which row-level security does not apply to, so policies on
-- book_member can read book_member without recursion.

DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'cashscout_app') THEN
    CREATE ROLE cashscout_app NOLOGIN NOSUPERUSER NOBYPASSRLS;
  END IF;
END
$$;--> statement-breakpoint

GRANT USAGE ON SCHEMA public TO cashscout_app;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO cashscout_app;--> statement-breakpoint
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO cashscout_app;--> statement-breakpoint
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO cashscout_app;--> statement-breakpoint
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO cashscout_app;--> statement-breakpoint

CREATE FUNCTION app_user_id() RETURNS text
LANGUAGE sql STABLE
AS $$ SELECT nullif(current_setting('app.user_id', true), '') $$;--> statement-breakpoint

-- Books of the current user with at least the given role.
CREATE FUNCTION app_book_ids(min_role book_role DEFAULT 'viewer') RETURNS SETOF uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT book_id FROM book_member
  WHERE user_id = app_user_id()
    AND CASE min_role
      WHEN 'viewer' THEN true
      WHEN 'editor' THEN role IN ('owner', 'editor')
      ELSE role = 'owner'
    END
$$;--> statement-breakpoint

CREATE FUNCTION app_book_has_members(target uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$ SELECT EXISTS (SELECT 1 FROM book_member WHERE book_id = target) $$;--> statement-breakpoint

ALTER TABLE book ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY book_select ON book FOR SELECT USING (id IN (SELECT app_book_ids()));--> statement-breakpoint
CREATE POLICY book_insert ON book FOR INSERT WITH CHECK (app_user_id() IS NOT NULL);--> statement-breakpoint
CREATE POLICY book_update ON book FOR UPDATE USING (id IN (SELECT app_book_ids('owner')));--> statement-breakpoint
CREATE POLICY book_delete ON book FOR DELETE USING (id IN (SELECT app_book_ids('owner')));--> statement-breakpoint

ALTER TABLE book_member ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY book_member_select ON book_member FOR SELECT
  USING (book_id IN (SELECT app_book_ids()));--> statement-breakpoint
-- Owners add members; the creator of a book with no member yet becomes its owner.
CREATE POLICY book_member_insert ON book_member FOR INSERT WITH CHECK (
  book_id IN (SELECT app_book_ids('owner'))
  OR (user_id = app_user_id() AND role = 'owner' AND NOT app_book_has_members(book_id))
);--> statement-breakpoint
CREATE POLICY book_member_update ON book_member FOR UPDATE
  USING (book_id IN (SELECT app_book_ids('owner')))
  WITH CHECK (book_id IN (SELECT app_book_ids('owner')));--> statement-breakpoint
-- Owners remove members; anyone can leave a book.
CREATE POLICY book_member_delete ON book_member FOR DELETE
  USING (book_id IN (SELECT app_book_ids('owner')) OR user_id = app_user_id());
