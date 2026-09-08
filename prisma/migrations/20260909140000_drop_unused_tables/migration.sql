-- Remove unused tables: no code ever wrote to or read from these.
-- Environment data is already captured as fields on DiaryUpdate;
-- calendar events were never implemented.
DROP TABLE IF EXISTS "CalendarEvent";
DROP TABLE IF EXISTS "EnvironmentReading";
