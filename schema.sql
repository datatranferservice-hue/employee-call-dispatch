-- ============================================================
-- CALLFLOW COMMAND
-- Production PostgreSQL Schema
-- Version 2.0
-- ============================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ============================================================
-- ORGANIZATIONS
-- ============================================================

CREATE TABLE IF NOT EXISTS organizations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    name VARCHAR(160) NOT NULL,
    slug VARCHAR(120) UNIQUE NOT NULL,

    business_phone VARCHAR(30),
    timezone VARCHAR(80) NOT NULL DEFAULT 'America/Phoenix',

    active BOOLEAN NOT NULL DEFAULT TRUE,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- USERS
-- Owner / Admin / Manager / Employee
-- ============================================================

CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    organization_id UUID NOT NULL
        REFERENCES organizations(id)
        ON DELETE CASCADE,

    email VARCHAR(255) NOT NULL,
    password_hash TEXT NOT NULL,

    first_name VARCHAR(100) NOT NULL,
    last_name VARCHAR(100) NOT NULL,

    phone VARCHAR(30),

    role VARCHAR(30) NOT NULL
        CHECK (
            role IN (
                'owner',
                'admin',
                'manager',
                'employee'
            )
        ),

    active BOOLEAN NOT NULL DEFAULT TRUE,

    must_change_password BOOLEAN NOT NULL DEFAULT FALSE,

    failed_login_attempts INTEGER NOT NULL DEFAULT 0,
    locked_until TIMESTAMPTZ,

    last_login_at TIMESTAMPTZ,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    UNIQUE (
        organization_id,
        email
    )
);

CREATE INDEX IF NOT EXISTS idx_users_org
ON users(organization_id);

CREATE INDEX IF NOT EXISTS idx_users_role
ON users(organization_id, role);

-- ============================================================
-- SERVER SESSIONS
-- ============================================================

CREATE TABLE IF NOT EXISTS sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    user_id UUID NOT NULL
        REFERENCES users(id)
        ON DELETE CASCADE,

    token_hash TEXT NOT NULL UNIQUE,

    ip_address INET,

    user_agent TEXT,

    expires_at TIMESTAMPTZ NOT NULL,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sessions_user
ON sessions(user_id);

CREATE INDEX IF NOT EXISTS idx_sessions_expiry
ON sessions(expires_at);

-- ============================================================
-- EMPLOYEE OPERATION PROFILE
-- ============================================================

