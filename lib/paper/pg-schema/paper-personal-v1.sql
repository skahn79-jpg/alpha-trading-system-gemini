-- =============================================================================
-- DORMANT ARTIFACT — DO NOT EXECUTE
-- GATE: 12AK-R31
-- SCHEMA_CONTRACT_ID: paper-personal-v1
-- VERSION: 1
-- PURPOSE: Personal single-user PostgreSQL physical schema definition only.
-- NO migration runner. NO apply. NO real Postgres connection. NO network.
-- NO Paper/Live enablement. NO stored procedures. NO Dynamo/range/fence columns.
-- Prefer fail-closed: plain CREATE TABLE (no IF NOT EXISTS); plain INSERT
-- bootstrap (no ON CONFLICT DO NOTHING).
-- =============================================================================

-- (1) Schema version metadata
CREATE TABLE paper_schema_version (
  schema_id TEXT NOT NULL
    CONSTRAINT paper_schema_version_pk PRIMARY KEY,
  version INT NOT NULL,
  applied_at TIMESTAMPTZ NOT NULL
);

INSERT INTO paper_schema_version (schema_id, version, applied_at)
VALUES ('paper-personal-v1', 1, clock_timestamp());

-- (2) Runtime singleton authority (lease / process generation)
CREATE TABLE paper_runtime_authority (
  authority_id TEXT NOT NULL
    CONSTRAINT paper_runtime_authority_pk PRIMARY KEY,
  active_process_generation_id UUID NULL,
  lease_expires_at TIMESTAMPTZ NULL,
  revision BIGINT NOT NULL
    CONSTRAINT paper_runtime_authority_revision_nonneg_chk
      CHECK (revision >= 0),
  started_at TIMESTAMPTZ NULL,
  updated_at TIMESTAMPTZ NOT NULL
);

INSERT INTO paper_runtime_authority (
  authority_id,
  active_process_generation_id,
  lease_expires_at,
  revision,
  started_at,
  updated_at
) VALUES (
  'paper-runtime-v1',
  NULL,
  NULL,
  0,
  NULL,
  clock_timestamp()
);

-- (3) Account state (no migration bootstrap account/capital)
CREATE TABLE paper_account_state (
  paper_account_id UUID NOT NULL
    CONSTRAINT paper_account_state_pk PRIMARY KEY,
  cash NUMERIC(20,4) NOT NULL
    CONSTRAINT paper_account_state_cash_nonneg_chk
      CHECK (cash >= 0),
  realized_pnl NUMERIC(20,4) NOT NULL,
  revision BIGINT NOT NULL
    CONSTRAINT paper_account_state_revision_nonneg_chk
      CHECK (revision >= 0),
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL
);

-- (4) Position projection
CREATE TABLE paper_position (
  paper_account_id UUID NOT NULL,
  market TEXT NOT NULL,
  symbol TEXT NOT NULL,
  quantity BIGINT NOT NULL
    CONSTRAINT paper_position_quantity_nonneg_chk
      CHECK (quantity >= 0),
  average_cost NUMERIC(20,4) NOT NULL,
  realized_pnl NUMERIC(20,4) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  CONSTRAINT paper_position_pk
    PRIMARY KEY (paper_account_id, market, symbol),
  CONSTRAINT paper_position_account_fk
    FOREIGN KEY (paper_account_id)
      REFERENCES paper_account_state (paper_account_id)
      ON DELETE RESTRICT,
  CONSTRAINT paper_position_market_domain_chk
    CHECK (market IN ('KOSPI', 'KOSDAQ', 'SYNTHETIC_KOSPI', 'SYNTHETIC_KOSDAQ')),
  CONSTRAINT paper_position_symbol_canonical_chk
    CHECK (
      symbol = BTRIM(symbol)
      AND symbol <> ''
      AND symbol !~ '\s'
    )
);

