# TerpTalk Beta Test Plan

## How testers join

1. Admin generates an invite code on `/admin` (or codes printed by `npm run seed`)
2. Tester visits `/auth/signup`, enters the code, chooses username + password, completes the math captcha, confirms 21+
3. Tester is auto-logged-in and lands on `/profile/complete`

## Tester instructions

Please explore naturally. Try to break things. Report anything odd via the in-app Report button or to the admin.

### Journeys to exercise

**New user**
- Register → age confirm → captcha → login → complete profile → browse `/forum` → open a category → open a thread → create a thread → reply → like a post → edit your post → delete your post → open another user's profile via their username → block them → unblock them → report a post → check `/notifications` → logout → login again

**Returning user**
- Login → check unread notification badge → browse feed → reply to threads → update your diary → logout

**Moderator**
- Login → `/moderation` → review a report → view reported content → remove content OR resolve/dismiss → check the moderation log

**Admin**
- Login → `/admin` → review stats → generate invites → ban a test account → unban

## What to report

- Any error page or blank screen
- Anything that looks clickable but does nothing
- Wrong counts (replies, likes, members)
- Content you can see but shouldn't (someone's private data)
- Actions that succeed when they shouldn't
- Broken mobile layout

## Edge cases to try

- Register with a used/invalid invite code → should fail
- Post under 10 characters → should fail
- Paste `<script>alert(1)</script>` into a post → should display as text, not execute
- Try editing another user's post → no edit button; API call returns 403
- Reply to a locked thread → rejected
- Spam replies rapidly → rate limit after ~30 in 10 min
- Report the same post twice → second report rejected
- Visit the profile of a user who blocked you → 404

## Expected known issues (not bugs)

- Chat refreshes every ~3 seconds (polling, not realtime)
- No password reset — locked out? Contact admin
- No image uploads — diaries and setups are text-only
- No DM feature
- Feed "Trending" and "Following" tabs are marked "Soon"
