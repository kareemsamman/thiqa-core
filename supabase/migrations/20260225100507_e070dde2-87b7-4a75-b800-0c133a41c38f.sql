UPDATE media_files mf
SET branch_id = p.branch_id
FROM policies p
WHERE mf.entity_id = p.id
  AND mf.entity_type = 'policy_insurance'
  AND mf.storage_path IS NULL
  AND mf.size = 0
  AND mf.branch_id IS NULL;