-- Migration 004: Add explicit user ownership column on ai_decisions for strict IDOR isolation
ALTER TABLE ai_decisions
  ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES users(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_ai_decisions_user ON ai_decisions(user_id, created_at DESC);
