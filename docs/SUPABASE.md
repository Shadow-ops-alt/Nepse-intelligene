# Supabase hosted mode

The standalone Android app can run in two modes:

- **Local mode**: no `/hosted-config.json`, market data from the bundled pack,
  personal data in the phone's local JSON store.
- **Hosted mode**: `/hosted-config.json` exists, the app shows an email/password
  login, and personal data lives in Supabase Postgres. Market data still comes
  from the local pack.

The hosted mode is optional. The desktop app and the PWA stay local unless the
config file is served.

## Project

- Project ref: `vfotsbbookypijnjcpjg`
- URL: `https://vfotsbbookypijnjcpjg.supabase.co`
- Region: `ap-northeast-2`
- Schema: [`docs/SUPABASE_SETUP.sql`](./SUPABASE_SETUP.sql), applied once in the
  Supabase dashboard SQL Editor.
- Auth: email/password, invite-only. There is no signup screen.

## Tables and security

`watchlist`, `portfolio_transactions`, `trade_plans`, `trade_journal`,
`corporate_ledger`, and `reconciliation_imports` all have a `user_id` default
of `auth.uid()`. Row Level Security is enabled with owner-only select, insert,
update and delete policies. The `anon` role has no table privileges.

The app uses only the **publishable key**. The **secret key** is server/admin
only and must never be placed in the APK, the hosted config, the repo, or a
browser bundle. Both keys were provided during setup; rotate them in the
Supabase dashboard if this transcript is shared.

## Client configuration

Create `apps/mobile/assets/mobile/hosted-config.json` (ignored by git):

```json
{
  "supabaseUrl": "https://vfotsbbookypijnjcpjg.supabase.co",
  "supabaseAnonKey": "sb_publishable_..."
}
```

The example file is committed as `hosted-config.example.json`. The Android
local server serves the real file at `/hosted-config.json`; without it the app
stays in local mode. A build with the file bundled is the hosted APK.

## Client account

1. In the Supabase dashboard open **Authentication → Sign In / Providers → Email**
   and turn **Allow new users to sign up** off. The project was created with
   public signup enabled; RLS still isolates data, but invite-only requires
   this toggle.
2. Open **Authentication → Users**.
3. Create the client user with their email and a temporary password, email
   confirmed. Do not enable public signup.
4. Send the email and password separately. Tell the client to change the
   password after the first sign-in if you enabled password changes.

Test accounts created during verification:

- `demo@example.com` / `NepseDemo2026`
- `demo+nepse@example.com` / `NepseDemo!2026`
- `demo2+nepse@example.com` / `NepseDemo!2026`

Delete or disable these before handing the project over.

## Build and install

```bash
cd /home/xenos/Public/nepse-intelligene
npx --yes pnpm@12.16.1 build:web
bash apps/mobile/build.sh
adb install -r apps/mobile/release/NEPSE-Terminal-0.6.0-standalone.apk
```

The APK bundles the web UI, the five-year data pack, and the hosted config.
The local server uses the fixed loopback port `41731` so the Supabase session
survives a cold restart. If the port is taken, the app falls back to an
ephemeral port and the user must sign in again.

## Verification performed

- Schema applied through the Seoul pooler; six tables and six RLS policies.
- Cloud CRUD for every table as a signed-in user.
- User A cannot read or change user B's rows; anonymous access is denied.
- Hosted adapter tests: watchlist, trade plans with derived risk, journal with
  P&L and a chart snapshot round trip, corporate ledger, portfolio,
  reconciliation summary, idempotent CSV import.
- Android 35 emulator: login screen, real cloud login, Market overview from the
  local pack, and session persistence across force-stop and relaunch.

## Limits

- Live LTP and intraday are not part of hosted mode. Market data is the local
  pack; a Supabase Edge Function or worker would be needed for live quotes.
- Personal pages require network access. The market pack still works offline.
- The pack is dated 2026-11-13. Use the in-app data update action when a newer
  pack is published.
- The APK is debug-signed and the Windows installer is unsigned.
