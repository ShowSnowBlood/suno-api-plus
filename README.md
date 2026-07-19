# Suno API Plus

Enhanced fork of [gcui-art/suno-api](https://github.com/gcui-art/suno-api).

Adds an **admin dashboard**, **multi-account pool**, **OpenAI-compatible endpoints with API key auth**, **YesCaptcha / 2Captcha**, and **cookie extraction tools**.

[English](./README.md) · [简体中文](./README_CN.md)

---

## Features

- Suno music generation APIs (generate, custom mode, extend, lyrics, stems)
- Admin panel at `/admin` (accounts, generate, captcha, API key, songs)
- Multi-account pool with `basic` / `super` / `heavy` tiers and quota sync
- OpenAI-compatible endpoints:
  - `GET /v1/models`
  - `POST /v1/chat/completions`
  - `POST /v1/responses`
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
| Generate | Web music generation |
| Captcha | YesCaptcha / 2Captcha settings |
| API Key | OpenAI-compatible key management |

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

| Model ID | Role | Availability | Notes |
|---|---|---|---|
| `suno-music` | Compatibility alias | Recommended | Maps to the default `chirp-v3-5` model; use this value in sub2api and generic OpenAI clients. |
| `chirp-v3-5` | Suno model | Stable / default | Default model for new generation requests. |
| `chirp-v3-0` | Suno model | Legacy | Supported only when the selected Suno account still exposes it upstream. |

Example discovery request:

```bash
curl "$SUNO_BASE_URL/models" \
  -H "Authorization: Bearer $API_KEY"
```

The `data` entries include standard OpenAI fields (`id`, `object`, `created`,
and `owned_by`) plus `capabilities` and a `metadata` object with the provider
model, display label, status, recommendation flag, and optional alias target.

### sub2api / OpenAI clients

| Field | Value |
|---|---|
| Base URL | `https://suno.38-47-121-78.sslip.io/v1` |
| API Key | your configured key |
| Model | `suno-music` |

Optional pool header:

```http
x-suno-pool: basic|super|heavy
```

---

## Native API Routes

Swagger UI: `/docs`

- `POST /api/generate`
- `POST /api/custom_generate`
- `POST /api/extend_audio`
- `POST /api/generate_lyrics`
- `GET /api/get?ids=...`
- `GET /api/get_limit`

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

Captcha / API key can also be saved from Admin UI under `./data/`.

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
