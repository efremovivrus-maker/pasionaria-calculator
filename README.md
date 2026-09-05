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

## Tests

```bash
.venv/bin/python -m unittest discover -s tests -v
```
