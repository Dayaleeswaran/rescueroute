# Security design and review scope

RescueRoute is an evaluation demo with public fictional accounts. Public hosting uses isolated, temporary per-browser workspaces. This model allows visitors to explore roles; it does not authenticate real organisations or provide production multi-tenant identity.

| Boundary | Control | Regression evidence |
| --- | --- | --- |
| Unauthenticated caller to operational data | Expiring sessions, password hashing, uniform sign-in errors, bounded login attempts | HTTP authentication and revocation checks |
| Participant to another role's records | Server-side role and ownership checks, filtered state/map/export views | Domain, HTTP, and cross-workspace checks |
| Browser to state-changing routes | CSRF tokens, configured Host, same-origin checks, JSON/body limits | CSRF/origin/host/method/body tests |
| Untrusted text to HTML or model | Escaped interface values, CSP, separate model instructions, strict draft schema, source grounding and human review | DOM injection, malformed model and unsupported-fact cases |
| Concurrent plans to shared stock | Serial transactions, revisions, independent feasibility audit and reservations | Duplicate confirmation, rollback, conservation and stale-plan cases |
| Public visitor to another visitor | Unguessable workspace cookie and per-workspace state/GPS | Actual public deployment reservation-isolation verification |
| Slow socket to server memory | 32 live clients per workspace; disconnect on backpressure or broken writes | Stream-limit regression tests |
| Private data to browser/proxy caches | Operational responses use `no-store`; only public static assets use revalidating ETags | Conditional request and authenticated cache tests |
| Third-party scripts/frames/browser capabilities | CSP, resource/opener isolation, denied framing, camera/microphone/payment/USB disabled; GPS remains opt-in | HTTP header assertions; actual browser behaviour still needs review |

Provider keys remain in the server environment and authentication header, never a URL, browser form, or model prompt. Public provider use is disabled by default and bounded when explicitly enabled. The app cannot certify food safety or verify donor ingredient declarations.

`npm audit` checks the installed dependency tree for known advisories; it does not audit the application. ESLint and tests add evidence but are not a penetration test. No independent security certification is claimed.

Production use needs private credentials and organisation verification, durable shared storage, coordinated sessions/rate limits, monitoring, tested recovery, routing and privacy procedures, and review by responsible operators. Public sample passwords must not be reused for real records. Do not submit private data or secrets in public GitHub issues.
