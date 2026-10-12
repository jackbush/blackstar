---
name: blackstar-state
description: Apply a pasted Blackstar state blob to the code. Use whenever the user pastes JSON containing "blackstar": "blackstar/state@1" (copied from the sidebar's "Copy changes" button), or asks to bake/apply/save their tweaked sidebar values into the Blackstar animation's defaults.
---

# Applying a Blackstar state blob

The sidebar's **Copy changes** button produces this:

```json
{
  "blackstar": "blackstar/state@1",
  "changed": {
    "orbRadius": { "from": 0.19, "to": 0.24 },
    "haloOuter": { "from": "#d2260c", "to": "#aa1100" }
  }
}
```

- `changed` holds every param that differs from the code defaults at the moment of copying. `from` is the code default the user's page was running. `to` is what they want.
- The user's intent, if any, is in the chat message around the blob. (Older blobs may have a `notes` field; treat it the same way.)
- Older blobs may have an `all` block (every value). It's context only. Never write values from it unless they also appear in `changed` or the user asks.

All defaults live in `params.js` (`window.BLACKSTAR_PARAMS`, groups → params). Each param has a unique `key`. The blob's keys are those keys.

## Procedure

1. **Read `params.js`** in full. Don't rely on memory, because the defaults may have moved since the last session.
2. **Reconcile each entry in `changed`:**
   - **Key exists, `from` equals the current default:** set `value` to `to`.
   - **Key exists, `from` differs from the current default:** the code changed after the user copied. Still apply `to`, since that's what they saw and liked, but list it in your reply as "default had moved: X → (now) Y → applied Z".
   - **`to` is outside `min`/`max`:** the user typed past the slider range in the number box. Apply it and widen `min`/`max` so the slider covers it with some headroom (round to a clean number). Mention that you widened it.
   - **Key doesn't exist:** the param was renamed or removed. Check `git log -p -S'<key>' -- params.js` for a rename. If one is obvious, apply the value to the new key and say so; otherwise report the key as skipped.
   - **Formats:** colors are lowercase `#rrggbb`. Numbers keep the param's `step` precision, so never write `0.30000000000000004`. Bools are `true`/`false`.
3. **Change nothing else in `params.js`.** Keep each param's position, label, desc and formatting, and edit only the `value:` field (plus `min`/`max` when widening).
4. **Act on the accompanying message (or `notes`).** Phrases like "a bit hotter" or "slower" usually map to existing params, so adjust them and say which ones and by how much. If it asks for a new visual element, behaviour, or a removal, follow the `blackstar-elements` skill. If it's ambiguous, apply the numeric changes first and then ask about it. Don't stall the whole update on it.
5. **Verify:** run `node scripts/check.js`. It must report 0 errors.
6. **Reply briefly** with:
   - a compact table of what changed: key · old default → new default
   - anything reconciled (moved defaults, widened ranges, skipped keys)
   - what you did about the accompanying message

## After applying

The page stores the user's slider overrides in localStorage, signed with a hash of all code defaults. Changing any default invalidates the signature, so on reload the page starts clean on the new defaults. The user doesn't need to press Reset. Tell them to reload.

## Don'ts

- Don't edit `shader.js` or `app.js` for a pure value update.
- Don't "tidy" or round other params while you're in the file.
- Don't treat values in `from` as targets. They only detect drift.
