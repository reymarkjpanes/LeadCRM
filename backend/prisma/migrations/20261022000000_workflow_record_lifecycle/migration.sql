ALTER TABLE "Lead" ADD COLUMN "productInterestOther" TEXT;
ALTER TABLE "Contact" ADD COLUMN "productInterestOther" TEXT;
ALTER TABLE "Account" ADD COLUMN "productInterestOther" TEXT;
ALTER TABLE "Deal" ADD COLUMN "productInterestOther" TEXT;
ALTER TABLE "Deal" ADD COLUMN "hasEverBeenWon" BOOLEAN NOT NULL DEFAULT false;
-- Existing negative histories cannot be proved complete. New opportunities start
-- with a verified empty history; legacy rows require an explicit history audit.
ALTER TABLE "Deal" ADD COLUMN "wonHistoryVerified" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Deal" ALTER COLUMN "wonHistoryVerified" SET DEFAULT true;

-- Keep the lifetime sales outcome even if an older client moved a won Deal again.
-- The stage-history query is not limited to the recent history shown in the UI.
UPDATE "Deal" AS d
SET "hasEverBeenWon" = true, "wonHistoryVerified" = true
WHERE d."wonConfirmedAt" IS NOT NULL
   OR EXISTS (
     SELECT 1 FROM "Stage" AS s
     WHERE s.id = d."stageId" AND s."tenantId" = d."tenantId" AND s."isWon" = true
   )
   OR EXISTS (
     SELECT 1 FROM "DealStageHistory" AS h
     JOIN "Stage" AS s ON (s.id = h."newStageId" OR s.id = h."previousStageId")
       AND s."tenantId" = h."tenantId" AND s."isWon" = true
     WHERE h."dealId" = d.id AND h."tenantId" = d."tenantId"
   );

-- Preserve the lifetime outcome even for internal writes outside CRM services.
CREATE FUNCTION "preserve_deal_won_history"() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    NEW."hasEverBeenWon" := OLD."hasEverBeenWon" OR NEW."hasEverBeenWon";
    NEW."wonHistoryVerified" := OLD."wonHistoryVerified" OR NEW."wonHistoryVerified";
  END IF;
  IF NEW."wonConfirmedAt" IS NOT NULL OR EXISTS (
    SELECT 1 FROM "Stage" s
    WHERE s.id = NEW."stageId" AND s."tenantId" = NEW."tenantId" AND s."isWon" = true
  ) THEN
    NEW."hasEverBeenWon" := true;
  END IF;
  IF NEW."hasEverBeenWon" THEN NEW."wonHistoryVerified" := true; END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "Deal_preserve_won_history"
BEFORE INSERT OR UPDATE ON "Deal"
FOR EACH ROW EXECUTE FUNCTION "preserve_deal_won_history"();
