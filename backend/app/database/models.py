"""SQLite schema. Applied with CREATE TABLE IF NOT EXISTS on startup."""

SCHEMA = """
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS sessions (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    name              TEXT NOT NULL,
    notes             TEXT,
    status            TEXT NOT NULL CHECK (status IN ('active', 'completed', 'interrupted')),
    started_at        TEXT NOT NULL,
    ended_at          TEXT,
    port              TEXT,
    source            TEXT NOT NULL CHECK (source IN ('hardware', 'test')),
    sample_period_us  INTEGER,
    store_decimation  INTEGER NOT NULL,
    stored_samples    INTEGER NOT NULL DEFAULT 0,
    storage_capped    INTEGER NOT NULL DEFAULT 0
);

-- Each row is the average of `n_averaged` consecutive samples (DB_STORE_DECIMATION).
CREATE TABLE IF NOT EXISTS samples (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id     INTEGER NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    sample_index   INTEGER NOT NULL,
    t_us           INTEGER NOT NULL,
    voltage_v      REAL NOT NULL,
    current_ma     REAL NOT NULL,
    power_mw       REAL NOT NULL,
    energy_mj      REAL NOT NULL,
    function_name  TEXT,
    n_averaged     INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_samples_session ON samples(session_id, t_us);

CREATE TABLE IF NOT EXISTS energy_summaries (
    session_id          INTEGER PRIMARY KEY REFERENCES sessions(id) ON DELETE CASCADE,
    energy_mj           REAL NOT NULL,
    integrated_time_s   REAL NOT NULL,
    missing_time_s      REAL NOT NULL,
    average_power_mw    REAL,
    average_current_ma  REAL,
    peak_power_mw       REAL,
    peak_current_ma     REAL,
    sample_count        INTEGER NOT NULL,
    lost_samples        INTEGER NOT NULL,
    packet_errors       INTEGER NOT NULL,
    summary_json        TEXT NOT NULL,
    created_at          TEXT NOT NULL
);

-- One row per completed (or incomplete) function window.
CREATE TABLE IF NOT EXISTS function_measurements (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id     INTEGER NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    function_name  TEXT NOT NULL,
    source         TEXT NOT NULL CHECK (source IN ('firmware', 'gpio')),
    start_us       INTEGER NOT NULL,
    end_us         INTEGER NOT NULL,
    duration_us    INTEGER NOT NULL,
    complete       INTEGER NOT NULL,
    energy_mj      REAL,
    avg_power_mw   REAL,
    max_power_mw   REAL,
    note           TEXT
);
CREATE INDEX IF NOT EXISTS idx_fm_session ON function_measurements(session_id);

CREATE TABLE IF NOT EXISTS optimization_reports (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id    INTEGER REFERENCES sessions(id) ON DELETE SET NULL,
    created_at    TEXT NOT NULL,
    board         TEXT,
    request_json  TEXT NOT NULL,
    report_json   TEXT NOT NULL
);
"""
