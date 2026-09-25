-- ===============================================================
-- AMA EDU 0033 — backfill: report_card_templates 'heritage' row
--
-- The live database already has a 'heritage' (Template 3) row in
-- report_card_templates -- it was added by hand at some point and
-- never captured in a migration file. Anyone rebuilding this schema
-- from the migrations alone would get Template 3's frontend (already
-- shipped: src/lib/reportcard.js richCard() + the .rc-rich styles in
-- reportcard.css) with no matching database row, which trips the
-- schools.report_card_template -> report_card_templates(code) FK the
-- moment a school tries to select it.
--
-- Purely additive, `on conflict do nothing` so it is a no-op against
-- the current production database, and only fills the gap elsewhere
-- (fresh installs, other branches/environments).
-- ===============================================================

insert into public.report_card_templates (code, name, description, preview_note, options, sort_order, is_active)
values (
  'heritage', 'Template 3 — Heritage',
  'A navy-bordered sheet with a banner-pill title, a bordered three-column info box and a signatures row.',
  'Best for schools that want the classic bordered report-sheet look.',
  '{"accent":"heritage","layout":"heritage","show_photo":true,"show_attendance":true,"show_subject_position":true}'::jsonb,
  3, true
)
on conflict (code) do nothing;
