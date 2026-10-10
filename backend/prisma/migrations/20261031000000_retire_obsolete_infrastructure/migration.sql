-- Supported routes/jobs at revision 989e84fa no longer read or write these models.
-- Refuse retirement if another installation still has data needing a decision.
BEGIN;
SET LOCAL lock_timeout = '10s';
LOCK TABLE "DealAction", "AutomationRule", "SMSQueue", "EmailVerificationToken", "Task" IN ACCESS EXCLUSIVE MODE;
DO $$
DECLARE target text; populated boolean;
BEGIN
  FOREACH target IN ARRAY ARRAY['DealAction','AutomationRule','SMSQueue','EmailVerificationToken'] LOOP
    EXECUTE format('SELECT EXISTS (SELECT 1 FROM %I)', target) INTO populated;
    IF populated THEN RAISE EXCEPTION 'Retirement blocked: % contains data requiring export or migration.', target; END IF;
    IF EXISTS (SELECT 1 FROM pg_constraint WHERE contype='f' AND confrelid=to_regclass(format('%I',target))) THEN
      RAISE EXCEPTION 'Retirement blocked: % has an unexpected inbound foreign key.', target;
    END IF;
  END LOOP;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='Task' AND column_name='organizationId') THEN
    EXECUTE 'SELECT EXISTS (SELECT 1 FROM "Task" WHERE "organizationId" IS NOT NULL)' INTO populated;
    IF populated THEN RAISE EXCEPTION 'Retirement blocked: Task.organizationId must be reconciled to TaskAccount first.'; END IF;
  END IF;
END $$;
DROP TABLE "DealAction";
DROP TABLE "AutomationRule";
DROP TABLE "SMSQueue";
DROP TABLE "EmailVerificationToken";
DROP TYPE "DealActionType";
ALTER TABLE "Task" DROP COLUMN IF EXISTS "organizationId";
COMMIT;
