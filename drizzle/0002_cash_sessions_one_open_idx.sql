-- Custom SQL migration file, put your code below! --
-- Enforce at most one open (closed_at IS NULL) cash session at a time.
-- Postgres treats NULLs as distinct in a regular unique index, so a unique
-- index on (closed_at) WHERE closed_at IS NULL would NOT reject duplicates
-- (every row would have a "different" NULL). Instead we index a constant
-- expression `(1)` restricted to open rows: since all indexed rows share the
-- same key value `1`, a second concurrent INSERT of an open session collides
-- and raises a unique_violation, which the app layer maps to
-- SESSION_ALREADY_OPEN.
CREATE UNIQUE INDEX "cash_sessions_one_open_idx" ON "cash_sessions" ((1)) WHERE "closed_at" IS NULL;
