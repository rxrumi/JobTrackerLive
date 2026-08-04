# Contributing to Live Job Index

Live Job Index welcomes focused pull requests, but this is a source-available
project rather than an open-source project. `LICENSE.md` permits local testing
and temporary forks only for evaluation and contribution. It does not permit
self-hosting, production use, redistribution, or independent reuse.

## Before opening a pull request

1. Open or find an issue describing the change, unless it is a small typo or
   documentation correction.
2. Fork the repository only for preparing the contribution.
3. Create a narrowly scoped branch from the current `master` branch.
4. Do not include credentials, personal data, production exports, generated
   reports, or unrelated formatting changes.
5. Add or update deterministic tests for behavior changes.
6. Run the full verification sequence below.
7. Sign the Contributor License Agreement when CLA Assistant prompts you on
   the pull request.

## Local contribution setup

Requires Node.js 22 or newer. Browser automation is intentionally excluded.

```bash
npm ci
cp .dev.vars.example .dev.vars
npm run build:frontend
git diff --exit-code -- public
npm audit --omit=dev
npm test
npm run test:migrations
npm run check:types
npm run check:deploy
```

The placeholder `.dev.vars` values are for local contribution testing only.
They do not provide access to Live Job Index accounts, data, Cloudflare
resources, Clerk, OpenAI, or production deployment.

## Pull request expectations

- Keep production behavior backward compatible unless the issue explicitly
  approves a breaking change.
- Keep Worker and frontend classification/scoring behavior aligned.
- Keep migrations additive; never reset or destructively rewrite production
  data.
- Explain user-visible behavior, operational risk, and verification performed.
- Complete the pull-request checklist and resolve review conversations.
- Do not expect a contribution to be merged or deployed merely because it
  passes automated checks.

The repository owner may modify, decline, close, or accept any proposal. Only
accepted commits on the protected `master` branch are eligible for the
owner-controlled production deployment.

## Security reports

Do not open a public issue for a suspected vulnerability. Follow
`SECURITY.md` and use GitHub's private vulnerability reporting feature.
