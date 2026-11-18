# Deployment

Deploy this repository's root directory. The parent workspace, archived versions and internal notes are separate local folders.

## Render configuration

`render.yaml` defines a Node web service with:

- Build: `npm ci && npm run vendor`
- Start: `npm start`
- Health endpoint: `/health`

Configure database credentials and upload the database provider's CA certificate through the hosting platform's secret settings. The included configuration uses:

```dotenv
NODE_ENV=production
HOST=0.0.0.0
TRUST_PROXY=1
COOKIE_SECURE=1
DB_SSL=1
DB_SSL_CA_FILE=/etc/secrets/aiven-ca.pem
```

Set `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD` and `DB_NAME` for the deployed database. Initialize a new database with `npm run db:init`; apply schema upgrades to an existing database with `npm run db:migrate`. Run these commands with the intended database environment and back up existing data before migration.

The platform supplies `PORT`. Run the normal MySQL mode for persistent deployment; `npm run demo` uses fictional accounts and local file storage.

## Second deployment

`deploy/render-preview.yaml` configures the `safetap-preview` service from the `ui/safetap-foundation` branch. Its normal MySQL startup uses the same database and accounts as the original service. Despite the URL's preview name, changes to students, attendance and events affect the shared live records.

The Blueprint references `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD` and `DB_NAME` from the original `safetap` service. Set `DB_CA_CERT` in the second service's environment settings to the database CA certificate's PEM content. Startup writes this certificate outside the public directory before the existing TLS validation runs. Credentials and the certificate are not stored in Git.

The Blueprint only manages `safetap-preview`; it does not manage the original `safetap` service or run database initialization or migrations. Automatic deploys and Blueprint auto-sync remain off. After rotating credentials on the original service, sync this Blueprint and redeploy the second service so it receives the updated values.

Browser sessions and offline queues belong to each URL separately. Upload pending records on their original URL before switching. Real-time socket notifications stay within each service; the existing polling refresh picks up changes made through the other service.

## HTTPS and local hosting

For local hosting, `deploy/safetap.service` is a sample systemd user service. Adjust its working directory and Node path to match the installation. Put the app behind an HTTPS reverse proxy and enable `TRUST_PROXY=1` and `COOKIE_SECURE=1` only for that trusted setup. The proxy must forward the original host/protocol and support Socket.IO WebSocket upgrades.

Keep one Node process unless shared Socket.IO and rate-limit coordination are configured.

## Verify a release

Check `/health`, `/api/config` and `/api/version`. The version endpoint reports the release, frontend build and deployed commit when available. Render supplies `RENDER_GIT_COMMIT`; other hosts can set `SAFETAP_COMMIT` during deployment.

Verify login, role restrictions, student counts, scanner assets, offline reload/upload and report export. Run the [phone acceptance checks](testing.md) on the intended devices.

Build-versioned JavaScript/CSS use long cache lifetimes in production. Change the version in `public/index.html`, `public/sw.js` and `src/release.js` together when publishing changed assets. HTML, the service worker and API responses must remain fresh. Reload online and wait for offline readiness after an update. Preserve phone storage while scans are pending.

## Optional source export

The repository itself is ready for Git. To create a separate source-only copy:

```bash
npm run deploy:prepare
```

The copy is written to `.runtime/source-export` and excludes Git metadata, runtime data, local notes, secrets, generated vendor files and dependencies. Existing output is never overwritten. Use `npm run deploy:prepare -- --output /path/to/new-folder` for a different destination.

## TiDB Cloud Starter

SparTap can use a MySQL-compatible TiDB Cloud Starter instance. Keep TLS enabled
(`DB_SSL=1`) and hostname verification enabled. Set the `DB_*` connection values
from the instance's Connect panel and use a trusted CA bundle in
`DB_SSL_CA_FILE`. The public Starter endpoint trusts standard root certificates;
an Aiven-specific CA certificate must not be reused for TiDB.

When moving an existing installation, preserve all domain tables and session
records, including student IDs, password hashes, NFC IDs, QR tokens, attendance,
events, submissions, and audit history. The `migration` command exports only the
directory and is not a complete database backup. Use a full verified backup for
provider changes, import into an empty target, and compare every table before
switching the application connection settings. Keep backups and credentials
outside the Git repository.

Run the optional MySQL integration tests against an isolated test environment on
the target provider before cutover. These tests create and remove their own test
databases; they must not replace or clear the live database.

A new Cloudflare hostname has separate browser storage. Upload any pending phone
records on the old hostname before moving devices to the new one.

## School email sign-in and password recovery

Admin signs in with the existing username/password and opens **School email accounts**
(`/school-accounts.html`) to link one school email to each existing staff/rep account.
Only explicitly linked, active accounts can use either school sign-in method.
Removing an email blocks future email/Google sign-ins; disable the account to revoke
all access, including its registered emergency scanner.

Email OTP and Forgot password use Resend. Set `RESEND_API_KEY` and `EMAIL_FROM`
(a sender on a domain verified in Resend) in Render Environment. Codes expire after
10 minutes, allow five guesses, and are single use. A resend replaces the previous
code for the same purpose. Sends have a 60-second cooldown and a five-per-email,
30-per-IP daily limit (UTC). Login and reset challenges are separate. Successful
password recovery revokes normal login sessions; scanner registration is separate.

For Google, create an OAuth **Web application** client in Google Cloud and configure
its consent screen for the school organization (or approved test users while testing).
Add this exact authorized redirect URI:
`https://spartap.terincorp.com/api/auth/google/callback`.
Set `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, and
`PUBLIC_APP_URL=https://spartap.terincorp.com` in Render Environment, then redeploy.
`SCHOOL_EMAIL_DOMAIN` defaults to `g.batstate-u.edu.ph`.
Google and OTP are alternative sign-in options; Google does not require an extra OTP.
Google tokens are verified server-side, including audience, issuer (via Google's
library), nonce, verified email and hosted domain. Authorization uses explicit email
mapping and pins the Google subject after the first successful sign-in.

Both methods remain unavailable until configured. Username/password continues to
work. Never put secrets in source control. Auth mappings, hashed pending codes,
rate limits and short-lived OAuth state persist in the additive MySQL
`school_auth_state` table. Demo mode keeps these in memory only. Google/Resend
live credentials and a physical phone are required for end-to-end delivery testing.

## Registrations and presentation reset

Administrators can open **Registrations** from the desktop sidebar or mobile More
menu. `/#registrations` and the older `/school-accounts.html` link open the same
page in the main application shell. It lists all account/email mappings, registered
scanner accounts, and searchable students. Device credentials are never returned.

The presentation reset clears classes, attendance, evacuation events, participants,
check-ins, submissions, audit history, linked school emails, pending OTP/OAuth state,
and registered scanner devices. Accounts, students, blocks, rooms, and normal login
sessions remain. SQL reset saves a snapshot into `presentation_backups` and deletes
records in the same transaction, under the application write lock. A failed backup
or deletion rolls back the reset. Demo mode keeps the snapshot in memory only.
The endpoint requires an administrator session, CSRF verification, and the exact
confirmation `RESET PRESENTATION`. Treat backups as private data and retain the
returned backup reference. Old offline queues refer to removed events and should
be cleared on presentation devices before recording new scans.
