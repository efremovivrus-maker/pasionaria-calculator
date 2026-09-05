# PASIONARIA Calculator

Deterministic calculation engine and FastAPI transport layer for curtains and
Roman blinds.

## Local API

Install dependencies:

```bash
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
```

Start the API from the project root:

```bash
.venv/bin/uvicorn backend.app.main:app --reload
```

Healthcheck:

```bash
curl http://127.0.0.1:8000/health
```

Calculation example:

```bash
curl -X POST http://127.0.0.1:8000/api/calculate \
  -H 'Content-Type: application/json' \
  -d '{
    "product_type": "curtain",
    "model": "Вандер",
    "width_cm": 130,
    "height_cm": 280,
    "quantity": 2,
    "raw_request": "Посчитай две шторы Вандер 130 на 280"
  }'
```

Interactive API documentation is available at
`http://127.0.0.1:8000/docs`.

## Local frontend

The frontend sends chat messages directly to the configured n8n webhook.

```bash
cd frontend
cp .env.example .env.local
```

Set the webhook URL in `frontend/.env.local`:

```dotenv
NEXT_PUBLIC_N8N_WEBHOOK_URL=https://your-n8n-host/webhook/...
```

Install dependencies and start the development server:

```bash
npm install
npm run dev
```

Open `http://localhost:3000`.

The n8n session fields, YandexGPT parser contract, merge rules and FastAPI
payload are documented in `docs/n8n-configuration-contract.md`.

Production check:

```bash
npm test
npm run lint
npm run build
```

## Tests

```bash
.venv/bin/python -m unittest discover -s tests -v
```