CREATE TABLE IF NOT EXISTS employee_profiles (
    user_id UUID PRIMARY KEY
        REFERENCES users(id)
        ON DELETE CASCADE,

    forwarding_phone VARCHAR(30),

    extension VARCHAR(20),

    can_receive_calls BOOLEAN NOT NULL DEFAULT TRUE,

    priority INTEGER NOT NULL DEFAULT 100,

    max_concurrent_calls INTEGER NOT NULL DEFAULT 1,

    status VARCHAR(30) NOT NULL DEFAULT 'offline'
        CHECK (
            status IN (
                'offline',
                'available',
                'busy',
                'break',
                'away'
            )
        ),

    last_call_at TIMESTAMPTZ,

    total_calls INTEGER NOT NULL DEFAULT 0,

    answered_calls INTEGER NOT NULL DEFAULT 0,

    missed_calls INTEGER NOT NULL DEFAULT 0,

    total_appointments INTEGER NOT NULL DEFAULT 0,

    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- SHIFTS
-- Exact clock-in / clock-out history
-- ============================================================

CREATE TABLE IF NOT EXISTS shifts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    organization_id UUID NOT NULL
        REFERENCES organizations(id)
        ON DELETE CASCADE,

    user_id UUID NOT NULL
        REFERENCES users(id)
        ON DELETE CASCADE,

    clock_in_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    clock_out_at TIMESTAMPTZ,

    clock_in_ip INET,

    clock_out_ip INET,

    notes TEXT,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_shifts_user
ON shifts(user_id, clock_in_at DESC);

CREATE INDEX IF NOT EXISTS idx_shifts_org
ON shifts(organization_id, clock_in_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS idx_one_open_shift_per_employee
ON shifts(user_id)
WHERE clock_out_at IS NULL;

-- ============================================================
-- BUSINESS HOURS
-- 0 Sunday
-- 1 Monday
-- ...
-- 6 Saturday
-- ============================================================

CREATE TABLE IF NOT EXISTS business_hours (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    organization_id UUID NOT NULL
        REFERENCES organizations(id)
        ON DELETE CASCADE,

    weekday SMALLINT NOT NULL
        CHECK (
            weekday BETWEEN 0 AND 6
        ),

    is_open BOOLEAN NOT NULL DEFAULT TRUE,

    open_time TIME,

    close_time TIME,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    UNIQUE (
        organization_id,
        weekday
    )
);

-- ============================================================
-- ORGANIZATION SETTINGS
-- ============================================================

CREATE TABLE IF NOT EXISTS organization_settings (
    organization_id UUID PRIMARY KEY
        REFERENCES organizations(id)
        ON DELETE CASCADE,

    force_closed BOOLEAN NOT NULL DEFAULT FALSE,

    after_hours_enabled BOOLEAN NOT NULL DEFAULT TRUE,

    after_hours_message TEXT NOT NULL DEFAULT
        'Thank you for calling. We are currently closed. We will respond during our next business period.',

    after_hours_action VARCHAR(40) NOT NULL DEFAULT 'sms_callback'
        CHECK (
            after_hours_action IN (
                'sms_callback',
                'voicemail',
                'on_call',
                'callback_queue'
            )
        ),

    on_call_phone VARCHAR(30),

    queue_next_business_day BOOLEAN NOT NULL DEFAULT TRUE,

    appointment_enabled BOOLEAN NOT NULL DEFAULT TRUE,

    ai_enabled BOOLEAN NOT NULL DEFAULT TRUE,

    ai_call_summary_enabled BOOLEAN NOT NULL DEFAULT TRUE,

    ai_intent_detection_enabled BOOLEAN NOT NULL DEFAULT TRUE,

    ai_appointment_detection_enabled BOOLEAN NOT NULL DEFAULT TRUE,

    ai_quality_review_enabled BOOLEAN NOT NULL DEFAULT TRUE,

    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- ROUTING SETTINGS
-- ============================================================

CREATE TABLE IF NOT EXISTS routing_settings (
    organization_id UUID PRIMARY KEY
        REFERENCES organizations(id)
        ON DELETE CASCADE,

    strategy VARCHAR(40) NOT NULL DEFAULT 'round_robin'
        CHECK (
            strategy IN (
                'round_robin',
                'least_calls',
                'longest_idle',
                'priority'
            )
        ),

    ring_seconds INTEGER NOT NULL DEFAULT 20
        CHECK (
            ring_seconds BETWEEN 5 AND 120
        ),

    max_attempts INTEGER NOT NULL DEFAULT 3
        CHECK (
            max_attempts BETWEEN 1 AND 20
        ),

    skip_busy BOOLEAN NOT NULL DEFAULT TRUE,

    overflow_action VARCHAR(40) NOT NULL DEFAULT 'voicemail'
        CHECK (
            overflow_action IN (
                'voicemail',
                'callback_queue',
                'on_call',
                'hangup'
            )
        ),

    overflow_phone VARCHAR(30),

    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- ROUND ROBIN STATE
-- Stored server-side so routing survives restarts
-- ============================================================

CREATE TABLE IF NOT EXISTS routing_state (
    organization_id UUID PRIMARY KEY
        REFERENCES organizations(id)
        ON DELETE CASCADE,

    last_employee_id UUID
        REFERENCES users(id)
        ON DELETE SET NULL,

    sequence BIGINT NOT NULL DEFAULT 0,

    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- CALLS
-- One record per inbound/outbound customer call
-- ============================================================

CREATE TABLE IF NOT EXISTS calls (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    organization_id UUID NOT NULL
        REFERENCES organizations(id)
        ON DELETE CASCADE,

    provider VARCHAR(30),

    provider_call_id VARCHAR(255),

    direction VARCHAR(20) NOT NULL DEFAULT 'inbound'
        CHECK (
            direction IN (
                'inbound',
                'outbound'
            )
        ),

    caller_phone VARCHAR(30),

    business_phone VARCHAR(30),

    assigned_user_id UUID
        REFERENCES users(id)
        ON DELETE SET NULL,

    status VARCHAR(40) NOT NULL DEFAULT 'received'
        CHECK (
            status IN (
                'received',
                'queued',
                'routing',
                'ringing',
                'answered',
                'completed',
                'missed',
                'failed',
                'voicemail',
                'after_hours',
                'callback_requested'
            )
        ),

    route_mode VARCHAR(30),

    started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    answered_at TIMESTAMPTZ,

    ended_at TIMESTAMPTZ,

    duration_seconds INTEGER,

    recording_url TEXT,

    transcript TEXT,

    disposition VARCHAR(100),

    customer_name VARCHAR(200),

    customer_email VARCHAR(255),

    notes TEXT,

    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_calls_provider_id
ON calls(provider, provider_call_id)
WHERE provider_call_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_calls_org_time
ON calls(organization_id, started_at DESC);

CREATE INDEX IF NOT EXISTS idx_calls_assignee
ON calls(assigned_user_id, started_at DESC);

CREATE INDEX IF NOT EXISTS idx_calls_status
ON calls(organization_id, status);

-- ============================================================
-- CALL ROUTING ATTEMPTS
-- Every employee ring attempt is recorded
-- ============================================================

CREATE TABLE IF NOT EXISTS call_attempts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    call_id UUID NOT NULL
        REFERENCES calls(id)
        ON DELETE CASCADE,

    user_id UUID
        REFERENCES users(id)
        ON DELETE SET NULL,

    attempt_number INTEGER NOT NULL,

    phone VARCHAR(30),

    started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    answered_at TIMESTAMPTZ,

    ended_at TIMESTAMPTZ,

    result VARCHAR(40)
        CHECK (
            result IN (
                'ringing',
                'answered',
                'no_answer',
                'busy',
                'declined',
                'failed',
                'skipped'
            )
        ),

    provider_leg_id VARCHAR(255),

    metadata JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_call_attempts_call
ON call_attempts(call_id, attempt_number);

-- ============================================================
-- CALLBACK QUEUE
-- ============================================================

CREATE TABLE IF NOT EXISTS callback_queue (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    organization_id UUID NOT NULL
        REFERENCES organizations(id)
        ON DELETE CASCADE,

    call_id UUID
        REFERENCES calls(id)
        ON DELETE SET NULL,

    customer_name VARCHAR(200),

    phone VARCHAR(30) NOT NULL,

    reason TEXT,

    priority INTEGER NOT NULL DEFAULT 100,

    status VARCHAR(30) NOT NULL DEFAULT 'pending'
        CHECK (
            status IN (
                'pending',
                'assigned',
                'contacted',
                'completed',
                'cancelled'
            )
        ),

    assigned_user_id UUID
        REFERENCES users(id)
        ON DELETE SET NULL,

    requested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    scheduled_for TIMESTAMPTZ,

    completed_at TIMESTAMPTZ,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_callback_pending
ON callback_queue(
    organization_id,
    status,
    priority,
    requested_at
);

-- ============================================================
-- APPOINTMENTS
-- ============================================================

CREATE TABLE IF NOT EXISTS appointments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    organization_id UUID NOT NULL
        REFERENCES organizations(id)
        ON DELETE CASCADE,

    assigned_user_id UUID
        REFERENCES users(id)
        ON DELETE SET NULL,

    call_id UUID
        REFERENCES calls(id)
        ON DELETE SET NULL,

    customer_name VARCHAR(200) NOT NULL,

    customer_phone VARCHAR(30),

    customer_email VARCHAR(255),

    appointment_type VARCHAR(120),

    scheduled_start TIMESTAMPTZ NOT NULL,

    scheduled_end TIMESTAMPTZ,

    status VARCHAR(30) NOT NULL DEFAULT 'scheduled'
        CHECK (
            status IN (
                'scheduled',
                'confirmed',
                'completed',
                'cancelled',
                'no_show'
            )
        ),

    source VARCHAR(40) NOT NULL DEFAULT 'manual'
        CHECK (
            source IN (
                'manual',
                'call',
                'ai',
                'web',
                'sms'
            )
        ),

    notes TEXT,

    created_by UUID
        REFERENCES users(id)
        ON DELETE SET NULL,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_appointments_org
ON appointments(
    organization_id,
    scheduled_start
);

CREATE INDEX IF NOT EXISTS idx_appointments_employee
ON appointments(
    assigned_user_id,
    scheduled_start
);

-- ============================================================
-- CUSTOMER MESSAGES
-- SMS / AI / after-hours conversation history
-- ============================================================

CREATE TABLE IF NOT EXISTS messages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    organization_id UUID NOT NULL
        REFERENCES organizations(id)
        ON DELETE CASCADE,

    call_id UUID
        REFERENCES calls(id)
        ON DELETE SET NULL,

    direction VARCHAR(20) NOT NULL
        CHECK (
            direction IN (
                'inbound',
                'outbound'
            )
        ),

    channel VARCHAR(20) NOT NULL DEFAULT 'sms'
        CHECK (
            channel IN (
                'sms',
                'email',
                'system'
            )
        ),

    from_address VARCHAR(255),

    to_address VARCHAR(255),

    body TEXT NOT NULL,

    provider VARCHAR(40),

    provider_message_id VARCHAR(255),

    status VARCHAR(30),

    ai_generated BOOLEAN NOT NULL DEFAULT FALSE,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_messages_org
ON messages(
    organization_id,
    created_at DESC
);

-- ============================================================
-- AI CALL ANALYSIS
-- ============================================================

CREATE TABLE IF NOT EXISTS ai_call_analysis (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    organization_id UUID NOT NULL
        REFERENCES organizations(id)
        ON DELETE CASCADE,

    call_id UUID NOT NULL
        REFERENCES calls(id)
        ON DELETE CASCADE,

    model VARCHAR(100),

    summary TEXT,

    intent VARCHAR(100),

    sentiment VARCHAR(40),

    urgency VARCHAR(30),

    lead_quality VARCHAR(30),

    appointment_requested BOOLEAN,

    callback_requested BOOLEAN,

    customer_questions JSONB NOT NULL DEFAULT '[]'::jsonb,

    action_items JSONB NOT NULL DEFAULT '[]'::jsonb,

    employee_coaching JSONB NOT NULL DEFAULT '[]'::jsonb,

    extracted_data JSONB NOT NULL DEFAULT '{}'::jsonb,

    confidence NUMERIC(5,4),

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ai_analysis_call
ON ai_call_analysis(call_id);

-- ============================================================
-- AI EVENTS
-- Tracks model activity and failures
-- ============================================================

CREATE TABLE IF NOT EXISTS ai_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    organization_id UUID
        REFERENCES organizations(id)
        ON DELETE CASCADE,

    call_id UUID
        REFERENCES calls(id)
        ON DELETE SET NULL,

    event_type VARCHAR(80) NOT NULL,

    model VARCHAR(100),

    success BOOLEAN NOT NULL,

    latency_ms INTEGER,

    error_message TEXT,

    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- AUDIT EVENTS
-- Administrative and security activity
-- ============================================================

CREATE TABLE IF NOT EXISTS audit_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    organization_id UUID
        REFERENCES organizations(id)
        ON DELETE CASCADE,

    actor_user_id UUID
        REFERENCES users(id)
        ON DELETE SET NULL,

    event_type VARCHAR(120) NOT NULL,

    entity_type VARCHAR(80),

    entity_id UUID,

    ip_address INET,

    user_agent TEXT,

    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_audit_org
ON audit_events(
    organization_id,
    created_at DESC
);

CREATE INDEX IF NOT EXISTS idx_audit_actor
ON audit_events(
    actor_user_id,
    created_at DESC
);

-- ============================================================
-- LOGIN SECURITY EVENTS
-- ============================================================

CREATE TABLE IF NOT EXISTS login_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    organization_id UUID
        REFERENCES organizations(id)
        ON DELETE CASCADE,

    user_id UUID
        REFERENCES users(id)
        ON DELETE SET NULL,

    email VARCHAR(255),

    successful BOOLEAN NOT NULL,

    ip_address INET,

    user_agent TEXT,

    failure_reason VARCHAR(120),

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_login_events
ON login_events(
    email,
    created_at DESC
);

-- ============================================================
-- WEBHOOK IDEMPOTENCY
-- Prevent duplicate provider events
-- ============================================================

CREATE TABLE IF NOT EXISTS webhook_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    provider VARCHAR(40) NOT NULL,

    external_event_id VARCHAR(255) NOT NULL,

    event_type VARCHAR(100),

    payload JSONB NOT NULL DEFAULT '{}'::jsonb,

    received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    processed_at TIMESTAMPTZ,

    status VARCHAR(30) NOT NULL DEFAULT 'received',

    error_message TEXT,

    UNIQUE (
        provider,
        external_event_id
    )
);

-- ============================================================
-- MIGRATION HISTORY
-- ============================================================

CREATE TABLE IF NOT EXISTS schema_migrations (
    version VARCHAR(100) PRIMARY KEY,

    applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO schema_migrations(version)
VALUES ('2026-08-callflow-v2-initial')
ON CONFLICT (ve
