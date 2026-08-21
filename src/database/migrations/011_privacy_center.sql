CREATE TABLE IF NOT EXISTS privacy_requests (
  id BIGSERIAL PRIMARY KEY,
  user_id TEXT NOT NULL,
  request_type TEXT NOT NULL CHECK (request_type IN ('export', 'delete')),
  categories TEXT[] NOT NULL DEFAULT '{}',
  note TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  requested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  reviewed_at TIMESTAMPTZ,
  reviewed_by TEXT,
  owner_note TEXT,
  result JSONB,
  CHECK (cardinality(categories) BETWEEN 1 AND 8)
);
CREATE INDEX IF NOT EXISTS idx_privacy_requests_status ON privacy_requests (status, requested_at);
CREATE INDEX IF NOT EXISTS idx_privacy_requests_user ON privacy_requests (user_id, requested_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS idx_privacy_requests_pending_delete
  ON privacy_requests (user_id) WHERE status = 'pending' AND request_type = 'delete';

CREATE OR REPLACE FUNCTION decide_privacy_request(
  p_request_id BIGINT,
  p_expected_user_id TEXT,
  p_expected_categories TEXT[],
  p_status TEXT,
  p_reviewed_at TIMESTAMPTZ,
  p_reviewed_by TEXT,
  p_owner_note TEXT,
  p_result JSONB
)
RETURNS SETOF privacy_requests
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE privacy_requests SET
    status = p_status,
    reviewed_at = p_reviewed_at,
    reviewed_by = p_reviewed_by,
    owner_note = p_owner_note,
    result = p_result
  WHERE id = p_request_id
    AND status = 'pending'
    AND user_id = p_expected_user_id
    AND categories = p_expected_categories
    AND p_status IN ('approved', 'rejected')
  RETURNING *;
$$;

ALTER TABLE privacy_requests ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON privacy_requests FROM anon, authenticated;
REVOKE ALL ON SEQUENCE privacy_requests_id_seq FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON privacy_requests TO service_role;
GRANT USAGE, SELECT ON SEQUENCE privacy_requests_id_seq TO service_role;
REVOKE ALL ON FUNCTION decide_privacy_request(BIGINT, TEXT, TEXT[], TEXT, TIMESTAMPTZ, TEXT, TEXT, JSONB) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION decide_privacy_request(BIGINT, TEXT, TEXT[], TEXT, TIMESTAMPTZ, TEXT, TEXT, JSONB) TO service_role;

NOTIFY pgrst, 'reload schema';
