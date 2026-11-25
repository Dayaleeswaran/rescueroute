import { readFileSync } from "node:fs";

const readCss = (path) =>
  readFileSync(new URL(path, import.meta.url), "utf8");
const networkCss = readCss("../public/network-map.css");
const motionCss = readCss("../public/motion.css");
const stylesCss = readCss("../public/styles.css");

const rule = (css, selector) => {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return css.match(new RegExp(`${escaped}\\s*\\{([^}]+)\\}`))?.[1] || "";
};
const property = (css, selector, name) =>
  rule(css, selector)
    .match(new RegExp(`(?:^|;)\\s*${name}:\\s*([^;]+)`))?.[1]
    .trim();
const cssVar = (name) => {
  const raw = rule(stylesCss, ":root")
    .match(new RegExp(`${name}:\\s*([^;]+)`))?.[1]
    ?.trim();
  if (!raw) throw Error(`Missing CSS variable ${name}.`);
  return raw === "#fff" ? "#ffffff" : raw;
};
const luminance = (hex) => {
  if (hex === "white") hex = "#ffffff";
  if (!/^#[a-f\d]{6}$/i.test(hex))
    throw Error(`A colour cannot be measured as an opaque RGB value: ${hex}`);
  const channels = [1, 3, 5]
    .map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((n) => (n <= 0.04045 ? n / 12.92 : ((n + 0.055) / 1.055) ** 2.4));
  return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
};
const contrastCheck = (name, foreground, background, minRatio = 4.5) => {
  const [a, b] = [luminance(foreground), luminance(background)].sort(
    (x, y) => y - x,
  );
  const ratio = (a + 0.05) / (b + 0.05);
  return {
    name,
    foreground,
    background,
    ratio: +ratio.toFixed(2),
    minRatio,
    meetsAA: ratio >= minRatio,
  };
};

const foreground = property(networkCss, ".network-pin", "color");
const checks = [
  ...["donor", "recipient", "volunteer"].map((role) =>
    contrastCheck(
      `network-pin.${role}`,
      foreground,
      property(networkCss, `.network-pin.${role}`, "background"),
    ),
  ),
  contrastCheck("body-ink-on-bg", cssVar("--ink"), cssVar("--bg")),
  contrastCheck("body-ink-on-paper", cssVar("--ink"), cssVar("--paper")),
  contrastCheck("muted-on-paper", cssVar("--muted"), cssVar("--paper")),
  contrastCheck("lime-on-green", cssVar("--lime"), cssVar("--green")),
  contrastCheck(
    "brand-intro-title",
    property(motionCss, "#brand-intro", "color"),
    property(motionCss, "#brand-intro::backdrop", "background"),
  ),
  contrastCheck(
    "brand-intro-subtitle",
    property(motionCss, ".intro-copy p", "color"),
    property(motionCss, "#brand-intro::backdrop", "background"),
  ),
  contrastCheck(
    "motion-control",
    property(motionCss, ".motion-control", "color"),
    property(motionCss, ".motion-control", "background"),
  ),
  contrastCheck(
    "intro-card-club-icon",
    property(motionCss, ".intro-card-club", "color"),
    property(motionCss, ".intro-card-club", "background"),
    3.0,
  ),
  contrastCheck(
    "intro-card-back-icon",
    property(motionCss, ".intro-card-back", "color"),
    property(motionCss, ".intro-card-back", "background"),
    3.0,
  ),
];

console.log(
  JSON.stringify(
    {
      checks,
      scope:
        "Twelve opaque CSS foreground/background pairs across map markers, core theme tokens, and intro/motion controls using WCAG relative luminance (4.5:1 text, 3.0:1 non-text graphics).",
    },
    null,
    2,
  ),
);
if (checks.some((row) => !row.meetsAA)) process.exitCode = 1;
