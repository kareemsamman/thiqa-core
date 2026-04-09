-- ============================================================
-- Fix: Client id_number unique constraint should be per-agent
-- The old constraint was GLOBAL, causing cross-agent conflicts
-- when two agents have clients with the same ID number.
-- Same fix for cars.car_number.
-- ============================================================

-- Drop the global client id_number constraint
DROP INDEX IF EXISTS idx_clients_id_number_unique;

-- Create agent-scoped constraint (same id_number allowed in different agents)
CREATE UNIQUE INDEX idx_clients_id_number_agent_unique
  ON public.clients(agent_id, id_number) WHERE deleted_at IS NULL;

-- Drop the global car_number constraint
DROP INDEX IF EXISTS idx_cars_car_number_unique;

-- Create agent-scoped constraint
CREATE UNIQUE INDEX idx_cars_car_number_agent_unique
  ON public.cars(agent_id, car_number) WHERE deleted_at IS NULL;
