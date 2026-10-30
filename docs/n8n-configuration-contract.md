# n8n: configuration and extra operations

The n8n workflow is not stored in this repository. Apply the changes below
manually. Clarification turns for curtains and Roman blinds still preserve
product modifications. A bedspread message is a new calculation and does not
use the stored session.

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

Do not add `face_fabric`, `stitch` or `filling` columns. Those values belong
only to the current bedspread request. Leave the curtain and Roman session
columns listed above unchanged.

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
15. Do not drop a requested component that has no catalog price. Embroidery,
    tulle and tiebacks (`подхваты`) go into `extra_operations` using the
    user's wording. The backend must validate them. Exception: in
    `Блэкаут шторы Мириам` and `Блэкаут шторы с подхватами Мириам`, the words
    `Блэкаут` and `подхваты` are not extras. Leave `extra_operations` empty.
16. A model with built-in embroidery, such as `Либерти` or `Мэри`, already
    includes that embroidery. Do not also add the model name to
    `extra_operations`. Words such as `нестандартный размер` are not part of
    the model name. Send the numeric width and height when the user provides
    them.
17. In `Блэкаут шторы Мириам` and `Блэкаут шторы с подхватами Мириам`, the
    model is only `Мириам`. Do not select the separate model `Блэкаут`. Do
    not set `configuration.lining`. Do not add blackout, tiebacks, a second
    fabric or any value to `extra_operations`. `Блэкаут` alone, without
    `Мириам`, remains model `Блэкаут`. A separate request for tiebacks on
    another model still goes into `extra_operations`.
18. `Майа`, `Майя` and `Мая` are the same curtain model `Майа`. Do not replace
    them with `Майкл`, `Мэри` or `Мириам`. Do not invent tulle for `Софт`.
    Do not invent a separate embroidery tariff for `Мэри`: the backend
    includes it.
19. A request that says `покрывало` or `покрывала` has `product_type:
    "bedspread"`. Do not turn it into a curtain, even when the model name
    also exists as a curtain, such as `Софт` or `Ибица`. The word
    `покрывало` is not part of the model name.
20. For a bedspread, `width_cm` is the first size and `height_cm` is the
    second size. Singular `покрывало` without a count infers `quantity: 1`.
    Plural `покрывала` without a count leaves quantity missing.
21. `из ткани <название>` goes to `face_fabric`, not to `model` and not to
    `extra_operations`. A bedspread without another fabric keeps
    `face_fabric: null`; the backend uses the confirmed default.
22. A named stitch (`ромб 10×10`, `квадрат 5×5`, `Аура` and the other
    bedspread stitch names) goes to `stitch`. Do not invent a stitch when
    the user did not name one: leave `stitch` null. The backend then uses
    the model's standard stitch, including a marked `default_stitch_assumed`
    when the card is quilted but names no pattern. `синтепон 200` or `синтепон 100` goes to
    `filling`. `подкладка Сканди`, `подкладка Анна` or `подкладка Бойл`
    goes to `configuration.lining`. If lining is not named, leave it null:
    the backend applies `Анна`, or `Бойл` when that is the model's lining.
23. Do not put pillowcases, planks, ribbons or the model embroidery into
    `extra_operations` for a bedspread. The backend adds confirmed
    embroidery itself and will stop if an unsupported extra arrives.
24. If the backend returns `status: "unavailable"`, show `message` to the
    manager. Do not replace it with a price or choose a stitch, fabric or
    embroidery on your own.
25. Parse a bedspread only from the current user message. Do not copy a
    model, size, quantity, configuration, day fabric, extra operation,
    face fabric, stitch or filling from earlier messages. If the current
    message does not name a stitch, `stitch` stays `null`.
26. A bedspread follow-up such as `ромб 10×10` is not a clarification of the
    stored curtain or bedspread. It is incomplete on its own. Leave the
    missing model and size null and do not fill them from the session.

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
- `шторы Мэри` and `штора Мэри с вышивкой Мэри` → model `Мэри`,
  `extra_operations: []`. The backend includes the embroidery once.
- `комплект Софт с тюлем` → model `Софт`,
  `extra_operations: ["тюль"]`. Do not add a tulle price locally.
- `Блэкаут шторы Мириам 140x270` and
  `Блэкаут шторы с подхватами Мириам 140x270` → model `Мириам`, width `140`,
  height `270`, empty configuration (`lining: null`), `extra_operations: []`.
  Quantity stays missing because the plural form has no count.
  Do not ask whether the model is `Блэкаут` and do not add tiebacks.
  Parser output:

