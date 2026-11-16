-- CalDef — retire catalogue entries that duplicate one of CalDef's own.
--
-- The import from free-exercise-db left out entries whose name CalDef
-- already had, but compared names exactly, so "Bench Dips" came in beside
-- "Bench Dip" and "Front Dumbbell Raise" beside "Dumbbell Front Raise".
-- One movement under two entries splits its history in two.
--
-- These 16 are RETIRED, not deleted: an archived row is hidden from the
-- library and the picker, and anything already logged with one keeps it,
-- its name and its history. Nothing is removed and no session changes.
-- The importer (scripts/import-free-exercise-db.mjs) now recognises them
-- as duplicates, so they do not come back with a later import.

update public.exercises
   set archived_at = now()
 where user_id is null
   and archived_at is null
   and slug in (
     'fx-bench-dips',
     'fx-concentration-curls',
     'fx-dumbbell-incline-row',
     'fx-dumbbell-lunges',
     'fx-front-dumbbell-raise',
     'fx-hammer-curls',
     'fx-leg-extensions',
     'fx-lying-leg-curls',
     'fx-machine-bicep-curl',
     'fx-machine-preacher-curls',
     'fx-mountain-climbers',
     'fx-pullups',
     'fx-pushups',
     'fx-rack-pulls',
     'fx-seated-cable-rows',
     'fx-standing-calf-raises'
   );
