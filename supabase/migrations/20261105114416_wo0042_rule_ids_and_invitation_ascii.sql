-- WO-0042 (R2a fix loop 1): two input constraints found by the independent review.
--
-- F9: suggestion_feedback holds no item IDs (LLD 4.4), but rule_ids was a free text[]. Every element must be a rule ID: an
-- upper-case letter, then up to 15 upper-case letters, digits or underscores. The check reads the array's canonical text form,
-- which quotes any element that holds a comma, space, quote, brace, backslash or nothing at all, so no such element can match
-- the pattern; a NULL element prints unquoted, so it is refused separately. No function is involved, so no execute privilege is
-- needed at insert time.
alter table app.suggestion_feedback add constraint suggestion_feedback_rule_ids_format
  check (rule_ids::text ~ '^\{([A-Z][A-Z0-9_]{0,15}(,[A-Z][A-Z0-9_]{0,15})*)?\}$' and array_position(rule_ids, null) is null);

-- F10: an invitation is a lower-case, printable-ASCII address with no spaces. The hook compares lower(event email) with this
-- column, and lower() of some non-ASCII characters (for example the Kelvin sign) is plain ASCII, so the stored side must be ASCII.
alter table ops.invitations add constraint invitations_email_ascii check (email ~ '^[!-~]+$');