-- (5) Order intent
CREATE TABLE paper_order_intent (
  order_intent_id UUID NOT NULL
    CONSTRAINT paper_order_intent_pk PRIMARY KEY,
  paper_account_id UUID NOT NULL,
  idempotency_key VARCHAR(128) NOT NULL,
  request_digest CHAR(64) NOT NULL
    CONSTRAINT paper_order_intent_digest_hex_chk
      CHECK (request_digest ~ '^[0-9a-fA-F]{64}$'),
  market TEXT NOT NULL,
  symbol TEXT NOT NULL,
  side TEXT NOT NULL,
  quantity BIGINT NOT NULL
    CONSTRAINT paper_order_intent_quantity_pos_chk
      CHECK (quantity > 0),
  order_type TEXT NOT NULL,
  requested_price NUMERIC(20,4) NULL,
  status TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  CONSTRAINT paper_order_intent_account_fk
    FOREIGN KEY (paper_account_id)
      REFERENCES paper_account_state (paper_account_id)
      ON DELETE RESTRICT,
  CONSTRAINT paper_order_intent_market_domain_chk
    CHECK (market IN ('KOSPI', 'KOSDAQ', 'SYNTHETIC_KOSPI', 'SYNTHETIC_KOSDAQ')),
  CONSTRAINT paper_order_intent_symbol_canonical_chk
    CHECK (
      symbol = BTRIM(symbol)
      AND symbol <> ''
      AND symbol !~ '\s'
    ),
  CONSTRAINT paper_order_intent_side_domain_chk
    CHECK (side IN ('BUY', 'SELL')),
  CONSTRAINT paper_order_intent_order_type_domain_chk
    CHECK (order_type IN ('MARKET_OPEN')),
  CONSTRAINT paper_order_intent_market_open_price_null_chk
    CHECK (order_type <> 'MARKET_OPEN' OR requested_price IS NULL),
  CONSTRAINT paper_order_intent_status_domain_chk
    CHECK (status IN (
      'CREATED',
      'RISK_BLOCKED',
      'AWAITING_APPROVAL',
      'APPROVED',
      'EXECUTION_PENDING',
      'FILLED',
      'CANCELLED',
      'FAILED',
      'UNKNOWN'
    ))
);

-- (6) Idempotency record
CREATE TABLE paper_idempotency_record (
  paper_account_id UUID NOT NULL,
  idempotency_key VARCHAR(128) NOT NULL,
  request_digest CHAR(64) NOT NULL
    CONSTRAINT paper_idempotency_record_digest_hex_chk
      CHECK (request_digest ~ '^[0-9a-fA-F]{64}$'),
  order_intent_id UUID NOT NULL,
  status TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  completed_at TIMESTAMPTZ NULL,
  CONSTRAINT paper_idempotency_record_pk
    PRIMARY KEY (paper_account_id, idempotency_key),
  CONSTRAINT paper_idempotency_record_account_fk
    FOREIGN KEY (paper_account_id)
      REFERENCES paper_account_state (paper_account_id)
      ON DELETE RESTRICT,
  CONSTRAINT paper_idempotency_record_intent_fk
    FOREIGN KEY (order_intent_id)
      REFERENCES paper_order_intent (order_intent_id)
      ON DELETE RESTRICT,
  CONSTRAINT paper_idempotency_record_status_domain_chk
    CHECK (status IN ('OPEN', 'COMPLETED', 'CONFLICT'))
);

-- (7) Execution record (one authoritative execution per order intent)
CREATE TABLE paper_execution_record (
  execution_id UUID NOT NULL
    CONSTRAINT paper_execution_record_pk PRIMARY KEY,
  paper_account_id UUID NOT NULL,
  order_intent_id UUID NOT NULL,
  status TEXT NOT NULL,
  executed_quantity BIGINT NOT NULL
    CONSTRAINT paper_execution_record_qty_nonneg_chk
      CHECK (executed_quantity >= 0),
  executed_price NUMERIC(20,4) NULL,
  executed_at TIMESTAMPTZ NULL,
  error_code TEXT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  CONSTRAINT paper_execution_record_order_intent_uq
    UNIQUE (order_intent_id),
  CONSTRAINT paper_execution_record_account_fk
    FOREIGN KEY (paper_account_id)
      REFERENCES paper_account_state (paper_account_id)
      ON DELETE RESTRICT,
  CONSTRAINT paper_execution_record_intent_fk
    FOREIGN KEY (order_intent_id)
      REFERENCES paper_order_intent (order_intent_id)
      ON DELETE RESTRICT,
  CONSTRAINT paper_execution_record_status_domain_chk
    CHECK (status IN ('PENDING', 'FILLED', 'BLOCKED', 'FAILED', 'UNKNOWN')),
  CONSTRAINT paper_execution_record_filled_payload_chk
    CHECK (
      status <> 'FILLED'
      OR (
        executed_quantity > 0
        AND executed_price IS NOT NULL
        AND executed_at IS NOT NULL
      )
    ),
  CONSTRAINT paper_execution_record_nonfilled_payload_chk
    CHECK (
      status = 'FILLED'
      OR (
        executed_quantity = 0
        AND executed_price IS NULL
        AND executed_at IS NULL
      )
    )
);

