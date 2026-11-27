-- Migration 002: Revoke all existing refresh sessions issued prior to
-- removing the predictable JWT fallback secret and enabling HMAC-keyed refresh hashes.
UPDATE refresh_tokens
SET revoked_at = COALESCE(revoked_at, NOW())
WHERE revoked_at IS NULL;
