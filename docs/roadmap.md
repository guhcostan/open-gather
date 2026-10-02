# Roadmap

What is planned, in rough order, and what each item has to prove before it counts as done. What already works and what was measured is in [Status](status.md); this page is the work that remains. Items are plans, not promises, and none of them is implemented unless it says so.

Every item goes through [the gauntlet](gauntlet.md): written acceptance criteria, a failing check first, the whole suite green, and independent review.

## Order of work

Decided on 2026-10-02, to serve the [business model](business-model.md)'s target of three paying customers by early April 2027:

1. **Breakout rooms**: an admin API and a script first, then a panel in the administration dialog.
2. **Audio-only areas** set by administrators.
3. **Hosting foundation**: provisioning, backups with a tested restore, measuring the Team and Business machines, billing through Paddle, and the legal documents (see [Needed before offering hosted plans](#needed-before-offering-hosted-plans)).
4. **Stage**, after the first paying customer.
5. **Lounge**, after the first paying customer.

## Requested by people trying it (October 2026)

### Breakout rooms for group dynamics

**Today:** meeting rooms with access rules and their own calls, private offices, and server-side teleports (portals, walk-to). Nothing assigns people to rooms.

**Plan:** an administrator chooses how many of the map's meeting rooms to use, then presses *Shuffle*. The server assigns everyone present at random, moves them into their room and starts a countdown everyone sees. *Bring everyone back* returns people to where they were, or to a gathering spot.

- Rooms are the meeting rooms already on the map; no temporary areas are created. Asking for more rooms than the map has is refused with a clear error.
- The number of rooms decides: everyone is spread evenly, so 23 people in 4 rooms gives groups of 6, 6, 6 and 5. A group size can be entered as a hint that suggests the number of rooms.
- Options: who takes part (skip busy and away people, skip administrators), keep groups closed while the countdown runs, a short warning before the end.
- Late arrivals join the smallest group.
- The server decides and moves people (the client never sends positions); groups exist only in memory and every shuffle is written to the audit log (who started it and how many groups, never what was said).
- First step: an admin API endpoint and a small script, so dynamics can run before the UI exists. Then a panel in the administration dialog.
- Done when: a browser scenario shuffles N people into X rooms of size Y, each group hears only its own room (checked on the SFU), the countdown ends with everyone back, and the Go tests cover uneven numbers and late arrivals.

### A stage for presenting to everyone

**Today:** the *spotlight* pad. One person standing on it with audio and video on broadcasts audio, video and screen share to the whole office; the audience gets receive-only access. Tested with real media; audience size is not measured.

**Plan:** a stage area on the map with a podium and an audience zone.

- Several speakers at once (a panel), and an administrator or host who invites people on stage and takes them off.
- Audience reactions and a raised-hand queue the presenter can see; the host can bring someone from the queue up to speak.
- Optional *quiet audience*: people in the audience zone are not pulled into proximity calls while a presentation runs.
- Cost note: every viewer receives the speaker's stream, so outgoing bandwidth grows with the audience. A stage with N viewers needs a measured run before any audience size is advertised.
- Target for the first version: up to 50 viewers. It is a target until that run is measured; larger audiences would need a bigger media server or a different delivery.
- Done when: a browser scenario puts two speakers on stage, a viewer receives both with real RTP, a hand in the queue is brought up, and leaving the stage revokes publishing on the SFU.

### Administrator control of cameras: audio only where it fits

**Today:** each person can choose *Audio only* and a maximum number of videos in their own settings. Administrators cannot set a policy.

**Plan:** an administrator sets, for the whole office and per area (room, stage, social area):

- *Video allowed* or *audio only*;
- *Camera on when joining* or *camera off when joining*.

Default for a new office: video allowed, camera off when joining a conversation. People turn it on when they want to.

*Audio only* is enforced by the server: media tokens for that area allow the microphone and screen share but not the camera, so it is real isolation and not a hidden button. It also keeps calls light on bandwidth and CPU, which suits small servers.

- Done when: in an audio-only area the camera button explains why it is off, a raw attempt to publish video is refused by the SFU (checked in a browser scenario like the token checks in `rooms`), and the policy survives a restart.

### A space to hang out, apart from the stage and the rooms

**Today:** a social area with couches, tables and a coffee corner, where proximity conversations form as people walk up to each other.

**Plan:**

- A lounge separate from the stage and the meeting rooms in the starter office, with tables where sitting down joins that table's conversation (a small, open group, unlike a closed room).
- *Random coffee*: people who opt in are paired with someone they have not talked to and both get a "walk to them" prompt.
- Ambient touches that cost nothing on the network (art and animation drawn locally).
- Done when: two people sitting at a table share a call that a third person at the next table does not hear, and random coffee only pairs people who opted in.

## Needed before offering hosted plans

The [business model](business-model.md) sells hosted instances. The software is not ready for that yet:

- **Provisioning:** one command creates an instance for a customer on a fresh VM in the chosen region (US East or the EU at launch; the Oracle scripts in `deploy/oracle/` are a start), with their domain and automatic HTTPS.
- **Backups and restore:** scheduled, off-site, and a restore that has been tested.
- **Upgrades:** rolling a new image to every instance, with a way back.
- **Monitoring and alerts** per instance, and a public status page.
- **Seats:** count registered members and enforce the plan's limit, plus the fair-use limit on people in calls at the same time.
- **Billing through Paddle** (monthly and annual, plan changes, first-month refunds), and a customer console for invoices and seats.
- **Data export and deletion** for customers who leave, and the documents a paying customer needs: terms, a privacy policy and a data processing agreement that meet the GDPR before the first EU customer.
- **Contributions:** adopt the Developer Certificate of Origin (signed-off commits) in the contributing guide and check it in CI.
- **Enterprise:** single sign-on (OIDC or SAML) and audit export. Enterprise integrations are out of scope until the enterprise plan is pursued.
- **Measured sizing:** the Team target (25 seats on 2 dedicated vCPU and 8 GB) and the Business target (75 seats on 4 dedicated vCPU and 16 GB) measured with the generator on another machine (`bench/run-vm.sh`, `bench/run-vm-media.sh`) before any seat count is promised.

## Quality and evidence still missing

- **TURN relay** through networks that block UDP. Not tested; the demo host does not open the relay port range.
- **The 2 vCPU / 4 GB reference server with dedicated CPUs**, and full-size scenario C (100 people in 25 calls). Only a CPU-throttled free micro VM was measured with a separate generator.
- **Repeated runs** of each benchmark, sampling the generator machine too; every published run is a single run.
- **A two-hour soak.** Only a ten-minute one was run.
- **Browser frame rate on a laptop with integrated graphics.** Measured only on an Apple M1 Pro.
- **Other browsers and real phones:** the suite runs Chrome only (plus an emulated phone).
- **Moderation:** ban, temporary mute and a report flow. Today administrators can remove members and revoke invites.
- **Accessibility with real screen readers** (NVDA, VoiceOver, JAWS). Only automated checks and keyboard use were run; the map canvas is not usable with a screen reader.
- **Translations:** only English ships. The first market is international, so translations wait for demand.
- **An independent security review.**
- **Real prices** for the cost model (`bench/cost.py` has the formula only).

## Known small issues

- The pet can briefly overlap its owner on a sharp turn or a reversal, and hides behind the owner for about half a second while walking toward the camera.
- A raised hand is lowered after a reconnect.
- Clicking *Lock room* twice quickly sends two lock requests (harmless: the second does nothing).
- On custom maps, a door framed by a one-tile wall stub gets no doormat.
- Assigning an office is recorded in the activity log as a generic map change.
- `bench/run-vm.sh` passes the benchmark invite as a command argument (a short-lived invite to a throwaway database).
- The web bundle is over 900 kB after minification; splitting rarely used dialogs would speed up the first load.
- CI: some GitHub Actions still target Node 20, and `ubuntu-latest` moves to Ubuntu 26 from 19 October 2026; the workflows need a check against both.
- The `security` browser scenario is flaky on GitHub's runners: the replayed-token attack sometimes fails to set up its media connection ("could not establish pc connection") even after one retry. The same message also counts as "rejected" in the tampered- and expired-token checks, so those two checks could pass without the token being refused. They should require the SFU's authorization error instead.

## Out of scope for now

Recording, AI transcription, native apps, a marketplace and 3D worlds. Enterprise integrations wait for the enterprise plan.
