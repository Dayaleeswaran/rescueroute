import { readFileSync } from "node:fs";

const css = readFileSync(
  new URL("../public/network-map.css", import.meta.url),
  "utf8",
);
const rule = (selector) => {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return css.match(new RegExp(`${escaped}\\s*\\{([^}]+)\\}`))?.[1] || "";
};
const property = (selector, name) =>
  rule(selector)
    .match(new RegExp(`(?:^|;)\\s*${name}:\\s*([^;]+)`))?.[1]
    .trim();
const luminance = (hex) => {
  if (hex === "white") hex = "#ffffff";
  if (!/^#[a-f\d]{6}$/i.test(hex))
    throw Error("A marker colour cannot be measured as an opaque RGB value.");
  const channels = [1, 3, 5]
    .map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((n) => (n <= 0.04045 ? n / 12.92 : ((n + 0.055) / 1.055) ** 2.4));
  return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
};
const foreground = property(".network-pin", "color");
const checks = ["donor", "recipient", "volunteer"].map((role) => {
  const background = property(`.network-pin.${role}`, "background");
  const [a, b] = [luminance(foreground), luminance(background)].sort(
    (a, b) => b - a,
  );
  const ratio = (a + 0.05) / (b + 0.05);
  return {
    role,
    foreground,
    background,
    ratio: +ratio.toFixed(2),
    meetsNormalTextAA: ratio >= 4.5,
  };
});
console.log(
  JSON.stringify(
    {
      checks,
      scope:
        "Three opaque CSS map-marker foreground/background pairs using WCAG relative luminance. Not a rendered-page contrast audit or WCAG conformance claim.",
    },
    null,
    2,
  ),
);
if (checks.some((row) => !row.meetsNormalTextAA)) process.exitCode = 1;
