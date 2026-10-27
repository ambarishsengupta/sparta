# Sparta Pilot: Incident Response Plan

| Field | Value |
| --- | --- |
| Version | 0.2 (draft for the academic pilot) |
| Date | 2026-10-22 |
| Owner | C. Prashanth (technical lead for incidents) |
| Decision on telling users | Ambarish Sengupta (product owner), with the technical lead |
| Review status | Written by the project team with AI assistance. Not reviewed by a lawyer. |

## 1. Purpose

This plan says what the team does when something goes wrong with user data or the service: who decides, how fast, who is told, and what is recorded. It is short on purpose so that it is read and used.

## 2. What counts as an incident

| Type | Examples |
| --- | --- |
| **Data exposure** | One user can see another's data; a vendor can see anything beyond group figures; a database, storage or backup is accessible to the wrong person; a log contains personal data |
| **Credential or key leak** | The Supabase secret key, the worker's shared secret (`WORKER_SHARED_SECRET`) or a database password (including the `worker_role` and `backup_role` passwords) appears in the repository, a log or a message; an admin or vendor account is taken over |
| **Lost or stolen device** | The machine that runs the worker, or a laptop holding a backup or key, is lost, stolen or compromised |
| **Attack on privacy rules** | A vendor appears to be probing the dashboard to single out a participant |
| **Availability** | Outage or data loss: the database or storage is deleted, corrupted or unreachable |
| **Wrongful processing** | Data is used for something the notice does not allow, or a deletion request is not carried out |

If you are not sure, treat it as an incident.

## 3. Severity

| Level | Meaning | Examples | Target response |
| --- | --- | --- | --- |
| **1 Critical** | Personal data was or may have been seen by people who should not have it, or a key with broad power has leaked | Policy flaw exposing other users' rows; leaked Supabase secret key | Contain within **2 hours** of finding |
| **2 High** | Likely harm if left alone, but not yet confirmed exposure | Vendor probing; lost machine with encrypted disk | Contain within **24 hours** |
| **3 Moderate** | Service problem with no data exposure | Worker offline; backup failed | Fix within **3 days** |

## 4. Steps

1. **Detect and report.** Anyone who sees a problem tells the other two team members at once (group chat plus a direct call for level 1). A report from a participant, vendor or anyone else that arrives at the contact address (dunk-volts8c@icloud.com) starts the same process. Write down the time and what was seen.
2. **Contain.** The technical lead acts first and fastest:
   - leaked key: rotate it (Supabase, Vercel, GitHub, worker), redeploy, and invalidate sessions;
   - exposure through a policy or function: close it in the database, not only in the web app, because the browser talks to Supabase directly and a maintenance page on Vercel does not stop it. In the Supabase SQL editor, set the faulty policy to deny all (`alter policy ... using (false)`, adding `with check (false)` where the policy allows writes) or revoke the table's grants from `authenticated`; for a vendor function, revoke its `execute` grant from `authenticated`. Also disable any affected server route on Vercel. Maintenance mode (LLD 9.1) can be switched on as well, but it does not cover every table, so it never replaces closing the faulty policy. Record the emergency change and replace it with a reviewed migration;
   - lost machine: rotate the worker's shared secret (`WORKER_SHARED_SECRET`) and the `worker_role` and `backup_role` database passwords, remove its access, and mark its backups as compromised;
   - vendor probing: suspend the vendor account.
3. **Assess.** Within 24 hours decide: what data, whose, how many people, for how long, whether it was actually accessed, and whether it can be used to harm someone. Check logs, the vendor query log and the aggregate audit rows.
4. **Decide on notice.** The product owner and technical lead decide together. As a rule:
   - **tell affected participants** whenever their personal data was or may have been exposed to someone who should not have it, and always for level 1;
   - **tell the vendor or provider** where relevant;
   - **tell faculty** about any level 1 incident;
   - **tell the data protection authority** if the law that applies to the affected participants requires it. For participants in India the Digital Personal Data Protection Act, 2023 requires breach reporting once its rules apply (expected from about May 2027); for participants in the EU or UK the regulator must normally be told within 72 hours of becoming aware. Seek advice from the university's legal or ethics office at that point.
5. **Fix and recover.** Fix the cause. Restore from backup if needed, following LLD 13.3, which deletes again any account deleted since the backup (a rehearsed restore is part of launch readiness). Re-run the policy tests and add one that would have caught the problem.
6. **Review.** Within 7 days write a short review: what happened, the cause, what worked, what changes. Update the risk assessment and this plan if needed.

## 5. Record

Keep an incident log in a private place (not the public repository): date and time found, who found it, severity, what happened, data and people affected, actions and times, notices sent, and the review. Never put personal data in the log.

## 6. Message to affected participants (outline)

> **Subject: A security issue affecting your Sparta pilot account**
>
> What happened, in plain words, and when it was found.
> What information of yours was involved, and what was not.
> What we have done to stop it and to prevent a repeat.
> What you can do (for example change your password; nothing else is needed if no credentials were involved).
> How to reach us, and how to delete your account if you wish to leave.
> We are sorry. This is a student pilot, and we take your trust seriously.

## 7. Scenarios and first actions

| Scenario | First action |
| --- | --- |
| Test shows a user can read another user's items | Close access in the database at once: set the faulty policy to deny all or revoke the table's grants from `authenticated` (a web maintenance page alone is not enough); fix the policy in a migration with a new pgTAP test; run the full policy test suite before restoring access; assess whether any real user did it using the logs |
| Supabase secret key found in a commit | Rotate at once (create a new secret key, update it in Vercel, redeploy, then delete the leaked key); remove the commit from history if feasible (assume it was copied); check storage and database logs for use of the key |
| Worker machine stolen | Rotate the `worker_role` and `backup_role` database passwords and the shared secret (`WORKER_SHARED_SECRET`); mark the backups on it as compromised (they stay encrypted, as the private key is not on the machine); assume temporary files and logs are at risk; the disk is encrypted, so check that encryption was on; tell affected participants if any processing was in progress |
| Backup key lost | Create a new key, take a new backup, and delete the old backups; if the old backups may be in the wrong hands, treat as level 2 |
| Vendor runs many near-identical queries | Suspend the account; review what the queries could reveal; tighten limits |
| Deletion request not carried out in 7 days | Complete it now; find the cause; tell the participant |

## 8. Preparation

- Keep this plan and the contact details of all three team members where each can reach them without the main systems.
- Keep access to Supabase, GitHub and the worker host for at least two team members.
- Vercel Hobby allows only one member, so one team member holds the Vercel project. Never share that login. As cover, keep a private record (outside the repository, with no secret values) of the Vercel project settings: the Mumbai (`bom1`) function region, the domain and the names of the environment variables. If the holder cannot be reached, another member contains a leaked key by rotating it at its source (Supabase, GitHub or the worker host) and, if needed, redeploys the public repository from their own Vercel account using that record.
- Test the plan once before the pilot opens with a practice scenario (a leaked key).
