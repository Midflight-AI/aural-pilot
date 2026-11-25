-- Null for interview questions and all earlier recordings. Zero marks an introduction without recorded audio.
alter table public.messages add column "introductionEndSeconds" double precision
  check ("introductionEndSeconds" is null or ("introductionEndSeconds" >= 0 and "introductionEndSeconds" < 'Infinity'::double precision and "questionId" is null));
