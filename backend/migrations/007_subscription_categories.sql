-- Rename the existing taxonomy once. Preserve payment, scheduling, history and private fields.
-- Increment affected row versions so an already-open editor cannot undo the reclassification.
UPDATE subscriptions
SET category = CASE category
    WHEN '购物会员' THEN '购物电商'
    WHEN '云盘存储' THEN '云存储'
    WHEN '效率办公' THEN '办公效率'
    WHEN '网络服务' THEN '云服务与网络'
    WHEN '生活服务' THEN '购物电商'
    WHEN '其他服务' THEN CASE WHEN trim(name) LIKE '盒马%' OR lower(trim(name)) LIKE 'freshippo%' OR lower(trim(name)) LIKE 'hema%' THEN '购物电商' ELSE '设计与创作' END
    ELSE '设计与创作'
  END,
  version = version + 1,
  updated_at = CAST(strftime('%s', 'now') AS INTEGER) * 1000
WHERE category IN ('购物会员', '云盘存储', '效率办公', '网络服务')
   OR (category IN ('影音娱乐', '其他服务')
       AND (trim(name) LIKE '醒图%' OR lower(trim(name)) LIKE 'xingtu%'))
   OR (category IN ('生活服务', '其他服务')
       AND (trim(name) LIKE '盒马%' OR lower(trim(name)) LIKE 'freshippo%' OR lower(trim(name)) LIKE 'hema%'));
