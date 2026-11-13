# VeriSeal Notarization Platform Security Specification

## 1. Data Invariants
1. **Profile Ownership & PII Isolation**: A `userProfiles/{userId}` document may only be read or written by the authenticated user whose `request.auth.uid == userId` (or an admin). List queries on `userProfiles` are denied.
2. **Notarization Case Ownership & State Machine**: A `notarizations/{caseId}` document must always belong to `ownerId == request.auth.uid`, must be created with `status == 'draft'`, and must transition monotonically (`draft` -> `identity_verified` -> `signed` -> `notarized`). Once `status == 'notarized'`, the document is terminally locked against further updates or deletion by non-admins.
3. **Atomic Statutory Journal & Public Verification**: A `journalEntries/{entryId}` or `verifications/{certificateCode}` record can only be created atomically alongside a notarization transition to `status == 'notarized'` (`getAfter(...).data.status == 'notarized'`). Both are immutable once written.
4. **Public Verification Anti-Scraping & PII Exclusion**: `verifications/{certificateCode}` supports single-document `get` lookups by exact certificate code without exposing signer email or personal ID data. `list` queries on `verifications` are restricted to `ownerId == request.auth.uid`.
5. **Server Temporal Integrity**: All `createdAt`, `updatedAt`, `recordedAt`, and `notarizedAt` timestamps must equal `request.time`.

## 2. Adversarial Payloads ("Dirty Dozen")
1. **Identity Spoofing on Create**: Creating `/notarizations/case_1` with `ownerId: "victim_uid"` while signed in as `"attacker_uid"` -> `PERMISSION_DENIED`.
2. **State Shortcutting on Create**: Creating `/notarizations/case_2` with `status: "notarized"` directly -> `PERMISSION_DENIED`.
3. **Shadow Field Injection**: Updating `/notarizations/case_1` with extra key `isApprovedByCourt: true` -> `PERMISSION_DENIED` (`hasOnly` rejects).
4. **Terminal State Mutation**: Updating `/notarizations/case_1` after `status == "notarized"` to alter `documentText` or `sealedHash` -> `PERMISSION_DENIED`.
5. **Terminal Record Deletion**: Deleting `/notarizations/case_1` when `status == "notarized"` -> `PERMISSION_DENIED`.
6. **Orphaned Journal Entry**: Creating `/journalEntries/j_1` pointing to a non-existent or un-notarized `caseId` -> `PERMISSION_DENIED`.
7. **Journal Tampering**: Updating or deleting `/journalEntries/j_1` as the owner -> `PERMISSION_DENIED`.
8. **Blanket List Scraping on Verifications**: Running `list` on `/verifications` without `where("ownerId", "==", uid)` -> `PERMISSION_DENIED`.
9. **Resource Poisoning via Oversized ID**: Creating `/notarizations/<200-char-id>` or invalid characters -> `PERMISSION_DENIED`.
10. **Payload Size Exhaustion**: Writing `documentText` > 40,000 characters or `title` > 140 characters -> `PERMISSION_DENIED`.
11. **Backdated Timestamp Forgery**: Creating a journal entry with a client-supplied past `recordedAt` timestamp != `request.time` -> `PERMISSION_DENIED`.
12. **Cross-User Profile Read**: Reading `/userProfiles/other_uid` while signed in as `"attacker_uid"` -> `PERMISSION_DENIED`.
