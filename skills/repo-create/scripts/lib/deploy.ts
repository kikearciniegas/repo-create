// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Rafael Arciniegas
// A deploy-like secret name: audit.ts judges the repo's secrets with it, scan.ts the tree's env-file names.
// shortcut: by name only, fail-closed — any provider word is deploy-like except these named non-secret ids; a new one needs adding here.
export const DEPLOYISH = /^(?!.*_(REGION|ORG_ID|PROJECT_ID|ANALYTICS_ID|ACCOUNT_ID)$).*(DEPLOY|VERCEL|NETLIFY|CLOUDFLARE|CF_API|FLY_|RENDER|RAILWAY|AWS|GCP|GOOGLE|AZURE|HEROKU|SSH|KUBE)/i;
