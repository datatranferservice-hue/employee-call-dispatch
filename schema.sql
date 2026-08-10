-- CallFlow v0.2 PostgreSQL schema
CREATE TABLE organizations (
 id UUID PRIMARY KEY,
 name TEXT NOT NULL,
 timezone TEXT NOT NULL DEFAULT 'America/Phoenix',
 created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE users (
 id UUID PRIMARY KEY,
 organization_id UUID NOT NULL REFERENCES organizations(id),
 name TEXT NOT NULL,
 email TEXT NOT NULL,
 password_hash TEXT NOT NULL,
 role TEXT NOT NULL CHECK(role IN ('owner','admin','employee')),
 UNIQUE(organization_id,email)
);
CREATE TABLE employees (
 id UUID PRIMARY KEY,
 organization_id UUID NOT NULL REFERENCES organizations(id),
 user_id UUID REFERENCES users(id),
 display_name TEXT NOT NULL,
 forwarding_phone_e164 TEXT,
 active BOOLEAN NOT NULL DEFAULT true
);
CREATE TABLE shifts (
 id UUID PRIMARY KEY,
 organization_id UUID NOT NULL REFERENCES organizations(id),
 employee_id UUID NOT NULL REFERENCES employees(id),
 clock_in TIMESTAMPTZ NOT NULL,
 clock_out TIMESTAMPTZ
);
CREATE TABLE calls (
 id UUID PRIMARY KEY,
 organization_id UUID NOT NULL REFERENCES organizations(id),
 employee_id UUID REFERENCES employees(id),
 provider_call_id TEXT,
 started_at TIMESTAMPTZ NOT NULL,
 answered_at TIMESTAMPTZ,
 ended_at TIMESTAMPTZ,
 status TEXT NOT NULL
);
CREATE TABLE appointments (
 id UUID PRIMARY KEY,
 organization_id UUID NOT NULL REFERENCES organizations(id),
 employee_id UUID REFERENCES employees(id),
 customer_name TEXT,
 scheduled_at TIMESTAMPTZ NOT NULL,
 created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE audit_events (
 id UUID PRIMARY KEY,
 organization_id UUID NOT NULL REFERENCES organizations(id),
 actor_user_id UUID REFERENCES users(id),
 event_type TEXT NOT NULL,
 metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
 created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
