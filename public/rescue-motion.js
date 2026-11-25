/* Finite, optional motion. Content is usable before, during, and without it. */
(() => {
  const media = window.matchMedia?.("(prefers-reduced-motion: reduce)");
  const active = new Set();
  const pageAnimations = new Set();
  let userReduced = false,
    loginSeen = false,
    workspaceSeen = false;
  try {
    userReduced = localStorage.getItem("rescueroute.reduce-motion") === "true";
  } catch {
    /* Storage is optional. */
  }
  const reduced = () => userReduced || !!media?.matches;
  function cancel() {
    for (const animation of active) animation.cancel();
    active.clear();
    pageAnimations.clear();
  }
  function sync() {
    const off = reduced();
    document.documentElement.dataset.motion = off ? "off" : "on";
    if (off) cancel();
    for (const button of document.querySelectorAll("[data-motion-toggle]")) {
      button.setAttribute("aria-pressed", String(off));
      button.disabled = !!media?.matches;
      button.title = media?.matches
        ? "Reduced motion follows your device preference."
        : "Turn decorative animations on or off.";
      button.querySelector(".motion-label").textContent = off
        ? "Motion: reduced"
        : "Motion: on";
    }
  }
  function reveal(elements, direction = "up", group = active) {
    if (reduced()) return;
    [...elements].slice(0, 12).forEach((element, index) => {
      if (
        !element.isConnected ||
        element.closest("[hidden]") ||
        typeof element.animate !== "function"
      )
        return;
      const animation = element.animate(
        [
          {
            opacity: 0.65,
            transform:
              direction === "side" ? "translateX(-12px)" : "translateY(12px)",
          },
          { opacity: 1, transform: "translate(0, 0)" },
        ],
        {
          duration: 440,
          delay: index * 30,
          easing: "cubic-bezier(.2,.7,.2,1)",
          fill: "backwards",
        },
      );
      active.add(animation);
      group.add(animation);
      animation.finished.then(
        () => {
          active.delete(animation);
          group.delete(animation);
        },
        () => {
          active.delete(animation);
          group.delete(animation);
        },
      );
    });
  }
  function login() {
    if (loginSeen) return;
    loginSeen = true;
    document.getElementById("login-screen").classList.add("entry-play");
    reveal(
      document.querySelectorAll(
        ".login-brand-row, .login-story-copy > .hero-label, .login-story-copy > h1, .login-story-copy > p, .login-card",
      ),
    );
  }
  function workspace() {
    if (workspaceSeen) return;
    workspaceSeen = true;
    reveal(document.querySelectorAll(".sidebar, .topbar"), "side");
  }
  function page(root) {
    for (const animation of pageAnimations) animation.cancel();
    pageAnimations.clear();
    if (!root) return;
    reveal(
      root.querySelectorAll(
        ".page-heading, .platform-hero, .guide-callout, .metrics > .metric, .rescue-step, .delivery-card, .review-card",
      ),
      "up",
      pageAnimations,
    );
  }
  document.addEventListener("click", (event) => {
    const button = event.target.closest("[data-motion-toggle]");
    if (!button || media?.matches) return;
    userReduced = !userReduced;
    try {
      localStorage.setItem("rescueroute.reduce-motion", String(userReduced));
    } catch {
      /* The current preference still applies. */
    }
    sync();
  });
  // Interaction settles panel entrances immediately; no animation gates an action.
  document.addEventListener("pointerdown", cancel, { passive: true });
  document.addEventListener("keydown", cancel);
  window.addEventListener("pagehide", cancel);
  media?.addEventListener?.("change", sync);
  window.RescueMotion = { login, workspace, page, sync };
  sync();
})();
