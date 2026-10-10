# LeadCRM database seeding

The standard seed entry point is `backend/prisma/seed.ts`. It runs role repairs, optionally configures the Gmail system sender when its environment variables are set, and generates sample tenants only outside production unless `SKIP_DEMO_TENANTS=true`. Server startup does not seed users or reset passwords.

Run `npm --prefix backend run db:seed` only against the intended development database when sample data is needed. Migrations use `npm --prefix backend run db:deploy` and do not require reseeding.

See [available seeders](../../backend/src/database/seeders/README.md), [authentication](../authentication.md), and [deployment](../setup/deployment.md). Employee login still enforces the configured employee email policy; older demo addresses do not bypass it.
