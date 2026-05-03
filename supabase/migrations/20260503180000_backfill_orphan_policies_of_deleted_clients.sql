-- Back-fill: soft-delete any policy whose owning client is already
-- soft-deleted but whose own deleted_at is still NULL.
--
-- Context: the "cascade soft-delete on client deletion" behavior was
-- added in commit ed4b3e0. Before that commit, the UI blocked deletion
-- of clients with policies; once the block was lifted, only future
-- deletions started cascading. Any client soft-deleted earlier — or any
-- policy that slipped past the cascade for any other reason — is left
-- with a NULL policies.deleted_at, which keeps it counting against the
-- agent's quota and showing up in lists.
--
-- This migration aligns the historical state with the new invariant
-- ("if clients.deleted_at IS NOT NULL then policies.deleted_at IS NOT
-- NULL for every policy of that client"). Idempotent: re-running is a
-- no-op because the WHERE clause already excludes soft-deleted policies.

UPDATE public.policies AS p
SET    deleted_at = COALESCE(c.deleted_at, NOW())
FROM   public.clients AS c
WHERE  p.client_id   = c.id
  AND  c.deleted_at IS NOT NULL
  AND  p.deleted_at IS NULL;
