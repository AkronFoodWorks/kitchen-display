# Kitchen display — Supabase setup

The TV page (`web/display.html`) gets the schedule from a small Supabase
Edge Function, because Food Corridor's schedule can't be read directly
from a browser on another site. This lives in the **same Supabase project
as afw-tools cloud save** and doesn't touch member data.

## One-time setup (about 10 minutes)

1. **Create the cache table.**
   Supabase Dashboard → SQL Editor → New query → paste
   `supabase/kitchen-schedule.sql` → Run.

2. **Create the function.**
   Dashboard → Edge Functions → *Deploy a new function* → *Via Editor*.
   - Name it exactly `kitchen-schedule`.
   - Replace the sample code with `supabase/functions/kitchen-schedule/index.ts`.
   - Deploy.

   (Or, with the Supabase CLI:
   `supabase functions deploy kitchen-schedule --no-verify-jwt`.)

3. **Turn off JWT verification for this function.**
   Edge Functions → kitchen-schedule → Details (or Settings) →
   *Enforce JWT verification* → **off** → Save.
   The TV calls the function without signing in. The function can only
   return the kitchen schedule.

4. **Check it.** Open this in a browser:
   `https://pyavgjemukfiiruawdgg.supabase.co/functions/v1/kitchen-schedule`
   You should see JSON starting with `{"fetched_at":"…","stale":false,"bookings":[…`.
   In Table Editor, `kitchen_schedule_cache` should now have one row.

## How it behaves

- The TV asks for new data every 3 minutes. The function contacts Food
  Corridor at most once a minute, however many TVs are on.
- Every refresh writes to the database, which keeps the free Supabase
  project from pausing for inactivity. That benefits afw-tools too.
- If Food Corridor is down, the function returns the last saved copy.
  After 15 minutes without fresh data, the TV header changes to
  "Last update 3:42 PM · reconnecting" in amber.
- If the TV reboots, it shows its own last saved copy straight away while
  it reconnects.

## Display URL options

| Add to the URL | Effect |
| --- | --- |
| *(nothing)* | Layout follows the screen's shape. The timeline always shows the last 4 hours and the next 12. Light theme 6am–10pm, dark theme 10pm–6am |
| `?layout=portrait` or `?layout=landscape` | Force a layout |
| `?view=day` or `?view=overnight` | Force the light or dark theme |
| `?demo` | Sample bookings, for previewing the design |
| `?now=2026-11-18T21:15` | Pretend it's that time in Akron (for previews) |

Combine options with `&`, e.g. `?demo&layout=portrait&now=2026-11-18T14:20`.
