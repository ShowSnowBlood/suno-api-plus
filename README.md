# Suno API Plus

Enhanced fork of [gcui-art/suno-api](https://github.com/gcui-art/suno-api).

Adds an **admin dashboard**, **multi-account pool**, **global generation concurrency control**, **OpenAI-compatible endpoints with API key auth**, **credit and multiplier billing**, **YesCaptcha / 2Captcha**, and **cookie extraction tools**.

[English](./README.md) · [简体中文](./README_CN.md)

---

## Features

- Suno music generation APIs (generate, custom mode, extend, lyrics, stems)
- Admin panel at `/admin` (accounts, generate, captcha, API key, billing, songs)
- Multi-account pool with `basic` / `super` / `heavy` tiers and quota sync
- Global generation concurrency limit with live active-request and available-slot status
- OpenAI-compatible endpoints:
  - `GET /v1/models`
  - `GET /v1/billing`
  - `POST /v1/chat/completions`
  - `POST /v1/responses`
- Credit and multiplier billing based on package cost, upstream credits, request usage, and group multiplier
- API key auth: `Authorization: Bearer <API_KEY>` (manage in admin UI)
- Captcha providers: YesCaptcha and 2Captcha (token-first)
- Cookie tools:
  - Playwright extractor: `npm run get-cookie`
  - Browser extension: `suno-cookie-extension`
  - Admin account authorization wizard
- Docker Compose deployment

> This project automates Suno web flows. For learning / self-hosting only. Follow Suno Terms of Service and local laws.

---

## Quick Start (Docker)

### 1. Clone

```bash
git clone https://github.com/ShowSnowBlood/suno-api-plus.git
cd suno-api-plus
```

### 2. Configure environment

```bash
cp .env.example .env
```

Minimum `.env`:

```env
ADMIN_PASSWORD=your-admin-password
ACCOUNT_ENCRYPTION_KEY=a-long-random-secret
CAPTCHA_PROVIDER=2captcha
TWOCAPTCHA_KEY=your-2captcha-key
# or
# CAPTCHA_PROVIDER=yescaptcha
# YESCAPTCHA_KEY=your-yescaptcha-key
```

Optional:

```env
API_KEY=sk-suno-your-own-key
SUNO_COOKIE=...   # optional if you only use multi-account pool in Admin
```

### 3. Start

```bash
mkdir -p data
docker compose build
docker compose up -d
```

Open:

- Local admin: `http://localhost:3000/admin`
- Local API docs: `http://localhost:3000/docs`
- Production OpenAI base: `https://<your-domain>/v1`

Current hosted instance:

- Admin: `https://suno.38-47-121-78.sslip.io/admin`
- API docs: `https://suno.38-47-121-78.sslip.io/docs`
- OpenAI base: `https://suno.38-47-121-78.sslip.io/v1`

Admin password = `ADMIN_PASSWORD`.

The default Compose binding is `127.0.0.1:3000`, so production traffic must
go through an HTTPS reverse proxy. See [deploy/HTTPS.md](./deploy/HTTPS.md).

---

## Local Development

```bash
git clone https://github.com/ShowSnowBlood/suno-api-plus.git
cd suno-api-plus
cp .env.example .env
npm install
npx playwright install chromium
npm run dev
```

---

## Get a Suno Cookie

### A. Browser extension

1. Chrome → Extensions → enable Developer Mode
2. Load unpacked: `suno-cookie-extension/`
   - or use `public/suno-cookie-extension.zip`
3. Log in to [suno.com](https://suno.com)
4. Extract / copy cookie
5. Paste into Admin → Accounts, or set `SUNO_COOKIE` in `.env`

### B. Playwright extractor

```bash
cd suno-cookie-extractor && npm install && cd ..
npm run get-cookie -- --save
# SSO / 2FA
npm run get-cookie -- --manual --save
npm run verify-cookie
```

### C. Manual DevTools

1. Open [suno.com/create](https://suno.com/create)
2. F12 → Network → refresh
3. Find a Clerk / `__clerk_api_version` request
4. Copy the full `Cookie` header

---

## Admin Panel

URL: `/admin`

| Module | Description |
|---|---|
| Overview | Credits / status |
| Accounts | Multi-account pool, verify/refresh |
| Concurrency | Global generation request limit and live slot usage |
| Generate | Web music generation |
| Captcha | YesCaptcha / 2Captcha settings |
| API Key | OpenAI-compatible key management |
| Credits & multiplier | Cost, credits, request usage, output count, billing multiplier, and balance conversion |

Account tiers: `basic` / `super` / `heavy`.

---

## OpenAI Compatible API

### Base URL

```text
https://<your-domain>/v1
```

Hosted instance: `https://suno.38-47-121-78.sslip.io/v1`

### Auth

When API key is enabled:

```http
Authorization: Bearer sk-suno-xxxxxxxx
```

Also accepted:

```http
x-api-key: sk-suno-xxxxxxxx
```

### Examples

```bash
export SUNO_BASE_URL=https://suno.38-47-121-78.sslip.io/v1

curl "$SUNO_BASE_URL/models" \
  -H "Authorization: Bearer $API_KEY"

curl "$SUNO_BASE_URL/chat/completions" \
  -H "Authorization: Bearer $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "suno-music",
    "messages": [
      {"role": "user", "content": "an upbeat electronic track about city lights at night"}
    ],
    "make_instrumental": true
  }'
```

### Available models

Call `GET /v1/models` to discover the model IDs exposed by this instance. The
response uses the OpenAI-compatible `list` format and requires the same API
key as the generation endpoints when API key authentication is enabled.

Model availability is determined by the selected Suno account's plan and
upstream permissions. A model listed here may still be rejected upstream when
that account does not have access to the corresponding version.

| Model ID | Status | Provider model | Notes |
|---|---|---|---|
| `suno-music` | Current / recommended | `chirp-fenix` | Default alias for the latest supported model, currently Suno V5.5. Use this value in sub2api and generic OpenAI clients. |
| `suno-v5.5` | Current | `chirp-fenix` | Explicit Suno V5.5 model ID. |
| `suno-v5` | Stable | `chirp-crow` | Suno V5 model ID. |
| `suno-v4.5+` | Stable | `chirp-bluejay` | Suno V4.5+ model ID. |
| `suno-v4.5` | Stable | `chirp-auk` | Suno V4.5 model ID. |
| `suno-v4` | Legacy | `chirp-v4` | Suno V4 compatibility model ID. |
| `suno-v3.5` | Legacy | `chirp-v3-5` | Suno V3.5 compatibility model ID. |
| `suno-v3` | Legacy | `chirp-v3-0` | Suno V3 compatibility model ID. |

Example discovery request:

```bash
curl "$SUNO_BASE_URL/models" \
  -H "Authorization: Bearer $API_KEY"
```

The `data` entries include standard OpenAI fields (`id`, `object`, `created`,
and `owned_by`) plus `capabilities` and a `metadata` object with the provider
model, display label, status, recommendation flag, and optional alias target.
Raw `chirp-*` provider identifiers remain pass-through compatible, but the
public `suno-*` IDs above are recommended for downstream integrations.

### sub2api / OpenAI clients

| Field | Value |
|---|---|
| Base URL | `https://suno.38-47-121-78.sslip.io/v1` |
| API Key | your configured key |
| Model | `suno-music` |
| `billing_mode` | `per_request` |
| `per_request_price` | `0.48` with the defaults below |
| Group `rate_multiplier` | `1` by default |
| Upstream declared multiplier | Automatically follows the admin billing multiplier |

The Sub2API upstream multiplier probe is supported at `GET /v1/sub2api/billing`.
After refreshing the upstream account, Sub2API displays the declared value such
as `1x` or `1.5x` instead of `unsupported`.

Optional pool header:

```http
x-suno-pool: basic|super|heavy
```

### Credit and multiplier billing

Admin → Credits & multiplier starts with these defaults:

| Setting | Default |
|---|---:|
| Package cost | CNY `120` |
| Upstream package credits | `2500` |
| Credits consumed per generation | `10` |
| Outputs per generation | `2` songs |
| Billing multiplier | `1` |
| Balance conversion | CNY `1` = `1` USD balance unit |

The default calculation is:

- Cost per upstream credit: `120 / 2500 = CNY 0.048`
- Cost per generation: `0.048 × 10 = CNY 0.48`
- Cost per song: `0.48 / 2 = CNY 0.24`
- Package capacity: `2500 / 10 = 250` generations and `500` songs
- At multiplier `1`: deduct `10` billing credits per generation, or `5` per song
- At multiplier `1`: `2500` total billable credits, reference value `120`, and `0%` gross margin
- Sub2API: `billing_mode=per_request`, `per_request_price=0.48`, group `rate_multiplier=1`

`per_request_price` is the base request cost converted to the downstream balance
unit. Sub2API's effective request charge is `per_request_price × rate_multiplier`.
For example, multiplier `1.5` deducts `15` billing credits per generation and
charges `0.72` USD balance units with the default conversion.

Saved settings take effect immediately without a restart and are stored in
`./data/billing-settings.json` (the directory follows `ACCOUNT_DATA_PATH`). A
downstream client can read the active settings and calculated summary:

```bash
curl "$SUNO_BASE_URL/billing" \
  -H "Authorization: Bearer $API_KEY"
```

Sub2API upstream multiplier probe:

```bash
curl "$SUNO_BASE_URL/sub2api/billing" \
  -H "Authorization: Bearer $API_KEY"
```

The compatibility response uses `billing_scope=token` because Sub2API requires
that literal value. Actual music generation billing remains `per_request` with
the configured `per_request_price`.

The admin API uses the signed-in `suno_admin_session` cookie:

- `GET /api/admin/billing`: read settings and the calculated summary
- `PUT /api/admin/billing`: save `purchaseCostCny`, `purchasedCredits`,
  `creditsPerGeneration`, `outputsPerGeneration`, `rateMultiplier`, and `cnyPerUsd`

### Global generation concurrency

The service accepts at most `4` concurrent generation requests by default. The
admin setting `maxConcurrentRequests` accepts integers from `1` to `100` and
takes effect immediately. This global limit is applied in addition to each
account's own concurrency limit.

The following nine generation endpoints share the same global capacity:

- `POST /api/generate`
- `POST /api/custom_generate`
- `POST /api/extend_audio`
- `POST /api/generate_stems`
- `POST /api/generate_lyrics`
- `POST /api/concat`
- `POST /api/admin/generate`
- `POST /v1/chat/completions`
- `POST /v1/responses`

Read-only endpoints such as model discovery, billing, quota, task lookup, and
song lookup do not consume a generation slot. When all slots are occupied, a
new generation request fails immediately with HTTP `429` and code
`concurrency_limit_exceeded`.

The admin API requires the signed-in `suno_admin_session` cookie:

- `GET /api/admin/concurrency`: return `settings`, `activeRequests`, and `availableSlots`
- `PUT /api/admin/concurrency`: save `maxConcurrentRequests` (`1-100`) and return the updated status

Example update:

```bash
curl -X PUT "https://<your-domain>/api/admin/concurrency" \
  -H "Content-Type: application/json" \
  -H "Cookie: suno_admin_session=<session>" \
  -d '{"maxConcurrentRequests":4}'
```

All nine protected generation routes return:

```json
{
  "error": {
    "message": "Global generation concurrency limit exceeded.",
    "type": "rate_limit_error",
    "code": "concurrency_limit_exceeded",
    "limit": 4,
    "active_requests": 4,
    "retry_after": 5
  }
}
```

The response also includes `Retry-After: 5`.

---

## Native API Routes

Swagger UI: `/docs`

- `POST /api/generate`
- `POST /api/custom_generate`
- `POST /api/extend_audio`
- `POST /api/generate_lyrics`
- `GET /api/get?ids=...`
- `GET /api/get_limit`
- `GET /v1/billing` (API key protected when API auth is enabled)
- `GET /api/admin/billing`, `PUT /api/admin/billing` (admin session required)
- `GET /api/admin/concurrency`, `PUT /api/admin/concurrency` (admin session required)

---

## Environment Variables

| Variable | Required | Description |
|---|---|---|
| `ADMIN_PASSWORD` | Yes | Admin panel password |
| `ACCOUNT_ENCRYPTION_KEY` | Yes | Encrypt stored cookies |
| `CAPTCHA_PROVIDER` | Recommended | `2captcha` or `yescaptcha` |
| `TWOCAPTCHA_KEY` | If 2captcha | 2Captcha API key |
| `YESCAPTCHA_KEY` | If yescaptcha | YesCaptcha client key |
| `YESCAPTCHA_BASE_URL` | No | Default official API host |
| `CAPTCHA_MODE` | No | `auto` / `token` / `click` |
| `SUNO_COOKIE` | Optional | Default single-account cookie |
| `API_KEY` / `SUNO_API_KEY` | Optional | Protect `/v1/*` |
| `ACCOUNT_DATA_PATH` | No | Default `/app/data/accounts.json` |
| `ACCOUNT_QUOTA_SYNC_INTERVAL_SEC` | No | Default `300` |
| `BROWSER` | No | `chromium` recommended |
| `BROWSER_HEADLESS` | No | Default `true` |
| `BROWSER_DISABLE_GPU` | No | `true` for Docker |

Captcha, API key, and billing settings can also be saved from Admin UI under `./data/`.

---

## Project Structure

```text
src/
  app/admin/           # Admin dashboard
  app/api/             # Native + admin APIs
  app/v1/              # OpenAI-compatible APIs
  lib/                 # Pool, captcha, auth, Suno client
suno-cookie-extractor/ # Playwright cookie tool
suno-cookie-extension/ # Browser extension source
public/                # Static assets + extension zip
docker-compose.yml
Dockerfile
.env.example
```

---

## Captcha Notes

Suno often triggers hCaptcha. Use a paid solver:

- [2Captcha](https://2captcha.com)
- [YesCaptcha](https://yescaptcha.com)

Tips:

1. Configure keys in Admin → Captcha or `.env`
2. Prefer token / `auto` mode
3. Keep concurrency reasonable

---

## Security Checklist

- Change `ADMIN_PASSWORD` and `ACCOUNT_ENCRYPTION_KEY` before public exposure
- Enable `API_KEY` for `/v1/*`
- Never commit `.env` or `data/`
- Put HTTPS reverse proxy in front for production
- Restrict firewall access when possible

---

## Upgrade

```bash
git pull
docker compose build
docker compose up -d
```

Persistent data is under `./data`.

---

## Disclaimer

Unofficial project. Not affiliated with Suno, Inc.  
Use at your own risk and respect provider ToS.

## License

LGPL-3.0-or-later (same as upstream)

## Credits

- Upstream: [gcui-art/suno-api](https://github.com/gcui-art/suno-api)
- This fork: multi-account admin, YesCaptcha, API key auth, cookie tools
