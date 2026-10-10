-- Reuse the existing authenticated revision stream for Group names/memberships.
CREATE TRIGGER dashboard_revision AFTER INSERT OR UPDATE OR DELETE ON "TenantGroup"
FOR EACH ROW EXECUTE FUNCTION leadcrm_dashboard_revision('access');
CREATE TRIGGER dashboard_revision AFTER INSERT OR UPDATE OR DELETE ON "TenantGroupMember"
FOR EACH ROW EXECUTE FUNCTION leadcrm_dashboard_revision('access');
