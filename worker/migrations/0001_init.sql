-- Collector state: 'meta' (JSON), 'acc' and 'last' (binary accumulators).
CREATE TABLE IF NOT EXISTS state (
  k TEXT PRIMARY KEY,
  v BLOB NOT NULL
);

-- Five-minute buckets. One row per (bucket start, item group of 100 slots);
-- data = Float32Array(100 × 6): buyAvg, sellAvg, buyMin, sellMax, tradesBuy, tradesSell.
CREATE TABLE IF NOT EXISTS buckets5 (
  t INTEGER NOT NULL,
  g INTEGER NOT NULL,
  data BLOB NOT NULL,
  PRIMARY KEY (t, g)
);

-- Hourly roll-up of buckets5 with the same layout (kept for 90 days).
CREATE TABLE IF NOT EXISTS hourly (
  t INTEGER NOT NULL,
  g INTEGER NOT NULL,
  data BLOB NOT NULL,
  PRIMARY KEY (t, g)
);

-- Latest derived JSON (24 h baselines per item + crash list). Only the newest row is kept.
CREATE TABLE IF NOT EXISTS derived (
  t INTEGER PRIMARY KEY,
  data TEXT NOT NULL
);

-- Discord alert de-duplication.
CREATE TABLE IF NOT EXISTS alerts (
  k TEXT PRIMARY KEY,
  t INTEGER NOT NULL
);
