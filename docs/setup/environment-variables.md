# Environment Variables

## Backend (`backend/.env`)

Copy from `backend/.env.example`. Required before running the backend.

| Variable | Required | Description |
|---|---|---|
| `DATABASE_URL` | ✅ | PostgreSQL connection string: `postgresql://user:pass@localhost:5432/leadcrm_dev` |
| `JWT_SECRET` | ✅ | Strong random string (min 32 chars). Used to sign auth tokens. |
| `NODE_ENV` | ✅ | `development` or `production` |
| `PORT` | — | API server port. Defaults to `4000`. |
| `APP_URL` | — | Frontend URL for CORS. Defaults to `http://localhost:3000`. |
| `GMAIL_CLIENT_ID` | Optional | Google OAuth2 client ID for Gmail integration. |
| `GMAIL_CLIENT_SECRET` | Optional | Google OAuth2 client secret. |
| `GMAIL_REDIRECT_URI` | Optional | OAuth2 callback URL. |
| `PAYMONGO_SECRET_KEY` | Optional | PayMongo secret key for payment processing. |
| `PAYMONGO_PUBLIC_KEY` | Optional | PayMongo public key. |
| `PAYMONGO_WEBHOOK_SECRET` | Optional | For verifying webhook signatures. |
| `SUPABASE_RECORD_FILES_BUCKET` | Required for CRM file uploads | Private Supabase Storage bucket used for Lead, Contact, and Account attachments (separate from the WebP-only avatar bucket). Allow the CRM attachment MIME types and set the maximum file size to 10 MB. |

## Frontend (`frontend/.env.local`)

Copy from `frontend/.env.local.example`.

| Variable | Required | Description |
|---|---|---|
| `NEXT_PUBLIC_APP_URL` | — | Frontend URL. Defaults to `http://localhost:3000`. |
| `NEXT_PUBLIC_API_URL` | — | Backend API URL. Defaults to `http://localhost:4000/api/v1`. |
| `GEMINI_API_KEY` | Optional | For Gemini AI features (future). |

## Security Rules

- Never commit `.env` — it's gitignored via `.env*` pattern
- Only `.env.example` and `.env.local.example` are committed
- `NEXT_PUBLIC_*` prefix exposes values to the browser — never put secrets there
- `JWT_SECRET` must be at least 32 random characters
- Rotate any secret immediately if it's accidentally committed

## Generating Secrets

```bash
# Generate a strong JWT_SECRET
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```
