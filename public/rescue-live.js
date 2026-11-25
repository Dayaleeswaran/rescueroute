/* Live updates, opt-in location, and labelled demo movement lifecycle. */
window.createRescueLive = function createRescueLive({
  state,
  api,
  renderShell,
  render,
  showLogin,
  toast,
  $,
}) {
  let eventStream = null,
    liveTimer = null,
    livePending = false,
    liveRefreshing = false,
    tickTimer = null;
  let gpsWatch = null,
    lastGpsSent = 0,
    gpsMessage = "Not sharing GPS.",
    demoTimer = null,
    demoId = null;
  let gpsGeneration = 0,
    gpsRequest = Promise.resolve(),
    demoRequest = Promise.resolve(),
    demoInFlight = false;
  let connectionStatus = "Connecting to network updates?";
  function streamStatus() {
    const el = $("network-stream-status");
    if (el) el.textContent = connectionStatus;
  }
  function trackingMessage(message) {
    gpsMessage = message;
    const el = $("gps-message");
    if (el) el.textContent = message;
  }
  function mountNetwork() {
    if (!state.data?.mapData) return;
    window.RescueMap?.mount(state.data.mapData, {
      role: state.data.user.role,
      startGps,
      stopGps,
      startDemo,
      stopDemo,
      gpsStatus: () => gpsMessage,
      streamStatus,
    });
  }
  function stopLiveResources() {
    ++gpsGeneration;
    eventStream?.close();
    eventStream = null;
    clearTimeout(liveTimer);
    clearInterval(tickTimer);
    tickTimer = null;
    if (gpsWatch !== null) navigator.geolocation?.clearWatch(gpsWatch);
    gpsWatch = null;
    clearInterval(demoTimer);
    demoTimer = null;
    demoId = null;
    livePending = false;
    gpsMessage = "Not sharing GPS.";
    window.RescueMap?.destroy();
  }
  async function liveRefresh() {
    if (!state.session) return;
    if (state.busy || $("editor").open || liveRefreshing) {
      livePending = true;
      return;
    }
    liveRefreshing = true;
    const session = state.session;
    try {
      const next = await api("/api/state");
      if (!state.session || session !== state.session) return;
      if (state.busy || $("editor").open) {
        livePending = true;
        return;
      }
      const sameRevision = state.data?.revision === next.revision;
      state.data = next;
      if (sameRevision) window.RescueMap?.update(next.mapData);
      else {
        renderShell();
        render();
      }
    } catch (e) {
      if (e.status !== 401) {
        connectionStatus = "Connection interrupted - retrying";
        streamStatus();
      }
    } finally {
      liveRefreshing = false;
    }
  }
  function queueLiveRefresh() {
    clearTimeout(liveTimer);
    liveTimer = setTimeout(liveRefresh, 150);
  }
  function startLive() {
    if (!state.session || eventStream) return;
    if (!window.EventSource) {
      connectionStatus = "Live connection unavailable - use Refresh";
      streamStatus();
      return;
    }
    eventStream = new EventSource("/api/events");
    eventStream.addEventListener("connected", () => {
      connectionStatus = "Live network updates connected";
      streamStatus();
      queueLiveRefresh();
    });
    eventStream.addEventListener("network", queueLiveRefresh);
    eventStream.addEventListener("tracking", queueLiveRefresh);
    eventStream.addEventListener("session-expired", () => {
      showLogin();
      toast("Your session changed. Please sign in again.");
    });
    eventStream.onerror = () => {
      connectionStatus = "Reconnecting to network updates...";
      streamStatus();
    };
    tickTimer = setInterval(() => {
      window.RescueMap?.tick();
      if (livePending && !state.busy && !$("editor").open) {
        livePending = false;
        queueLiveRefresh();
      }
    }, 1500);
  }
  function startGps() {
    if (gpsWatch !== null) return toast("Location sharing is already active.");
    if (!navigator.geolocation)
      return trackingMessage("This browser does not provide geolocation.");
    const generation = ++gpsGeneration;
    trackingMessage("Waiting for browser location permission...");
    lastGpsSent = 0;
    gpsWatch = navigator.geolocation.watchPosition(
      async (position) => {
        if (
          generation !== gpsGeneration ||
          gpsWatch === null ||
          Date.now() - lastGpsSent < 5000
        )
          return;
        lastGpsSent = Date.now();
        try {
          gpsRequest = api("/api/tracking/gps", {
            latitude: position.coords.latitude,
            longitude: position.coords.longitude,
            accuracy: position.coords.accuracy,
          });
          await gpsRequest;
          if (generation !== gpsGeneration) return;
          trackingMessage(
            `Sharing GPS - reported accuracy +/-${Math.round(position.coords.accuracy)} m. Stop sharing at any time.`,
          );
          queueLiveRefresh();
        } catch (e) {
          trackingMessage(`Location was not shared: ${e.message}`);
        }
      },
      (error) => {
        const message =
          error.code === 1
            ? "Location permission denied. No new location was shared."
            : "Location unavailable. Check device settings and retry.";
        stopGps(false).finally(() => trackingMessage(message));
      },
      { enableHighAccuracy: true, maximumAge: 10000, timeout: 20000 },
    );
  }
  async function stopGps(showMessage = true) {
    ++gpsGeneration;
    if (gpsWatch !== null) navigator.geolocation?.clearWatch(gpsWatch);
    const wasSharing = gpsWatch !== null;
    gpsWatch = null;
    await gpsRequest.catch(() => {});
    if (state.session && state.data?.user.role === "volunteer") {
      try {
        await api("/api/tracking/stop", {});
        if (showMessage || wasSharing)
          trackingMessage(
            "GPS sharing stopped. Your last shared fix was removed.",
          );
        queueLiveRefresh();
      } catch (e) {
        if (showMessage)
          trackingMessage(
            `Device watching stopped. Server could not clear the old fix; it expires within 10 minutes. ${e.message}`,
          );
      }
    }
  }
  async function startDemo(id) {
    if (!id) return trackingMessage("No available volunteer to simulate.");
    await stopDemo(false);
    demoId = id;
    let progress = 0;
    const send = async () => {
      if (!demoId || !state.session || demoInFlight) return;
      demoInFlight = true;
      try {
        demoRequest = api("/api/tracking/demo", { id, progress });
        await demoRequest;
        if (demoId !== id) return;
        trackingMessage(
          "DEMO movement running. This is not GPS or an actual delivery.",
        );
        queueLiveRefresh();
        progress = (progress + 0.025) % 1;
      } catch (e) {
        clearInterval(demoTimer);
        demoTimer = null;
        demoId = null;
        trackingMessage(e.message);
      } finally {
        demoInFlight = false;
      }
    };
    await send();
    if (demoId) demoTimer = setInterval(send, 1500);
  }
  async function stopDemo(showMessage = true) {
    clearInterval(demoTimer);
    demoTimer = null;
    const id = demoId;
    demoId = null;
    await demoRequest.catch(() => {});
    if (id && state.session) {
      try {
        await api("/api/tracking/stop", { id });
        queueLiveRefresh();
      } catch (e) {
        if (showMessage) return trackingMessage(e.message);
      }
    }
    if (showMessage) trackingMessage("Demo movement stopped.");
  }
  window.addEventListener("pagehide", () => {
    if (gpsWatch !== null && state.session)
      fetch("/api/tracking/stop", {
        method: "POST",
        keepalive: true,
        headers: {
          "Content-Type": "application/json",
          "X-CSRF-Token": state.session.csrf,
        },
        body: "{}",
      }).catch(() => {});
    stopLiveResources();
  });
  return { startLive, stopLiveResources, mountNetwork, stopGps, stopDemo };
};