-- (8) Ledger entry (immutable audit; privilege enforcement is runtime/role Gate)
CREATE TABLE paper_ledger_entry (
  ledger_entry_id UUID NOT NULL
    CONSTRAINT paper_ledger_entry_pk PRIMARY KEY,
  paper_account_id UUID NOT NULL,
  execution_id UUID NOT NULL,
  entry_type TEXT NOT NULL,
  amount NUMERIC(20,4) NULL,
  quantity BIGINT NULL,
  market TEXT NULL,
  symbol TEXT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  CONSTRAINT paper_ledger_entry_account_fk
    FOREIGN KEY (paper_account_id)
      REFERENCES paper_account_state (paper_account_id)
      ON DELETE RESTRICT,
  CONSTRAINT paper_ledger_entry_execution_fk
    FOREIGN KEY (execution_id)
      REFERENCES paper_execution_record (execution_id)
      ON DELETE RESTRICT,
  CONSTRAINT paper_ledger_entry_type_domain_chk
    CHECK (entry_type IN (
      'CASH_DEBIT',
      'CASH_CREDIT',
      'POSITION_INCREASE',
      'POSITION_DECREASE',
      'REALIZED_PNL',
      'FEE',
      'TAX',
      'ADJUSTMENT'
    )),
  CONSTRAINT paper_ledger_entry_cashish_payload_chk
    CHECK (
      entry_type NOT IN (
        'CASH_DEBIT',
        'CASH_CREDIT',
        'REALIZED_PNL',
        'FEE',
        'TAX',
        'ADJUSTMENT'
      )
      OR amount IS NOT NULL
    ),
  CONSTRAINT paper_ledger_entry_position_payload_chk
    CHECK (
      entry_type NOT IN ('POSITION_INCREASE', 'POSITION_DECREASE')
      OR (
        quantity IS NOT NULL
        AND market IS NOT NULL
        AND symbol IS NOT NULL
      )
    ),
  CONSTRAINT paper_ledger_entry_market_domain_chk
    CHECK (
      market IS NULL
      OR market IN ('KOSPI', 'KOSDAQ', 'SYNTHETIC_KOSPI', 'SYNTHETIC_KOSDAQ')
    ),
  CONSTRAINT paper_ledger_entry_symbol_canonical_chk
    CHECK (
      symbol IS NULL
      OR (
        symbol = BTRIM(symbol)
        AND symbol <> ''
        AND symbol !~ '\s'
      )
    )
);

CREATE UNIQUE INDEX uq_paper_ledger_execution_effect
  ON paper_ledger_entry (
    execution_id,
    entry_type,
    (COALESCE(market, '')),
    (COALESCE(symbol, ''))
  );

-- (9) Kill switch (fail-closed bootstrap)
CREATE TABLE paper_kill_switch (
  switch_id TEXT NOT NULL
    CONSTRAINT paper_kill_switch_pk PRIMARY KEY,
  state TEXT NOT NULL,
  revision BIGINT NOT NULL
    CONSTRAINT paper_kill_switch_revision_nonneg_chk
      CHECK (revision >= 0),
  updated_at TIMESTAMPTZ NOT NULL,
  reason TEXT NULL,
  CONSTRAINT paper_kill_switch_state_domain_chk
    CHECK (state IN ('EXECUTION_ALLOWED', 'EXECUTION_DISABLED'))
);

INSERT INTO paper_kill_switch (
  switch_id,
  state,
  revision,
  updated_at,
  reason
) VALUES (
  'paper-kill-v1',
  'EXECUTION_DISABLED',
  0,
  clock_timestamp(),
  NULL
);

-- Indexes (beyond PK/UNIQUE coverage)
CREATE INDEX idx_paper_execution_pending_unknown
  ON paper_execution_record (paper_account_id, status)
  WHERE status IN ('PENDING', 'UNKNOWN');

CREATE INDEX idx_paper_ledger_account_created
  ON paper_ledger_entry (paper_account_id, created_at);

-- AUTHORITY_TRIGGERS = 0 (no CREATE TRIGGER)
-- FINANCIAL_STORED_PROCEDURES_ADDED = 0
-- NO CREATE EXTENSION (application supplies UUID v4)
