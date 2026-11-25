# Public cloud demo on Render

RescueRoute includes a Render Blueprint for a **public evaluation demo**. Each browser receives a private, temporary workspace, keeping published demo credentials separate from other visitors' records and GPS fixes.

## Deploy

[![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy?repo=https://github.com/Dayaleeswaran/rescueroute)

1. Open the link and create or sign in to your own Render account. Use GitHub sign-in if offered.
2. Connect `Dayaleeswaran/rescueroute` when Render requests repository access. Review the Blueprint configuration.
3. Choose a Blueprint name, keep the included **free** service plan, and launch the deployment. No paid disk, database, or API key is needed for this evaluation setup.
4. Wait for the service to deploy successfully. Open the **actual public URL shown by Render**; the service name may receive a suffix, so do not guess the URL.
5. Open `/health` at that URL. It should return `status: "ok"` and `mode: "public-demo"`. Sign in and check planning, the map, and deliveries.

This is a Node **web service**, not a static site. The API and live event streams require a running server. Deployment still needs the owner's Render account; a prepared configuration is not proof of publication.

## Included configuration

| Setting           | Value                                    |
| ----------------- | ---------------------------------------- |
| Source branch     | `main`                                   |
| Runtime           | Node.js 22.22.2                          |
| Build             | `npm ci --omit=dev --ignore-scripts`     |
| Start             | `npm start`                              |
| Health check      | `/health`                                |
| Mode              | `PUBLIC_DEMO=true`                       |
| Listening address | `0.0.0.0` on Render's `PORT`             |
| Public origin     | Automatically uses `RENDER_EXTERNAL_URL` |
| Storage           | Isolated per-browser memory; temporary   |
| External AI       | Disabled by default; explicit owner opt-in             |

`PUBLIC_ORIGIN` overrides the detected origin for another host or configured custom domain. Use the exact HTTPS origin with no path. Host and mutation-origin checks remain enforced. Public cookies are Secure, HttpOnly, and SameSite=Strict.

## Workspace behaviour

- A successful sign-in creates an unguessable workspace cookie and a fresh copy of the fictional records. Failed logins do not allocate workspaces.
- Visitors can change roles, edit records, reserve meals, and reset their own workspace. They cannot reset another visitor's state or revoke that visitor's sessions.
- Signing out and in **in the same browser** keeps its workspace. Separate browsers/private contexts get separate workspaces. This public evaluation mode is not a shared production organisation or cross-device coordination service.
- GPS and demo movement are scoped to the same workspace. The normal role and active-delivery checks still apply inside it. No GPS history is persisted.
- State resets on process restart. Workspaces expire after one hour without API activity. Export records you want to keep; use fictional profile information.
- Active workspaces are capped at 20. At capacity, new visitors are asked to try later; active visitors are not evicted to make room.
- Public mode neither reads nor writes the local `.data` file. Local mode retains its existing persistence.

## Free-service limits

Render's free services can spin down or restart, and the next visit can experience a cold start. They do not provide a persistent disk. This setup intentionally treats data as temporary. Review [Render's current free-service documentation](https://render.com/docs/free) before relying on availability.

Real ongoing operations need private credentials, a durable shared database, coordinated sessions, backups, privacy controls, and operational policies. The isolated evaluation demo is a separate use case.

## Docker and other providers

The Dockerfile runs the same public-demo server. Set `PUBLIC_ORIGIN` to the provider's assigned HTTPS origin and configure its port mapping. Use one instance for this in-memory demo. The container health check calls `/health`, which requires no session or public Host header. Normal local development should use `PUBLIC_DEMO=false` and `npm start`.

## Verify before sharing

1. Confirm Render reports a successful deploy and the actual URL responds.
2. Use two isolated browser contexts. Reserve food in one and confirm the other is unchanged.
3. Reset one workspace and confirm the other stays signed in.
4. Confirm the map assets and live connection load and mutations pass origin checks.
5. Test voluntary GPS over HTTPS and stop sharing. Hardware accuracy and permissions depend on the browser/device.
6. Restart the service and verify the documented state reset.

Automated deployment tests cover HTTPS configuration, host/origin checks, secure cookies, cross-workspace sessions, reservation/GPS isolation, scoped reset, capacity, and expiry. They do not establish that an external deployment is live.

## References

- [Deploy to Render](https://render.com/docs/deploy-to-render)
- [Blueprint reference](https://render.com/docs/blueprint-spec)
- [Environment variables](https://render.com/docs/environment-variables)
- [Port binding](https://render.com/docs/web-services#port-binding)

## Optional Gemini extraction

In Render's environment settings, add `GEMINI_API_KEY` as a secret, set `GEMINI_MODEL=gemini-3.8-flash`, and set `PUBLIC_AI_ENABLED=true` only if you want visitors to use your provider allowance. Never commit a key. The service limits actual provider attempts to 60 per hour per process; restarts reset that counter, so also configure provider-side spending controls. Local extraction remains available after errors or exhaustion. The default timeout is 8 seconds (`GEMINI_TIMEOUT_MS`, bounded to 20 seconds), followed by a 30-second circuit pause after failure.

The default model is now Gemini 3.8 Flash; see [AI architecture](AI_ARCHITECTURE.md) before enabling it. The public no-key demo needs none of these optional settings.
