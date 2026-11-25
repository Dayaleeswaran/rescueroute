/**
 * @module deployment
 * Deployment configuration helpers for RescueRoute.
 * Validates public hosting settings and determines whether an incoming HTTP
 * Host header is allowed, preventing host-header injection attacks.
 */

/**
 * Builds and validates the deployment configuration from environment-supplied options.
 * Throws if public demo mode is enabled but `publicOrigin` is missing or invalid.
 * @param {{ publicDemo?: boolean, publicOrigin?: string }} [options={}] - Deployment options.
 * @param {boolean} [options.publicDemo=false] - Whether the app is running as a public demo.
 * @param {string} [options.publicOrigin=""] - The canonical HTTPS origin (e.g. `https://app.example.com`).
 * @returns {{ publicDemo: boolean, origin: string|null, hostname: string|null, secureCookies: boolean }} Resolved deployment config.
 * @throws {Error} If `publicDemo` is true but `publicOrigin` is missing or not a plain HTTPS origin.
 */
export function deploymentConfig({
  publicDemo = false,
  publicOrigin = "",
} = {}) {
  if (!publicDemo)
    return {
      publicDemo: false,
      origin: null,
      hostname: null,
      secureCookies: false,
    };
  let url;
  try {
    url = new URL(publicOrigin);
  } catch {
    throw new Error(
      "Public demo hosting requires PUBLIC_ORIGIN (or RENDER_EXTERNAL_URL), for example https://your-service.onrender.com.",
    );
  }
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash
  )
    throw new Error(
      "PUBLIC_ORIGIN must be a plain HTTPS origin with no path, credentials, query, or fragment.",
    );
  return {
    publicDemo: true,
    origin: url.origin,
    hostname: url.host,
    secureCookies: true,
  };
}

/**
 * Returns true when the given HTTP `Host` header is permitted for this deployment.
 * In public demo mode, only the configured hostname is accepted.
 * In local mode, localhost variants (127.0.0.1, [::1]) are accepted.
 * @param {string} host - The HTTP `Host` header value.
 * @param {{ publicDemo: boolean, hostname: string|null }} config - Deployment config from {@link deploymentConfig}.
 * @returns {boolean} True if the host is allowed.
 */
export function allowedHost(host, config) {
  return config.publicDemo
    ? host === config.hostname
    : /^(?:localhost|127\.0\.0\.1|\[::1\])(?::\d{1,5})?$/.test(host || "");
}
