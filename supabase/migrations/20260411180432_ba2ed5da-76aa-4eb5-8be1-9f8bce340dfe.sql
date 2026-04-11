INSERT INTO agent_feature_flags (agent_id, feature_key, enabled)
VALUES ('799c5a12-a9b5-48f1-b6bd-748742fcf72d', 'ai_assistant', true)
ON CONFLICT (agent_id, feature_key) DO UPDATE SET enabled = true;