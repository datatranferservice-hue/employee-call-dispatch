-- CallFlow Command v2.1 production schema
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS organizations (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 name text NOT NULL,
 timezone text NOT NULL DEFAULT 'America/Phoenix',
 business_phone text,
 created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS users (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
 name text NOT NULL,
 email text NOT NULL,
 password_hash text NOT NULL,
 role text NOT NULL CHECK(role IN ('owner','admin','employee')),
 active boolean NOT NULL DEFAULT true,
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(organization_id,email)
);

CREATE TABLE IF NOT EXISTS sessions (
 token_hash text PRIMARY KEY,
 user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 expires_at timestamptz NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS employees (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
 user_id uuid UNIQUE REFERENCES users(id) ON DELETE SET NULL,
 forwarding_phone text,
 phone_verified boolean NOT NULL DEFAULT false,
 phone_approved boolean NOT NULL DEFAULT false,
 on_duty boolean NOT NULL DEFAULT false,
 busy boolean NOT NULL DEFAULT false,
 routed_calls integer NOT NULL DEFAULT 0,
 last_routed_at timestamptz,
 active boolean NOT NULL DEFAULT true,
 created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS shifts (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
 employee_id uuid NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
 clock_in timestamptz NOT NULL DEFAULT now(),
 clock_out timestamptz
);

CREATE TABLE IF NOT EXISTS appointments (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
 employee_id uuid REFERENCES employees(id) ON DELETE SET NULL,
 customer_name text NOT NULL,
 customer_phone text,
 scheduled_at timestamptz NOT NULL,
 status text NOT NULL DEFAULT 'scheduled',
 notes text,
 created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS calls (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
 employee_id uuid REFERENCES employees(id) ON DELETE SET NULL,
 provider_call_id text UNIQUE,
 caller_phone text,
 status text NOT NULL,
 started_at timestamptz NOT NULL DEFAULT now(),
 answered_at timestamptz,
 ended_at timestamptz,
 metadata jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE TABLE IF NOT EXISTS organization_settings (
 organization_id uuid PRIMARY KEY REFERENCES organizations(id) ON DELETE CASCADE,
 business_hours jsonb NOT NULL DEFAULT '{"mon":["08:00","17:00"],"tue":["08:00","17:00"],"wed":["08:00","17:00"],"thu":["08:00","17:00"],"fri":["08:00","17:00"]}'::jsonb,
 closed_override boolean NOT NULL DEFAULT false,
 after_hours_message text NOT NULL DEFAULT 'Thank you for calling. We are currently closed and will return your call during business hours.',
 routing_strategy text NOT NULL DEFAULT 'round_robin' CHECK(routing_strategy IN ('round_robin','least_calls','longest_idle')),
 ring_seconds integer NOT NULL DEFAULT 20 CHECK(ring_seconds BETWEEN 10 AND 60),
 max_attempts integer NOT NULL DEFAULT 3 CHECK(max_attempts BETWEEN 1 AND 10),
 overflow_action text NOT NULL DEFAULT 'voicemail',
 route_cursor bigint NOT NULL DEFAULT 0,
 updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS audit_events (
 id bigserial PRIMARY KEY,
 organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
 actor_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
 event_type text NOT NULL,
 metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
 created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at);
CREATE INDEX IF NOT EXISTS idx_employees_routing ON employees(organization_id,on_duty,busy,active,phone_verified,phone_approved);
CREATE INDEX IF NOT EXISTS idx_calls_org_started ON calls(organization_id,started_at DESC);
CREATE INDEX IF NOT EXISTS idx_appointments_org_time ON appointments(organization_id,scheduled_at);
CREATE INDEX IF NOT EXISTS idx_audit_org_created ON audit_events(organization_id,created_at DESC);
