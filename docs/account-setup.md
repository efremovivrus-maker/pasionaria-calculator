# Личный кабинет PASIONARIA Calculator

Авторизация и постоянное хранение выключены, пока обе переменные не равны `true`:

- `ACCOUNT_ENABLED`
- `NEXT_PUBLIC_ACCOUNT_ENABLED`

Пока они выключены, калькулятор, черновик КП в sessionStorage, PDF, n8n и Render работают как раньше.

## Локальное подключение

Проект Supabase уже создан, публичная регистрация выключена. Миграции выполняйте вручную в SQL Editor, по одному разу и в этом порядке. Повторный запуск первых двух файлов остановится на уже созданных таблицах и политиках.

1. Authentication → Sign In / Providers → Email. Провайдер Email включён. Пункт «Allow new users to sign up» выключен. Не включайте приглашения как способ входа: пользователей создаёт администратор.
2. Authentication → URL Configuration. Site URL: `http://localhost:3000`. В Redirect URLs добавьте `http://localhost:3000/account/password`. SMTP пока не нужен: без него работает вход по паролю, но не письмо восстановления.
3. SQL Editor → New query. Вставьте и выполните целиком, по очереди:
   - `supabase/migrations/20261116170000_account.sql`
   - `supabase/migrations/20261116170001_account_storage.sql`
   - `supabase/migrations/20261116180000_password_sign_in.sql`
   - `supabase/migrations/20261116190000_fix_proposal_save.sql`

Если первые три файла уже выполнены, повторно их запускать не нужно. Для исправления сохранения КП выполните только `supabase/migrations/20261116190000_fix_proposal_save.sql`.
4. Authentication → Users → Add user → Create new user. Укажите email и пароль не короче 8 символов. Включите Auto Confirm User. Не используйте Invite user: это отправит приглашение, а не создаст вход по паролю.
5. Скопируйте User UID этой строки. SQL Editor:

```sql
insert into public.profiles (id, email, display_name, role, active, must_change_password)
values ('UUID-ИЗ-AUTH-USERS', 'admin@example.com', 'Администратор', 'admin', true, false);
```

Email должен совпадать с адресом в Authentication → Users. `must_change_password = false` только у этого первого пароля, потому что администратор задал его сам. Менеджеров так не создавайте: их создаёт страница «Пользователи» и ставит временный пароль.

6. Project Settings → API Keys. Скопируйте Project URL. В `frontend/.env.local` добавьте, не коммитя файл:

```text
ACCOUNT_ENABLED=true
NEXT_PUBLIC_ACCOUNT_ENABLED=true
NEXT_PUBLIC_SUPABASE_URL=https://<project>.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=<publishable или legacy anon>
SUPABASE_SERVICE_ROLE_KEY=<legacy service_role>
```

Имена переменных старые, значения могут быть новыми. `NEXT_PUBLIC_SUPABASE_ANON_KEY` принимает publishable key `sb_publishable_...` и старый anon JWT. Оба попадают в браузер и подчиняются RLS. `SUPABASE_SERVICE_ROLE_KEY` принимает secret key `sb_secret_...` и старый service_role JWT. Для создания пользователей и сброса пароля нужен вызов Auth Admin. Секретный ключ обходит RLS, но Auth Admin иногда отвечает `bad_jwt` на `sb_secret_...`. Пока создание пользователя из кабинета не прошло, держите в серверной переменной именно legacy service_role JWT, тот, что начинается с `eyJ`. Не отключайте legacy keys. Секретный ключ не должен иметь префикс `NEXT_PUBLIC`.

7. Из каталога `frontend` запустите `npm run dev` и откройте `http://localhost:3000/account/login`.

Проверка:

- Неверный пароль оставляет сообщение «Неверный email или пароль» и не создаёт сессию.
- Верный пароль администратора открывает `/account/documents`.
- На странице администратора создайте менеджера с временным паролем. Пароль после создания в интерфейсе не сохраняется: передайте его лично.
- Выйдите, войдите менеджером. Кабинет оставляет только `/account/password`. В консоли браузера `fetch('/api/account/proposals').then((response) => console.log(response.status))` печатает `403`. Прямая запись в `proposals` или Storage с этой сессией тоже не проходит: `can_use_account()` ложно, пока флаг не снят, а свою строку профиля пользователь изменить не может.
- Смените пароль. После этого открываются документы. Повторный вход со старым временным паролем не проходит.
- Отключите менеджера. Его следующий вход показывает «Учётная запись отключена».
- Два менеджера не открывают документы друг друга. Администратор видит список пользователей, но чужое КП не открывает без строки в `access_grants`.

Гость без входа по-прежнему считает изделие и скачивает PDF. Флаги в Vercel не включайте, пока локальная проверка не пройдена.

## Переменные

В Vercel, для Production, после проверки на тестовом проекте:

```text
ACCOUNT_ENABLED=true
NEXT_PUBLIC_ACCOUNT_ENABLED=true
NEXT_PUBLIC_SUPABASE_URL=https://<project>.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=<publishable или legacy anon>
SUPABASE_SERVICE_ROLE_KEY=<legacy service_role>
```

`SUPABASE_SERVICE_ROLE_KEY` не должен иметь префикс `NEXT_PUBLIC`. В клиентский код он не попадает. Для Production используйте ту же пару ключей, которая прошла локальное создание пользователя.

Существующие `NEXT_PUBLIC_BACKEND_URL`, webhook n8n и ключ YandexGPT не меняются.

## Доступ

- Менеджер видит только свои расчёты, КП и файлы.
- Администратор управляет пользователями, но чужое КП не открывает, пока в `access_grants` нет строки `scope = 'read_proposals'`.
- Клиент не может сменить `owner_id`: это запрещают триггеры и сервер не принимает это поле.
- Пароли хранит Supabase Auth. В своих таблицах, логах и sessionStorage их нет. Самостоятельная регистрация выключена. Письмо восстановления уходит только после настройки SMTP.
- Пока `must_change_password` включён, пользователь видит только свой профиль. Запись и чтение документов, расчётов и файлов закрыты и в API приложения, и политиками RLS. Снять флаг может серверная роль или администратор, который уже сменил свой пароль.
- Фотографии лежат в закрытом bucket `proposal-photos` по пути `owners/<user id>/files/<file id>`.
- Снимок КП хранится целиком. Прайс не меняет уже сохранённую цену. Повтор расчёта создаёт новый расчёт.

## Резервная копия

В Supabase: Database → Backups. На бесплатном тарифе это ежедневные копии самого Supabase; уточните срок хранения в панели проекта.

Дополнительно можно выгрузить данные:

```bash
supabase db dump --data-only -f pasionaria-account.sql
```

Восстановление: новый проект, те же три миграции, затем заливка дампа. Файлы bucket нужно копировать отдельно через Storage.

## Проверка перед включением для всех

1. Гость без входа считает изделие, собирает КП и скачивает PDF.
2. Адрес без созданной учётной записи не входит и не регистрируется сам.
3. Два менеджера не открывают КП друг друга по UUID.
4. Сохранённое КП открывается на другом устройстве с теми же позициями, ценами, скидкой и фото.
5. Правка на втором устройстве при старой версии отвечает конфликтом и не затирает документ.
6. «Повторить расчёт» не меняет старую запись.
7. После этого можно ставить оба флага в `true` и пересобирать Production.

Локальные тесты проверяют правила доступа на модели этих таблиц. Они не заменяют проверку живого проекта Supabase.
