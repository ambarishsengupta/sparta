# Sparta Pilot: Privacy Contact Address

| Field | Value |
| --- | --- |
| Version | 0.2 (draft for the academic pilot) |
| Date | 2026-10-22 |
| Owner | Product owner (sets it up); all three team members read it |
| Status | **Chosen: `dunk-volts8c@icloud.com`, a mailbox shared by the three team members.** The remaining setup checks in section 5 are still to be ticked before the pilot opens. |
| Review status | Written by the project team with AI assistance; not reviewed by a lawyer |

## 1. What it is

The pilot's contact address is **dunk-volts8c@icloud.com**, a mailbox shared by C. Prashanth, Arpan Shah and Ambarish Sengupta.

The privacy contact address is the one email address that participants, vendors and anyone else can use to reach the team about privacy and the pilot. It is the only route the Privacy Policy, Terms of Use, Vendor Pilot Agreement and the in-app About page promise.

## 2. Why the pilot cannot open without it

1. **Participants are promised it.** The policy says questions, requests and complaints go to it and will be answered within 7 days (Privacy Policy section 2).
2. **It carries their rights.** Access, correction, export, deletion and complaints may all arrive there, even though the app handles most of them directly.
3. **It is the incident contact.** If something goes wrong, participants and vendors need somewhere to report it (Incident Response Plan).
4. **Vendors and catalogue sources use it.** Takedown requests from sources (Data Sourcing Policy section 7) and probing reports from vendors arrive there.
5. **People expect to find it.** The About page shows it (FR-67), and a notice with no way to reach a person would undercut the point of the notice.

## 3. What it must be

| Requirement | Why |
| --- | --- |
| **Dedicated to the pilot**, not anyone's personal address | Keeps personal inboxes out of user data requests; stays valid if someone leaves |
| **Read by all three team members** | No single point of failure; requests are answered within 7 days even if one person is away |
| **Not a no-reply address** | People must be able to write back |
| **Under the team's control for the whole pilot and for at least 6 months after** | Deletion requests and complaints can arrive after the pilot closes |
| **Never used for marketing** | Keeps it clearly separate from the app's transactional email |
| **Plain and recognisable** | For example `privacy@` something, so a participant knows what it is |

## 4. Options

