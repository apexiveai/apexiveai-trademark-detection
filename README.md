.\.venv\Scripts\python.exe -c "import secrets; print('JWT_SECRET='+secrets.token_urlsafe(48)); print('TRADEMARK_INGEST_KEY='+secrets.token_urlsafe(48))"

# Apexive AI Trademark Conflict Detector

Trademark logo search and preliminary conflict screening. The workflow is:

**Logo upload → logo-region crop → local CLIP embedding → Qdrant vector search
→ top-10 marks → side-by-side evidence → similarity/risk breakdown.**

## Local development

Install the backend dependencies (the local CLIP model uses PyTorch and is a
large dependency):

```powershell
cd backend
py -3.12 -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
Copy-Item .env.example .env
```

Set `JWT_SECRET`, `TRADEMARK_INGEST_KEY`, and SMTP settings in the backend
environment when enabling account registration. For local testing, keep
`AUTH_REQUIRED=false`. Start the services from separate terminals:

```powershell
cd backend
.\.venv\Scripts\python.exe -m uvicorn app.main:app --env-file .env --host 127.0.0.1 --port 8017 --reload
```

```powershell
cd frontend
npm ci
$env:VITE_API_BASE_URL = "http://127.0.0.1:8017"
npm run dev / node ".\node_modules\vite\bin\vite.js" --host 0.0.0.0 --port 5190
```

The CLIP weights are loaded on the first embedding request and cached by the
model runtime. The default Qdrant local store and uploaded trademark images are
written beneath `TRADEMARK_DATA_DIR` (default `backend\data`). Keep that
directory private and backed up; it is intentionally git-ignored.

## ApexiveAI Community tenant access integration

This application can be launched from the community tenant dashboard and enforce
per-tenant product access managed by the SuperAdmin in the sibling
`apexiveai-community` workspace. Set the following environment variables on the
product backend:

```powershell
$env:COMMUNITY_API_URL = "https://community.example.test"
$env:COMMUNITY_SOLUTION_CODE = "trademark-conflict-detector"
```

When configured, the backend accepts either a local product JWT or a Community
tenant bearer token. Community tokens are validated against
`GET {COMMUNITY_API_URL}/api/auth/solutions/{COMMUNITY_SOLUTION_CODE}/access` and
access is denied unless the SuperAdmin explicitly grants the tenant. This is the
recommended deployment mode for subscription-based tenant access.

## Importing licensed trademark records

Search results only include records already imported into the vector index.
The application does not crawl or claim live access to Myanmar, WIPO, EUIPO,
TMview, or USPTO registries. Obtain data through the registry's permitted
export/API and comply with its terms before importing.

For bulk local imports, prepare a CSV manifest and the referenced logo files.
Required CSV columns:

```text
jurisdiction,mark_name,trademark_number,classes,goods_services,source_url,image_file
```

`jurisdiction` must be `MYANMAR`, `WIPO`, `EUIPO`, `TMVIEW`, or `USPTO`.
`classes` is a comma/semicolon-separated Nice class list from 1–45.
`image_file` is relative to the manifest. Supported image formats are PNG,
JPG/JPEG, WEBP, and SVG.

```powershell
cd backend
.\.venv\Scripts\python.exe -m scripts.import_trademarks .\data\manifest.csv
```

Each valid row is embedded and indexed in the local Qdrant collection.
Per-record ingestion is also available at `POST /api/v1/trademarks`, protected
by the `X-Ingest-Key` header and `TRADEMARK_INGEST_KEY`.

## API

- `POST /api/v1/logo/crop` — return a detected logo crop as PNG; the original
  region coordinates are in `X-Logo-Region`.
- `POST /api/v1/trademarks` — index one trademark logo and its metadata.
- `POST /api/v1/trademarks/search` — search logo embeddings; supports optional
  mark name, goods/services, Nice classes, jurisdictions, and a maximum of 10
  results.
- `GET /api/v1/trademarks/{id}/logo` — serve an indexed mark logo.
- `GET /api/v1/trademarks/status` — report indexed record count and coverage.
- `POST /api/v1/compare` — compare two documents/images using the existing
  text and visual screening workflow. The response lists every extracted
  image pair scoring at least 80% similarity, ordered by score, with PDF page
  or spreadsheet sheet locations. The workspace displays up to 100 matches
  per page.
- `POST /api/v1/auth/register`, `/verify`, `/login` — email-verified accounts.

Search ranks up to 100 vector candidates, then calculates an explainable
preliminary score from logo embedding, pixel/shape, color, layout, mark text,
goods/services, and class overlap. Missing optional text/class signals are
excluded and the remaining score weights are normalized. Evidence circles
outline the detected logo region in the query and result previews.

All similarity and risk values are screening signals only—not legal advice,
an infringement determination, or a probability of confusion. Region detection
uses OpenCV contours and can fail on complex document backgrounds.

## Accounts and security

Set `AUTH_REQUIRED=true` in shared/production deployments. Configure a
32-character-or-longer random `JWT_SECRET`, a separate random
`TRADEMARK_INGEST_KEY`, and SMTP variables (`SMTP_HOST`, `SMTP_PORT`,
`SMTP_USER`, `SMTP_PASSWORD`, `SMTP_FROM`). Registration sends a single-use
email-verification link; passwords are stored as salted PBKDF2-HMAC-SHA256
hashes. Access tokens expire after 12 hours. Do not expose secrets in frontend
build variables.

Basic in-process limits protect registration, login, compare, crop, and vector
search endpoints. Local Qdrant storage and these limits are single-instance;
use a hosted Qdrant service and a shared rate limiter before scaling to multiple
backend instances. Use HTTPS in production.

## Deployment setup

- **Render API:** root `render.yaml` configures a one-worker API and persistent
  data disk. The disk/CLIP workload requires a paid plan sized for the model
  and index. Set the listed secret variables in Render.
- **Vercel UI:** select `frontend` as the project root and set
  `VITE_API_BASE_URL` to the deployed HTTPS API origin. `frontend/vercel.json`
  configures the Vite build and SPA fallback.
- **Railway API:** `backend/Dockerfile` and `backend/railway.toml` are an
  alternative backend configuration. Configure a persistent volume and the
  same production secrets there.
- **Spaceship domain:** after adding the domain in Vercel, configure the
  requested apex A and `www` CNAME records in Spaceship DNS. Set the final
  frontend URL in `FRONTEND_URL` and add its origin to backend
  `CORS_ORIGINS`.

These are deployment configurations only; no hosting account, domain, SMTP
service, registry credentials, or live deployment is included in this
repository.

## Tests

Run the backend tests from `backend`:

```powershell
.\.venv\Scripts\python.exe -m unittest discover -s tests -v
```

Build/type-check the frontend from `frontend`:

```powershell
npm run build
```
