# Dependencies

Policy: as few direct dependencies as possible. Each one has a stated purpose and a trust
rationale, and versions are pinned by `package-lock.json`.
All packages are **devDependencies**. adapter-node bundles what is used at build time, so
the **runtime image contains no `node_modules`**.

## Runtime-relevant (code ends up in the bundle)

| Package                  | Version | Used for                                      | Why trusted                                                                                                                                               |
| ------------------------ | ------- | --------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `svelte`                 | 5.57    | UI components (runes)                         | Maintained by the Svelte core team (Vercel-sponsored), MIT, very widely used                                                                              |
| `@sveltejs/kit`          | 3.1     | Routing, SSR, server loads, form actions, CSP | Same team, MIT; the official Svelte application framework                                                                                                 |
| `@sveltejs/adapter-node` | 6.0     | Standalone Node server output                 | Official SvelteKit adapter                                                                                                                                |
| `@lucide/svelte`         | 1.61.0  | Icons                                         | ISC, Lucide project (fork of Feather); **zero dependencies**; pinned exactly                                                                              |
| `oauth4webapi`           | 3.8.8   | OpenID Connect sign-in at the tenant's Kanidm | MIT, by Filip Skokan (panva), author of `jose` and `openid-client`; OpenID Certified relying party; **zero dependencies**; npm provenance; pinned exactly |

## Build and test only

| Package                                                             | Used for                         | Why trusted                                                     |
| ------------------------------------------------------------------- | -------------------------------- | --------------------------------------------------------------- |
| `vite`, `@sveltejs/vite-plugin-svelte`                              | Bundler                          | Vite core team / Svelte team, MIT                               |
| `tailwindcss`, `@tailwindcss/vite`                                  | Styling (compiled to static CSS) | Tailwind Labs, MIT                                              |
| `typescript`, `svelte-check`, `@types/node`                         | Type checking                    | Microsoft / Svelte team / DefinitelyTyped                       |
| `vitest`                                                            | Unit and isolation tests         | Vitest team (VoidZero), MIT; updated to fix GHSA-qxg6-89mg-rqv8 |
| `prettier`, `prettier-plugin-svelte`, `prettier-plugin-tailwindcss` | Formatting                       | Prettier org / Svelte team / Tailwind Labs                      |

## Release workflow

[release.yml](../.github/workflows/release.yml) uses these GitHub Actions, each pinned by
commit SHA:

| Action                                                                                                                                | Used for                                       | Why trusted                           |
| ------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------- | ------------------------------------- |
| `actions/checkout` v7.0.1, `actions/attest-build-provenance` v4.2.2                                                                   | Checkout and the signed provenance attestation | Maintained by GitHub                  |
| `docker/setup-buildx-action` v4.4.1, `docker/login-action` v4.6.0, `docker/metadata-action` v6.2.0, `docker/build-push-action` v7.4.0 | Build, tag and push the image to GHCR          | Official actions maintained by Docker |

## Deliberately not used

- **`@elastic/elasticsearch`**: the portal needs only `_search`. Node's built-in `fetch`
  plus a read-only route allowlist avoids coupling the client major version to the cluster's
  major version and adds no transitive dependencies. It fits again if bulk or scroll APIs
  are needed.
- **shadcn-svelte / bits-ui / tailwind-variants / tailwind-merge / clsx**: the few
  components needed (badge, table, dropdown filter, date picker, side sheet) are written by
  hand in the same style, on native `<dialog>` and `<details>`, which handle focus and
  Escape and work without JavaScript. This avoids about four packages.
- **TanStack Table**: sorting, filtering and pagination all happen server-side and are
  driven by URL parameters, so a client table engine would only provide column definitions.
  It is worth adopting if client-side column visibility or resizing is wanted.
- **`openid-client`**: the same author's higher-level client on top of `oauth4webapi`. It
  adds `jose`, which it uses for encrypted ID tokens; Kanidm signs ID tokens and does not
  encrypt them. The portal's flow is about 20 lines more on `oauth4webapi` directly.
- **Auth.js, Better Auth, Arctic**: Auth.js and Better Auth bring their own sessions and
  several packages each (Better Auth also database adapters). Arctic leaves ID token
  checks to the caller. Sessions stay on `node:crypto` (HMAC, `timingSafeEqual`).

## Tooling images

- **Build and run:** `node:24.22.1-alpine`, pinned by digest in the `Dockerfile`.
- **Screenshots:** `mcr.microsoft.com/playwright:v1.64.1-noble` (Microsoft's official
  image).
- **Lab sign-in:** `kanidm/server:1.11.2` and `kanidm/tools:1.11.2`, the Kanidm project's
  official images, pinned by digest in `compose.yaml`.