| Option | How | Cost | Pros | Cons |
| --- | --- | --- | --- | --- |
| **A. A new free shared mailbox** (recommended for the pilot) | Create a dedicated account such as `sparta.pilot.privacy@` on a free provider, and add all three members as users of it (or enable forwarding to each person's inbox) | Free | Quick; fully under the team's control; no domain needed | Looks informal; depends on the free provider; shared passwords need care |
| **B. A university or institute address or alias** | Ask faculty or the IT office for a project mailbox or a mailing-list alias | Free | Looks official; supports the academic framing; faculty may help with ethics questions too | Needs approval; may disappear after the course; may route your data through the university's systems |
| **C. An address on your own domain** | Buy a domain (about $10 to $15 a year) and use a free forwarding service to send `privacy@yourdomain` to all three inboxes | A small yearly fee | Looks most professional; the address survives changing providers; lets you use the same domain later | Costs money; needs setup and renewal; forwarding means a reply comes from a personal address unless set up carefully |

**Recommendation:** use **option B if faculty will provide it within a few days, otherwise option A**. Move to option C only when the project goes beyond the pilot. If the address changes, publish the new one and keep the old one forwarding for at least 6 months.

**Decision:** the team chose `dunk-volts8c@icloud.com`, a shared mailbox closest to option A (section 8). The options above are kept as the record of that choice.

## 5. Setup checklist

- [x] Choose the address and option. Done: `dunk-volts8c@icloud.com`, a shared mailbox closest to option A (section 8).
- [ ] Give all three members access; turn on two-step sign-in; store the recovery details somewhere two members can reach.
- [ ] Send a test message from outside the team and confirm that all three can see and reply to it.
- [ ] Set an out-of-office text for periods when no one is available, naming the 7-day reply target.
- [ ] Set the value in the environment variable `CONTACT_EMAIL` (production and preview projects); the About page and transactional emails read it (LLD section 12.3).
- [ ] Make sure the address appears in: the About page (FR-67), the vendor portal Account page (FR-95), the footer or settings of the app, the Privacy Policy, the Terms of Use, the Vendor Pilot Agreement, the first-login notice (Privacy Policy section 13, "Questions: dunk-volts8c@icloud.com") and the invitation email.
- [ ] Add a short written rule for handling messages (section 6).
- [ ] Confirm the address works before sending any invitation.

The Privacy Policy (sections 2 and 13), Terms of Use (section 13), Vendor Pilot Agreement (section 14) and Incident Response Plan (section 4) state the address itself. If it ever changes, update those four documents, `CONTACT_EMAIL` and the invitation email together, then publish the new address and keep the old one forwarding for at least 6 months (section 4).

## 6. How to handle messages

| Message | Do this | Within |
| --- | --- | --- |
| Question about the pilot | Answer plainly | 7 days |
| Request to see, correct or export data | Point to Settings and the export button; if the person cannot find or use the export button, run the export for them after checking they are the account owner; they download it from the export page after signing in (reply to the account's own email) | 7 days |
| Request to delete data or leave | Point to **Leave the pilot**, or delete the account for them after the same check | 7 days (deletion completes within 7 days; backups within 30) |
| Complaint | Acknowledge within 2 days, investigate, reply with the outcome; tell faculty if it is serious | 7 days |
| Report of a possible breach or a vendor probing | Follow the Incident Response Plan straight away | Same day |
| Takedown request from a catalogue source | Follow the Data Sourcing Policy section 7 | 2 working days |
| Request from a regulator or authority | Do not reply alone; involve the product owner and faculty | As soon as received |

**Check who is asking.** Reply only to the email address on the account, or ask for a message sent from it. Never send personal data to someone who has not shown that they are the account owner.

**Keep a simple log** (date, type, action, date closed), without personal data beyond a reference. Do not keep the log in the public repository.

## 7. Where it is used

| Where | Item |
| --- | --- |
| FDD FR-67 | About the pilot page |
| FDD FR-95 | Vendor portal Account page |
| LLD section 12.3 | `CONTACT_EMAIL` configuration |
| Privacy Policy sections 2, 8, 13 | Who we are; your rights; first-login notice |
| Terms of Use sections 12, 13 | Disputes; contact |
| Vendor Pilot Agreement sections 12, 14 | Notice of ending; contact |
| Incident Response Plan | Reporting route |
| Data Sourcing Policy section 7 | Takedown requests |
| Invitation and transactional emails | Footer or reply-to |

## 8. Decisions and remaining actions

| Item | Status | Owner |
| --- | --- | --- |
| Address chosen | Done: `dunk-volts8c@icloud.com` (shared mailbox, closest to option A) | Product owner |
| Set `CONTACT_EMAIL` to this address in the Vercel production and preview projects | To do before the pilot opens | Technical lead |
| Tick the setup checklist in section 5 (all three can read and reply, a test from outside works, the out-of-office text is set, recovery details held by two members) | To do before the pilot opens | All three |
| Check that the address is truly shared | Done: the product owner confirmed that all three team members can use it | Product owner |
| Decide who answers on which days, so the 7-day target holds | To do | All three |

## 9. Notes on this address

- **It is public.** The address appears in the Privacy Policy, Terms of Use and Vendor Pilot Agreement, which are in a public repository, and on the About page. Expect some spam. A rule or filter that keeps real requests visible, and a check of the junk folder every few days, will help; the 7-day target still applies.
- **It is truly shared.** The product owner has confirmed that all three team members can read and reply from this address. If that changes (for example someone loses access, or the address becomes a forward to one person), the 7-day answer rule is at risk: move to a mailbox all three can open, or agree who replies from where.
- **Keep it for the long run.** The address must stay under the team's control for at least 6 months after the pilot (section 3). If it changes, publish the new one and keep the old one forwarding.
