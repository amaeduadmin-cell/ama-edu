-- ===============================================================
-- AMA EDU 0017 — enum extensions (must be its own migration: a new
-- enum value cannot be used in the transaction that adds it).
--   * director            new read-mostly school-owner role
--   * islamiyya, other    additional school sections
-- ===============================================================
alter type app.user_role     add value if not exists 'director';
alter type app.class_category add value if not exists 'islamiyya';
alter type app.class_category add value if not exists 'other';
