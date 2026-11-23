# WASL Phase 2a (notifications) — deferred follow-ups

- Task 1: minor (deferred): no warning for malformed VAPID_SUBJECT; push stage failure after inbox insert loses created count and blocks retry; users processed sequentially; test gaps (emit, sender throw, timeout, WebPushSender mapping, malformed VAPID)
- Task 2: minor (deferred): inbox pagination by createdAt can skip equal timestamps; list href not restricted to relative paths; no route-level tests for logout deletion / push / inbox routes
- Task 2: minor (deferred): bell may over-count by 1 (seen only tracks live ids); href check allows '/\evil.com'; duplicate subscribe POST per page load; optimistic single read ignores POST failure
- Task 3: minor (deferred): DELIVERED/CANCELLED always include requester even if unlinked (guarded in practice); push sends awaited inline before emitPickupChanged; revocation test asserts >=1 not exact
- Task 3: minor (deferred): import test uses same phone list for both rows (doesn't isolate earlier-sibling-only guardian); applyImport pushes revoked batch before commit (spurious notice on rare commit failure)
- Task 4: minor (deferred): sibling dedupe gap (A cancelled after reminder named only B) — end-of-day still covers A; needs a code comment; ticker loads all students each tick; tests miss unregistered-phone case and 12:14/12:44 boundaries
- Task 5: minor (deferred): 70 s e2e timeout long; bell test doesn't isolate socket path; loose READY regex in inbox check
- Final re-review: subscription cap may evict a just-reassigned endpoint (update branch doesn't refresh createdAt); changePassword subscription delete not in same transaction; resetStaffPassword/setUserActive(false) don't delete PushSubscriptions; pending background notifications lost on process exit.
