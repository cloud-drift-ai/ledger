# Ledger production deployment notes

This source package is configured for the GitHub Pages project site:

`https://cloud-drift-ai.github.io/ledger/`

## Source-code fixes included

- Authentication confirmation and password-recovery callback URLs now use Vite's `BASE_URL`, so the `/ledger/` project path is retained on GitHub Pages while local development continues to use the root path.
- The web app manifest now uses `/ledger/` for its start URL and scope, and includes the correct icon paths.
- Recurring-payment notification icons now use Vite's base URL.
- The fallback `public/sw.js` now uses the `/ledger/` base path. `vite.config.ts` continues to generate the versioned production service worker during builds.

## Required Supabase dashboard configuration

In the Supabase project, open **Authentication → URL Configuration**.

Set **Site URL** to:

`https://cloud-drift-ai.github.io/ledger/`

Add these exact entries to **Redirect URLs**:

- `https://cloud-drift-ai.github.io/ledger/login`
- `https://cloud-drift-ai.github.io/ledger/reset-password`

For local development, optionally add:

- `http://localhost:5173/**`

In **Authentication → Email Templates → Password Recovery**, check that the link does not contain a hardcoded localhost address. If the template constructs its destination using `{{ .SiteURL }}`, follow the Supabase redirect-template guidance and use `{{ .RedirectTo }}` where appropriate. Do not replace a working `{{ .ConfirmationURL }}` token-verification link with a plain app URL.

The repository's GitHub Actions workflow also expects these repository secrets:

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_PUBLISHABLE_KEY`

Do not commit `.env.local` or any service-role/secret key.

## Build and deploy

From the project folder:

```powershell
npm ci
npm run build
```

Commit and push the source changes to `main`. The existing GitHub Actions workflow will build and deploy `dist`.

After deployment, submit a **new** password-recovery request from the live `/ledger/forgot-password` page. Previously sent emails keep their original redirect URL. If Ledger was installed as a PWA before the manifest fix, uninstall and reinstall it after deployment so the updated start URL and scope are applied.
