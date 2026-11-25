-- The record an interview was made for in the system that created it (Ramp's
-- requisition), shown as a link on the interview page. Null for everything else.
alter table public.interviews
  add column "externalReference" text
    constraint interviews_external_reference_length check ("externalReference" is null or char_length("externalReference") between 1 and 40),
  add column "externalUrl" text
    constraint interviews_external_url_https check ("externalUrl" is null or ("externalUrl" like 'https://%' and char_length("externalUrl") <= 500)),
  add constraint interviews_external_link_pair check (("externalReference" is null) = ("externalUrl" is null));
