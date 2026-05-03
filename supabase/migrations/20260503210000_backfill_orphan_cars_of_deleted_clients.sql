-- Back-fill: soft-delete cars whose owning client is already soft-
-- deleted. Mirror of 20260503180000 (orphan policies).
--
-- Going forward the agent's "delete customer" action hard-deletes the
-- client and the FK CASCADE removes their cars + policies in one shot.
-- For clients soft-deleted before that change, the cars row was never
-- touched and shows up on the agent dashboard as "سيارات جديدة" even
-- though the customer is gone. Soft-delete those cars to align with
-- the soft-deleted policies they belong to.
--
-- Idempotent: re-running is a no-op because the WHERE clause already
-- excludes already-soft-deleted cars.

UPDATE public.cars AS car
SET    deleted_at = COALESCE(c.deleted_at, NOW())
FROM   public.clients AS c
WHERE  car.client_id  = c.id
  AND  c.deleted_at  IS NOT NULL
  AND  car.deleted_at IS NULL;
