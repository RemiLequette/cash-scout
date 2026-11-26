-- The annual amount of a periodic budget, spread by its profile, becomes its 12
-- monthly amounts before the annual amount goes away. The last month takes the
-- rounding remainder, so the year's total does not change.
UPDATE category_budget AS b
SET months = (
  SELECT array_agg(
    CASE
      WHEN m < 12 THEN b.amount * p.weights[m] / 10000
      ELSE b.amount - (
        SELECT coalesce(sum(b.amount * p.weights[i] / 10000), 0)::bigint
        FROM generate_series(1, 11) AS i
      )
    END
    ORDER BY m
  )
  FROM generate_series(1, 12) AS m
)
FROM budget_profile AS p
WHERE p.id = b.profile_id AND b.amount IS NOT NULL;
