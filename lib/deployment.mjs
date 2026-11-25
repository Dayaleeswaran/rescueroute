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

export function allowedHost(host, config) {
  return config.publicDemo
    ? host === config.hostname
    : /^(?:localhost|127\.0\.0\.1|\[::1\])(?::\d{1,5})?$/.test(host || "");
}
