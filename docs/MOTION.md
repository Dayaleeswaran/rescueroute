# Interface motion

RescueRoute uses finite entry effects and small interactions, without an animation package or a blocking splash/loading screen. Forms and navigation remain usable throughout.

## What users see

- The sign-in page introduces a small SVG route linking donor, volunteer, and community. Its lines draw in, nodes arrive, and the wordmark/story/card reveal in sequence. The illustration is decorative and excluded from screen-reader output.
- The workspace sidebar and header enter once. Intentional page navigation reveals headings, hero content, metrics, and workflow cards in a short stagger.
- Buttons press and lift, selected navigation gains a subtle inset indicator, and dialogs/toasts enter briefly. Hover movement is restricted to fine pointers; touch devices retain ordinary controls.
- Live updates and manual refreshes do not replay the current page's entrance. No metric counter or fake loading sequence changes operational figures.

Entry drawing lasts at most about 1.5 seconds. Panel entrances use 440 ms animations with up to 330 ms of stagger. Dialog/toast feedback lasts 180?220 ms. There are no looping animations, scroll observers, or animation timers. The SVG drawing uses a small stroke animation; panel motion uses opacity and transforms.

## Motion preferences

The **Motion** control appears on sign-in and in the workspace header. It toggles decorative movement and stores only the boolean preference `rescueroute.reduce-motion` in browser storage. If storage is unavailable, the choice still applies for the current page.

Device `prefers-reduced-motion: reduce` always takes priority. CSS effects are disabled, active Web Animations are cancelled, and the control explains that the device preference is in effect. Changes to the device preference apply immediately. Keyboard or pointer interaction also settles active panel entrances without intercepting the user's action.

If Web Animations are unsupported, the interface keeps working without those entrances. Baseline content is visible; no JavaScript-controlled opacity or splash overlay must finish before a user can act.

## Verification boundary

Motion tests cover initial and changed reduced-motion settings, cancellation, synchronised controls, preference storage, continued form usability, and the unsupported-API fallback. A DOM integration check verifies that refreshing a view does not replay its entrance. Existing semantic accessibility checks include the motion controls.

The route artwork was rendered and inspected independently. No connected browser was available to review actual animation playback, native dialog focus, mobile layouts, or screen-reader behaviour. DOM tests and the static illustration render do not establish those results.
