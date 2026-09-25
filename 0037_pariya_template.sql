-- ===============================================================
-- AMA EDU 0037 — Template 4: "Pariya Classic" (report-card spec, section 1)
--
-- Registers the 'pariya' code so schools can select/preview it exactly
-- like Template 1/2/3, through the existing template-picker.js and
-- Academic settings' Report card tab. Rendering lives in
-- src/lib/reportcard.js (pariyaCard()) and src/styles/reportcard.css
-- (.rc-pariya / rc4-* rules) -- this migration only adds the DB row.
-- ===============================================================

insert into public.report_card_templates (code, name, description, preview_note, options, sort_order, is_active)
values (
  'pariya', 'Template 4 — Pariya Classic',
  'An exact port of the Pariya report sheet: brown-bordered header with a green term banner, a three-column bordered info box, an annual/session summary box and a QR verification code.',
  'Best for schools that used the original Pariya system and want their families to see the same familiar layout.',
  '{"accent":"pariya","layout":"pariya","show_photo":true,"show_attendance":true,"show_subject_position":true,"show_annual_summary":true,"show_verification_qr":true}'::jsonb,
  4, true
)
on conflict (code) do nothing;
