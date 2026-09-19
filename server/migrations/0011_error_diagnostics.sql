CREATE TABLE error_diagnostics (
    diagnostic_id INTEGER PRIMARY KEY AUTOINCREMENT,
    created_at_ms INTEGER NOT NULL,
    source TEXT NOT NULL,
    request_id TEXT,
    call_id TEXT,
    http_status INTEGER,
    category TEXT NOT NULL,
    title_key TEXT NOT NULL,
    reason_key TEXT NOT NULL,
    suggestion_key TEXT NOT NULL,
    message TEXT NOT NULL
);

CREATE INDEX error_diagnostics_created
ON error_diagnostics(created_at_ms DESC);

CREATE INDEX error_diagnostics_request
ON error_diagnostics(request_id, created_at_ms DESC);
