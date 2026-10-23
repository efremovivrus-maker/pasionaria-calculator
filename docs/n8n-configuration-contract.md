# n8n: configuration and extra operations

The n8n workflow is not stored in this repository. Apply the changes below
manually so clarification turns preserve product modifications.

## Data Table fields

Keep the existing session fields and add:

- `configuration_heading` — string / null
- `configuration_mechanism` — string / null
- `configuration_lining` — string / null
- `configuration_mounting` — string / null
- `day_fabric` — string / null
- `extra_operations_json` — JSON string, default `[]`

If the Data Table supports native JSON, `configuration` may instead be stored
as one object and `extra_operations` as one array. Do not store these values in
`model`.

## YandexGPT parser output

Require JSON with this shape:

```json
{
  "product_type": "curtain",
  "model": "Вандер",
  "width_cm": 140,
  "height_cm": 270,
  "quantity": 2,
  "configuration": {
    "heading": "Люверсы",
    "mechanism": null,
    "lining": null,
    "mounting": null
  },
  "day_fabric": null,
  "extra_operations": ["Лея"],
  "fields_present": [
    "product_type",
    "model",
    "width_cm",
    "height_cm",
    "quantity",
    "configuration.heading",
    "extra_operations"
  ],
  "inferred_fields": [],
  "missing_fields": []
}
```

Add these rules to the parser prompt:

1. `model` contains only the base model name.
2. Words describing a heading, mechanism, lining or mounting go only into the
   matching `configuration` field.
3. Named embroidery/decor goes into `extra_operations`.
4. A model name is not also an extra operation. For example, model `Прайм`
   alone produces `extra_operations: []`.
5. Do not inject defaults. If the user did not request a mechanism,
   `configuration.mechanism` is `null`; the backend applies its default.
6. `fields_present` lists only values explicitly present in the current user
   message. This is required for safe session merging.
7. Do not invent catalog values. Preserve the user's wording when an option
   needs backend validation.
8. If the user explicitly uses a singular product form (`штора` or
   `римская штора`) and does not specify a quantity, set `quantity: 1` and
   include `quantity` in `inferred_fields`, not in `fields_present`.
9. Do not infer quantity for plural or set forms such as `шторы`,
   `римские шторы` or `комплект штор`. Keep `quantity` null and include it in
   `missing_fields`.
10. An explicit quantity (`2 шт`, `2 римские шторы`, `3 комплекта`, etc.)
    always wins and is listed in `fields_present`; do not also list it in
    `inferred_fields`.
11. Generic wording `на подкладке` produces
    `configuration.lining: "Подкладка"`; do not ask for a concrete lining
    variant unless the user explicitly names one.
12. Preserve the selected Roman mechanism kind. Normalize differences in
    case, spaces and the hyphen in `день-ночь`, but do not reduce
    `День-ночь Эконом` or `День-ночь Стандарт` to a base mechanism.
13. Put an explicitly named day fabric only into `day_fabric`. Never copy it
    into `model` and never invent `Вита`: the backend applies that default
    when `day_fabric` is null and the mechanism is day-night.
14. Include `day_fabric` in `fields_present` only when the current message
    explicitly names the day fabric. A day-night request without a day fabric
    keeps `day_fabric: null` and does not list the field.

Prompt examples:

- `шторы Прайм 120x280 2 шт` → model `Прайм`, empty configuration,
  `extra_operations: []`.
- `римская штора Ибица с вышивкой Прайм 120x200` → model `Ибица`,
  `extra_operations: ["Прайм"]`.
- `римская штора Вандер на карнизе Эконом 120x200` →
  `configuration.mechanism: "Эконом"`.
- `шторы Вандер на люверсах 140x270 2 шт` →
  `configuration.heading: "Люверсы"`.
- `шторы Вандер на подкладке 140x270 2 шт` →
  `configuration.lining: "Подкладка"`.
- `римская штора Вандер день ночь эконом 120x200` →
  `configuration.mechanism: "День-ночь Эконом"`, `day_fabric: null`.
  Do not put `day_fabric` in `fields_present`.
- `римская штора Вандер день ночь эконом, дневная ткань Вудсток 120x200` →
  `configuration.mechanism: "День-ночь Эконом"`, `day_fabric: "Вудсток"`,
  and `fields_present` includes `day_fabric`.
- `шторы Ибица на люверсах с вышивкой Лея 140x270 2 шт` → model
  `Ибица`, heading `Люверсы`, extras `["Лея"]`.
- `римская штора Вандер` → `quantity: 1`,
  `inferred_fields: ["quantity"]`.
- `штора Вандер` → `quantity: 1`,
  `inferred_fields: ["quantity"]`.
- `комплект штор Вандер` → `quantity: null`; quantity remains missing.
- `шторы Вандер` → `quantity: null`; quantity remains missing.

## Session merge

Merge the current parser output into the stored session field by field:

1. For scalar product fields, overwrite stored values only when the field is in
   `fields_present` and the new value is not null.
2. Merge `configuration` field by field. Never replace the whole object with
   an object containing nulls.
3. For each `configuration.*` key, overwrite only when that exact key is in
   `fields_present`.
4. Preserve stored `extra_operations` when the current follow-up does not list
   `extra_operations` in `fields_present`.
5. When extras are explicitly present, append and deduplicate by normalized
   case-insensitive name. Do not add the base model to extras.
6. Store the merged state before asking the next clarification.
7. If `quantity` is in `inferred_fields`, store the inferred value only when
   the session does not already contain an explicit quantity. A value listed
   in `fields_present` always overwrites the stored value.
8. Treat `day_fabric` as a scalar. Overwrite the stored value only when
   `day_fabric` is in `fields_present` and the new value is not null. A later
   size clarification must not erase a previously named day fabric.
9. Do not store the backend default `Вита` in the session. Leave `day_fabric`
   null until the user names another fabric.

Example:

```text
stored: mechanism=Эконом, width=null, height=null, quantity=null
reply:  120x200, 2 штуки
merged: mechanism=Эконом, width=120, height=200, quantity=2

stored: mechanism=День-ночь Эконом, day_fabric=Вудсток, width=null
reply:  120x200
merged: mechanism=День-ночь Эконом, day_fabric=Вудсток, width=120, height=200
```

No rule for removing an already selected option has been confirmed. Do not
interpret phrases such as “убрать вышивку” until that business rule is added.

## FastAPI payload

Send the merged state to `POST /api/calculate`:

```json
{
  "product_type": "roman",
  "model": "Вандер",
  "width_cm": 120,
  "height_cm": 200,
  "quantity": 2,
  "configuration": {
    "heading": null,
    "mechanism": "Эконом",
    "lining": null,
    "mounting": null
  },
  "day_fabric": null,
  "extra_operations": [],
  "raw_request": "120x200, 2 штуки"
}
```

Treat HTTP 200 with `status: "unavailable"` as a business response. Return the
backend `message`, `reason_code` and `details` to the conversational branch;
do not route it to the technical-error branch.

If the backend says the day fabric was provided without a day-night mechanism,
ask the user to choose `День-ночь Эконом` or `День-ночь Стандарт`. If it says
the day fabric is missing from the catalog or does not fit the height, show
that message and do not substitute another fabric or price.
