# Campaign quotation templates

Quotation Templates is the fourth Campaigns view. The existing Campaigns table,
reporting, Email Templates and SMS Templates retain their existing flows.

## Implementation and reuse

Changed areas: Campaigns page plus the new quotation UI/API client and focused
tests; shared quotation/Campaign contracts and generated JavaScript companions;
template validation/search/seeding; Campaign quotation controller/service/PDF
renderer; internal Gmail send/receipt/MIME support; optional Product-selector
search and currency formatting; backend dependencies, font assets and Docker
asset copying. Browser/database verification scripts and this API reference
document the feature. Existing Contact changes are retained separately.

- Templates use existing `Template` rows with `type: Quotation`. `content` holds
  validated JSON containing title, header, introduction, fixed table layout and
  footer. Recipient/Product selections belong to the session-local wizard.
- The UI reuses ModuleTabs, Campaign card styling, ModuleTableToolbar,
  ModuleFilterRail, LeadsPagination, SideSheet and its draft-close guard, Button,
  Badge, TableIconButton, EntityCombobox, ProductInterestSelect, DatePicker and
  the Campaign variable picker/cursor utility. Product search and quotation
  variable grouping are opt-in extensions to existing controls.
- New UI is limited to the Campaign quotation list/editor, four-step wizard and
  variable-field wrapper. No compatible quotation editor or wizard existed.
- No quotation database migration, lifecycle table or separate permission system
  is introduced. The independent Contact `companyName` migration remains a
  prerequisite; see [the Contact rename](contact-company-name.md).

## Variables and data

The shared Campaign parser, renderer, catalog and server personalization function
remain authoritative. Quotation grouping leaves Email/SMS groups unchanged.

| Group | Source |
| --- | --- |
| Recipient | The selected authorized Lead or Contact; both use `companyName` |
| Account | The recipient's authorized Account relationship; explicit `accountName` and `accountAddress` |
| Sender | Authenticated user's name, email and supported job title |
| Organization | Current tenant's Organization Settings name, address, email and phone |
| Quotation Details | Current document number, dates and total |

Account phone and organization logo are unavailable in the current schema.
Products use the fixed table instead of repeatable text variables. Unresolved
placeholders are preserved in reusable-template PDFs; final documents reject
unknown variables and missing required Account relationships.

The four steps are Recipient, Products, Quotation Details and Preview. Deal is
optional and must be an authorized existing recipient relationship. Product prices
come from active tenant Product records. Quantities are positive whole numbers;
the backend uses decimal arithmetic for line totals and the grand total. There
are no taxes, discounts, shipping charges or editable price overrides.

## API and sending

Existing template CRUD supports Quotation records. Switching an existing template
between quotation and messaging formats is rejected.

| Endpoint | Behavior |
| --- | --- |
| `GET /marketing/templates/:id/pdf` | Download reusable PDF without selecting a recipient or Products |
| `POST /marketing/campaigns/quotations/preview` | Validate a draft; return document, PDF base64, filename and fingerprint |
| `POST /marketing/campaigns/quotations/send` | Check the reviewed fingerprint and send the generated attachment |

Draft requests contain IDs, quantities, dates and notes. Prices, totals, sender
and organization identity are resolved server-side. Campaign and CRM permissions,
Account visibility and Product visibility are enforced on the backend.

One PDFKit renderer creates A4 previews, downloads and attachments. Licensed Noto
Sans fonts are bundled under `backend/assets/fonts` and copied into the backend
container. Existing currency formatting retains its defaults; quotations opt into
two decimal places. PDF generation preserves page headings, wrapping and `₱`.

Sending extends the existing owned Gmail mailbox with one internal generated PDF
attachment. The selected recipient must still be assigned to the sending user,
including Client Admin. Existing mailbox authorization, durable claims, unknown
outcome recovery and activity ingestion remain in use. Frozen document context and
attachment identity are kept in the existing mailbox receipt for retries; JSONB
key ordering cannot change the send identity. Changed previews require regeneration
before the first attempt. Provider-confirmed sends remain sent if local history
ingestion is delayed.

## Six starter templates

The existing seed command now includes Standard Sales Quotation, Service
Quotation, Software Implementation, Annual Maintenance, Product Quotation and
Custom Quotation. It requires an explicit confirmed tenant ID:

```powershell
npm --prefix backend run db:seed:campaigns -- <tenant-id>
```

The transaction locks that tenant and preserves matching edited/archived rows.
Existing Email/SMS defaults remain unchanged. This command must target a database
whose identity has been verified; implementation verification seeds only disposable
databases, not a live workspace.

## Verification

- `node backend/scripts/test-quotations-disposable.mjs`: actual migrations,
  authenticated HTTP, persistence, template seeding, decimal calculations,
  variable sources, tenant/RBAC boundaries, Account visibility, stale previews,
  PDF attachments, concurrent clicks and uncertain provider outcomes. Gmail
  transport is mocked; successful tests do not establish real delivery.
- `node backend/scripts/preview-quotations-browser.mjs`: production frontend with
  isolated API fixtures at 320/375/390/430/768/1024/1440px. Covers tabs, cards,
  editing, unsaved changes, cursor insertion, the wizard and download/send controls.
  This is rendered UI preview evidence, separate from database-backed API tests.
- Existing Campaign, selector, currency and Gmail authorization regressions;
  quotation cursor insertion test; workspace lint/typecheck and builds.
- Generated PDFs are extracted and visually rendered to inspect placeholder
  preservation, peso text, single-page documents and long tables/terms.

Local evidence is written under ignored `data/outputs/quotations`. No production
deployment, live tenant seeding, OAuth connection or real Gmail delivery is
performed by these checks.

Recorded local results: 30 quotation/template checks, 71 frontend regressions,
79 existing Gmail checks and 14 Contact dependency/migration checks passed
(194 tests). The rendered UI preview passed 56 checks across all seven widths.
Workspace lint/typechecks, frontend/shared builds and the final backend build
passed. Builds used an explicit fixture `API_URL`; the default checkout does not
provide the production backend URL required by the existing build configuration.
Standard Lead/Contact/template PDFs each rendered as one page; a 10-page sample
verified repeated headings, long terms, placeholder rules and peso text.