```json
{
  "product_type": "curtain",
  "model": "Мириам",
  "width_cm": 140,
  "height_cm": 270,
  "quantity": null,
  "configuration": {
    "heading": null,
    "mechanism": null,
    "lining": null,
    "mounting": null
  },
  "day_fabric": null,
  "extra_operations": [],
  "raw_request": "Блэкаут шторы с подхватами Мириам 140x270"
}
```

  If the parser instead sends `extra_operations: ["подхваты"]`, the backend
  returns `EXTRA_OPERATION_NOT_FOUND` and does not calculate a price. Do not
  hide or drop that response. Correct the prompt so the extra is not sent.
- `шторы Майа`, `шторы Майя` and `штора Мая` → model `Майа`, not `Майкл`.
- `Покрывало Софт 230×250` → `product_type: "bedspread"`, model `Софт`,
  width `230`, height `250`, quantity `1` inferred, `face_fabric: null`,
  `stitch: null`, `filling: null`, `configuration.lining: null`,
  `extra_operations: []`. The parser does not invent a stitch. The backend
  applies the model default.
- `Покрывало Ибица 230×250` → model `Ибица`, `face_fabric: null`,
  `stitch: null`. The confirmed fabric and the model stitch stay on the
  backend.
- `Покрывало Аника 230×250 из ткани Софт` → model `Аника`,
  `face_fabric: "Софт"`, `stitch: null`.
- `Покрывало Ибица 200×220, ромб 10×10` → model `Ибица`,
  `stitch: "Ромб 10×10"`.
- `Покрывало Прайм 250×270, синтепон 200` → model `Прайм`,
  `filling: "200"`.
- `Покрывало Софт 300×270 из ткани шириной 280 см` → model `Софт`,
  width `300`, height `270`, `face_fabric: null`. The width remark does
  not create a new fabric. Do not add a stitch.

## Session merge

The field-by-field merge below applies only when the current message is a
curtain or a Roman blind. A bedspread skips this merge.

When the current message says `покрывало` or `покрывала`, or the parser
returns `product_type: "bedspread"`:

1. Build `POST /api/calculate` from that message alone.
2. Do not copy stored `model`, `width_cm`, `height_cm`, `quantity`,
   `configuration`, `day_fabric` or `extra_operations` into the bedspread
   payload.
3. Do not write the bedspread request back into the Data Table. The stored
   curtain or Roman session stays as it was.
4. Do not create or fill `face_fabric`, `stitch` or `filling` in the Data
   Table. Pass them only in the current API payload, and omit each one when
   it is null.
5. If the current message has a model and both sizes, send it as-is. A
   missing stitch stays null. Show the backend `message` unchanged. That
   message already asks for a new complete request.
6. If the current message has no model, no both sizes, or a plural form
   without a quantity, do not call the API with stored values. Reply with
   one complete example and leave the session unchanged:
   - no size: `Для расчёта покрывала укажите размер в новом полном запросе. Например: Покрывало Софт 230×250, ромб 10×10`
   - no model: `Для расчёта покрывала укажите модель в новом полном запросе. Например: Покрывало Софт 230×250, ромб 10×10`
   - plural without a count: `Для расчёта покрывала укажите количество в новом полном запросе. Например: Покрывало Софт 230×250, ромб 10×10`

```text
stored: curtain, model=Вандер, mechanism=Эконом, width=140, height=270, quantity=2
message: Покрывало Софт 230×250
sent: product_type=bedspread, model=Софт, width=230, height=250, quantity=1, stitch=null
not sent: mechanism=Эконом, width=140, height=270, quantity=2
session after the reply: still Вандер, Эконом, 140×270, quantity=2

message: Покрывало Софт 230×250, ромб 10×10
sent: that bedspread only, stitch=ромб 10×10
```

For a curtain or Roman message, merge the current parser output into the
stored session field by field:

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

Bedspread fields travel in the current API payload only. Do not store them
in the Data Table. Omit a field when it is null:

- `face_fabric` — a fabric named in this message, or omitted when the
  message does not name one
- `stitch` — a stitch named in this message, or omitted when it is absent
- `filling` — `100` or `200` when this message names the density, or omitted
- `configuration.lining` — `Анна`, `Сканди` or `Бойл` when this message names it, or
  omitted so the backend applies `Анна`, or `Бойл` when that is the model's own lining

```json
{
  "product_type": "bedspread",
  "model": "Софт",
  "width_cm": 230,
  "height_cm": 250,
  "quantity": 1,
  "configuration": {
    "heading": null,
    "mechanism": null,
    "lining": null,
    "mounting": null
  },
  "day_fabric": null,
  "face_fabric": null,
  "stitch": "Ромб 10×10",
  "filling": null,
  "extra_operations": [],
  "raw_request": "Покрывало Софт 230×250, ромб 10×10"
}
```
