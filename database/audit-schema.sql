CREATE TABLE IF NOT EXISTS audit_events (
  id TEXT PRIMARY KEY,
  event_group_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  actor_username TEXT NOT NULL DEFAULT '',
  actor_full_name TEXT NOT NULL DEFAULT '',
  actor_role TEXT NOT NULL DEFAULT '',
  company_name TEXT NOT NULL DEFAULT '',
  base_id TEXT NOT NULL DEFAULT '',
  table_name TEXT NOT NULL DEFAULT '',
  record_id TEXT NOT NULL DEFAULT '',
  record_label TEXT NOT NULL DEFAULT '',
  module TEXT NOT NULL DEFAULT '',
  action TEXT NOT NULL DEFAULT '',
  operation TEXT NOT NULL CHECK (
    operation IN ('CREATE', 'UPDATE', 'DELETE')
  ),
  old_data TEXT NOT NULL DEFAULT 'null',
  new_data TEXT NOT NULL DEFAULT 'null',
  changed_fields TEXT NOT NULL DEFAULT '{}',
  source_host TEXT NOT NULL DEFAULT '',
  metadata TEXT NOT NULL DEFAULT '{}'
);

CREATE INDEX IF NOT EXISTS audit_events_created_at_idx
ON audit_events (created_at DESC);

CREATE INDEX IF NOT EXISTS audit_events_actor_idx
ON audit_events (actor_username, created_at DESC);

CREATE INDEX IF NOT EXISTS audit_events_company_idx
ON audit_events (company_name, created_at DESC);

CREATE INDEX IF NOT EXISTS audit_events_table_idx
ON audit_events (table_name, created_at DESC);

CREATE INDEX IF NOT EXISTS audit_events_record_idx
ON audit_events (record_id, created_at DESC);

CREATE INDEX IF NOT EXISTS audit_events_module_action_idx
ON audit_events (module, action, created_at DESC);
