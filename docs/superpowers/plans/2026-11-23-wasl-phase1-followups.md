# WASL Phase 1 — deferred follow-ups

Minor findings from task and final reviews that were deferred (not blocking Phase 1). Triage before a pilot.

- Task 2: minor (deferred): changePassword doesn't revoke other sessions
- Task 2: minor (deferred): no password max length (argon2 DoS)
- Task 2: minor (deferred): issueOtp send-limit count-then-create not atomic; counts across purposes
- Task 2: minor (deferred): mustChangePassword not enforced on API routes or /parent (T10 adds /parent guard)
- Task 2: minor (deferred): readJson any + String() coercion; no per-IP bound on register/reset
- Task 2: minor (deferred): login limit count+insert not atomic; LoginAttempt never pruned (Phase 2 retention job); no per-IP throttle -> victim lockout possible
- Task 3: minor (deferred): STAFF shortcut trusts user.branchId/schoolId consistency
- Task 3: minor (deferred): /api/admin/schools route not tested with non-admin; rollback audit not asserted; createPlatformAdmin race (CLI only)
- Task 4: minor (deferred): cross-tenant tests only for create/delete, not update paths
- Task 4: minor (deferred): deleting a gate leaves staff gateIds / PickupRequest.gateId dangling
- Task 4: minor (deferred): duplicate holidays/overrides allowed
- Task 6: minor (deferred): no tests for malformed override, override-on-holiday (holiday wins), midnight boundary
- Task 5: minor (deferred): LINK_PHONE Conflict before OTP enables phone enumeration (brief-mandated); listStudents unused includeInactive + take 1000; per-row exceptions swallowed without logging; audit not atomic with rows
- Task 5: minor (deferred): blank rows now count toward MAX_IMPORT_ROWS
- Task 7: minor (deferred): code compare not constant-time (impractical to exploit); requestId path NotFound vs ValidationError leaks cross-branch existence; verify rate-limit not atomic, VerifyAttempt never pruned; last numbering retry P2002 escapes as 500 / meta.target fragility; grade-string ordering wrong for Arabic word grades (default gate only); test gaps: same-school other-branch, cross-branch verify/deliver/cancel, ambiguity branch
- Task 7: minor (deferred): deliver+cancel race test can't fail without lock; stale loop doesn't re-check locked.open (duplicate audit); auto-close doesn't emitPickupChanged
- Task 8: minor (deferred): double read loadOwnRequest+lockRequest; `void a;` noise in pickup.test.ts:568; no route-level tests
- Task 9: minor (deferred): admin join-branch rooms accumulate, no rate limit; useJoinBranch double-join; emit ordering stale-after-fresh; board token in query string; test gaps (non-string join payload, PLATFORM_ADMIN, emit failure)
- Task 10: minor (deferred): CodeCard in-flight load reschedules polling after unmount (setState after unmount, 5s retry loop); "location active" indicator shown when geolocation API missing; ChildCard disabled prop unused
- Fix R6: minor (deferred): smoke uses setsid (not on macOS); bare `node dist/server.js` without NODE_ENV starts dev mode (Docker/npm start set production)
- Task 11: minor (deferred): QrScanner done-latch not reset after failed scan; RequestCard.run doesn't refetch on success; N+1 loadRequestForViews; rank sort duplicated staff.ts/page.tsx; no route tests for verify/deliver/gate; no gate-change UI
- Task 11: minor (deferred): verified state not cleared when request moves out of staff gates
- Task 12: minor (deferred): no test for avg with null readyAt or Riyadh-midnight boundary; redundant branch query; pre-existing audit rows lack branchId; double first load; cancel reason shown in feed
- Task 12: minor (deferred): platform-admin test covers only own-school branch
- Task 13: minor (deferred): highlight side effect inside setState updater; wake lock re-request on visibilitychange without checking held sentinel; no rate limit on board token lookups (144-bit token); no connection-lost indicator
- Task 14: minor (deferred): seed --force in production creates known credentials with mustChangePassword=false; seed not transactional (half-seed then "nothing to do"); loose tile locator; OTP .first() ordering; README SUPERUSER role needs dev-only note
- Final re-review: closeStaleRequests aborts the rest of a sweep on one failure (self-heals next run); students page beyond last page shows empty table; verify/deliver don't check requester.active (no path deactivates guardians yet); PREPARE/READY still allowed on revoked items until verify/deliver blocks handover; mustChangePassword not enforced on sockets (read-only).
