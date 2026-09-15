# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.9.0] - 2026-09-15

Two people can now edit one model without undoing each other. Until this release every
interactive save sent back the whole object the client had loaded when the dialog opened, so
whoever saved second overwrote fields the first had just changed — and both were told it had
worked. A save now carries only what the user actually edited, and a relationship edit is written
as the difference against what that client last saw rather than as a whole-list replace. Alongside
it, the reference data moves to ATT&CK v19.2 with the tactic ordering and the class policies that
release forces, a connected deployment's destructive controls move behind an administrator of its
team, and changing who may sign in stops costing the deployment its modules. Compared against the
previous tag, `v0.8.0`.

**Upgrading:** take the new bundle and follow the operator guide's upgrade procedure — back up,
unpack, set `PLATFORM_VERSION`, `./byodt update`. Nothing in `.env.example` changed in this
release, so a `diff .env .env.example` should show you only your own values, and no saved recipe
needs regenerating to take the upgrade. **The reference-data ingest runs on this upgrade rather
than being skipped**, because the corpus content hash changed — so the one-shot takes longer here
than on an upgrade that only moves code. Let it finish; the platform is held back until it does.
That ingest is additive: every statement is a `MERGE` and nothing in the corpus deletes, so the
v19.2 nodes are created, the properties of nodes that survived are updated in place — `TA0005`
picks up its new name, every tactic gains its matrix position — and **the nodes for the 17
techniques ATT&CK v19 revoked stay in your graph**, together with the relationships the previous
export gave them. Findings link to a technique by an `EXPLOITED_BY` edge matched on `attack_id`,
so a finding raised against one of those techniques before the upgrade keeps resolving; it points
at a technique ATT&CK no longer publishes. The corrected class policies arrive on their own — the
module content hash was restamped, which is what gets the platform's load-time skip gate to
reinstall rather than keep the copy it already has — but nothing re-derives findings that already
exist, so an element's findings pick up the corrected technique references the next time its
attributes or its class binding are written. Two more things need you to act. If you use the
plugin, move to `@dether.net/dethereal` 0.4.5. And the administrator gate on a connected
deployment **is inert until the deployment knows which team it belongs to**: it switches on when
the deployment is next connected with a recipe that names one, which means getting a fresh recipe
from the portal, disconnecting, applying it and connecting again — read what disconnecting costs
first. Until you do that, every console control behaves exactly as it did in 0.8.0.


### Added

- **A deployment can name the team it belongs to.** A person who belongs to two teams was served
  the union of both teams' content on either team's deployment — one team's content reaching
  another team's deployment. Closing that needs the request to say which team it is for, and
  the deployment is the only party that knows. `DEPLOYMENT_TEAM_ID` is an optional recipe value; a
  recipe carrying it now applies, and a recipe without it still applies. On its own this changes no
  deployment's behaviour, which is the point — the name has to be accepted in the field before
  anything can be built on it. The rule the senders keep is a coupling rather than a list of
  routes: the team header is set **if and only if** a bearer token is. That buys three things at
  once — the credential-free catalog calls provably never carry it, which matters because their
  responses are publicly cacheable and may be logged by intermediaries; no entitled route added
  later can forget it; and no public one can acquire it by accident. The value is checked where it
  is written and again where it is read, because the configuration layer is a file on the
  operator's host rather than console-private state, and an identifier the console rejects is now
  logged on both sides — the operator who mistyped it is the only person who can undo it, and
  previously one of the two senders dropped it in silence. An unset value stays silent on purpose:
  that is the ordinary state of every deployment predating the name, and warning on it would teach
  operators to ignore the message that matters. A deployment that has not been told its team is now
  told exactly that, rather than being shown "subscriptions could not be checked just now —
  Refresh to try again", which is the sentence for a transient hiccup on a deployment that would
  answer the same way forever; the sign-in offer is withheld with it, because signing in cannot
  supply a team identifier.
- **Changing a connected deployment requires an administrator of its team.** The console is served
  on the same origin as the platform and was gated on nothing but a valid session, so any member of
  a team could reach it and disconnect the deployment — removing every cloud-provided module and,
  at the next platform start, the classes those modules declare and every link into them. Six
  routes are now gated: disconnect, mount, unmount, install, remove, and the access-list write
  below. Connect is not, and cannot usefully be — it is the pre-cloud paste path with no
  authenticated subject, and it is already refused on a connected deployment. Every read stays
  open: a member who cannot see what their deployment holds is worse served than one who cannot
  change it. Nothing is cached — the gate asks on every gated request and never honours an earlier
  answer, because a decision honoured while the authority cannot be reached is an unbounded grant
  to whoever can interrupt the network. There was no latency to trade for it either; these are
  occasional operator clicks. Refusals use four statuses, because each remedy wants a different
  control: 403 you are not an administrator, 503 the check could not be made, 412 this tab holds no
  credential to ask with, 409 this deployment can never make the check. Never 401 — the interface
  answers any 401 by clearing the session, so a refusal returned as one would sign an operator out
  for not being an administrator. Controls are disabled and explained, never hidden, and only an
  explicit answer disables one; undetermined means the console could not ask, which is the ordinary
  state of a reloaded tab. Disconnect is disabled at the click rather than refused after its
  confirmation, so the refusal does not arrive after the operator has read four bullet points about
  permanent deletion and agreed to them. Disconnect alone is still allowed on a deployment whose
  configuration can never make the check, because disconnect is what an operator reaches for to fix
  a bad configuration.
- **Changing who may sign in no longer costs the deployment its modules.** Who may sign in is a
  list of subjects in the deployment's configuration, read once when the platform starts. The only
  console path to change it was disconnect-and-reconnect — so the discoverable path destroyed graph
  data, and the path that destroys nothing, editing the file on the host, was nowhere in the
  console's vocabulary. **Apply access list** on the Cloud tab now rewrites that one value on a
  running deployment and preserves every other. It applies; it does not ask — the roster lives
  behind a credential this console's token is the wrong audience for, so the operator copies the
  list from the portal, where they are already signed in with one that works. It refuses a list
  that does not name the operator applying it, which would lock them out of their own deployment at
  the next start. It refuses an empty list on its own terms rather than as a missing field: the
  platform reads an empty list as *no restriction* rather than as nobody, and on a
  network-reachable deployment it then refuses to start at all — the console can predict neither
  outcome, so it refuses either way. It takes effect at the next platform start and says so both
  before and after you submit, and it says *which* restart: this one removes no module, so it
  carries none of the consequences of a start that finds one missing. A change the operator
  believes has already happened is the failure this whole route exists to prevent, because the
  control they would reach for next is the destructive one.

### Changed

- **The ATT&CK corpus is v19.2, and D3FEND is pinned.** Techniques go 691 → 697 and tactics 14 →
  15: v19 split Defense Evasion, renaming `TA0005` to Stealth and adding `TA0112` Defense
  Impairment, which carries 56 techniques. Seventeen techniques the previous export carried live
  were revoked, so the corpus is regenerated by a clean re-ingest into a throwaway graph rather
  than merged into the existing one — a merge lets a revoked node survive by simply not being
  mentioned. D3FEND was previously fetched from an unversioned URL, which is why its version was
  recorded as "unknown" and why re-running the ingest months apart pulled a different D3FEND into
  what was meant to be an ATT&CK-only change; it is pinned at 1.6.0, and both halves of the corpus
  are now reproducible from a pinned source. Tactics also carry their matrix position now, stamped
  at ingest from the bundle's own ordered tactic references. The sequence was always present in the
  source and always lost, so every consumer needing kill-chain order carried its own copy — and v19
  changed the sequence by inserting a tactic mid-matrix. That stamp fixes a second-order problem
  worth stating, because it changes what the product shows. A technique's displayed tactic used to
  be picked from its tactics by **name** order, which was always arbitrary and which v19 made
  visible: renaming Defense Evasion moves the alphabetical pick for 185 of 674 techniques, and for
  66 of them the new pick is an unrelated tactic — Privilege Escalation, Execution, Persistence —
  selected by nothing but spelling. The exporter and the runtime resolver now order by matrix
  position, so the tactic shown is the earliest kill-chain stage the technique belongs to, which is
  a real property of it; on this corpus that changes the pick for 33 of 145 multi-tactic
  techniques. A corpus ingested before the stamp existed falls back to name order, preserving the
  previous behaviour. D3FEND keeps name order, since its tactics carry no matrix position and v19
  did not restructure it.
- **The general module's technique references follow the corpus.** Fifty-eight class policy files
  change the techniques they cite, and the shipped policies now carry **no retired technique ids in
  structured references**. One hundred and one prose mentions of retired ids remain in guide and
  description text, pending a guide regeneration — they are read by people rather than resolved
  against the graph, so they misinform rather than misbehave. The module content hash is restamped,
  which is what gets the platform's load-time skip gate to reinstall the corrected module rather
  than keep the copy it already has.
- **`@dether.net/dethereal` 0.4.5.** The plugin compiles the platform's data-access layer into its
  own artifact, so it carries the write-path change above as well: a push from the plugin now
  writes a model's scope lists the way the platform does — an explicitly empty list in `scope.json`
  clears the platform's list, where it used to be silently ignored — and every other write goes
  through the same presence-gated writers the interface uses. Alongside that, the reviewer fix
  under *Fixed* and refreshed dependency ranges. This is the first version published since 0.4.3:
  0.4.4 was declared in the previous release and never reached the registry, so an operator who
  followed that instruction found nothing to install. 0.4.5 is where both land.
- **CI tests on Node 22 and 26; the platform image and the release build move to 26.** Node 20 left
  support in April 2026, and the platform image runs Node 26 — a version no job exercised.
  Packages still declaring `engines.node >= 20` now claim a floor CI does not test, and a comment
  beside each matrix says so. Separately, the Docker build used to write its layer cache from every
  pull request; a cache entry serves only the ref that wrote it, so those entries helped nothing but
  re-pushes of the same pull request while growing to most of the repository's quota and evicting
  the caches `main` depends on. The cache is written only by publishing runs now; pull requests
  still read it.
- **The platform test suites run on every pull request, and can fail one.** `dt-core`, `dt-ui` and
  `dt-ws` carry around two thousand assertions that run in about a hundred seconds, and none of
  them ran on a pull request. What existed was a step inside the build job, filtered to the server
  and marked continue-on-error — a check that existed without running, and one that reached neither
  of the other two packages. The replacement is blocking and names each suite as its own step, so a
  failure names the tree it is in. The end-to-end suite runs too, with the container reaper
  disabled because the harness disposes its own: that suite skips silently where Docker is absent,
  which makes a skipped integration run look exactly like a passing one.

### Fixed

- **Two people editing one model used to revert each other, silently.** Every interactive save sent
  the element as this client last loaded it, so editing a description rewrote the name, the
  position, the parent and the associations along with it — and dragged the node back to wherever
  this client last thought it was. Neither party saw an error: the writer was told to set those
  fields and did, and both screens said the item had been updated. A save now carries only the
  fields the edit names. This is less a new behaviour than an existing one finished — zoning,
  conduits, controls and data items were already sent only when the element defined them, and the
  object naming what the user touched has always existed and has always been discarded before the
  payload was built. Narrowing also *heals*, which is worth saying because it reads as merely
  defensive: the response carries the whole element back and the client re-pins from it, so a
  client that omits a name receives the other person's name and converges onto it. Three surfaces
  change: the settings panel, the model dialog, and the data-item dialog. The model dialog was the
  larger half of its own defect — it seeds itself once when it opens and then saves on *every* act,
  including on the way out when a model is opened or exported, so merely opening a model from the
  dialog destroyed a control somebody else had just attached. Its module list is gone entirely: the
  dialog has no module editor, so the only thing a module list it sent could ever do was overwrite
  somebody else's assignment with a load-time copy. The dialog's form now follows the server's
  answer for every field the user has not touched and never for one they have — losing typing is
  the worse error — and it refuses to start a second write while one is in flight, since a folder
  move and a Save overlap by construction and would otherwise each emit the same relationship
  connect, leaving a parallel edge that reads collapse and no later save heals.
- **Attaching a control no longer detaches somebody else's.** A control or data-item list was
  written by disconnecting every edge and connecting the list the client held — right for a caller
  asserting the whole list, such as an import or a bulk push, and destructive for two people
  editing one element, because the second save carries a list assembled from a view taken before
  the first landed. The client now tells the writer what it believed the list to be *before* the
  edit, and the writer sends the difference; an id this client never saw is in neither side of it,
  so nothing disconnects it. The baseline has to be read before the optimistic merge, and it is
  only correct while nothing else writes to the element out of band — the settings panel used to do
  exactly that, assigning the new list onto the selection so the whole-element send would carry it,
  which would have made the baseline equal the value just written and the difference empty. Those
  assignments are gone, and a data-flow save became optimistic to replace what they were doing for
  the rendered checkbox. One cost is taken deliberately rather than hidden: a delta cannot collapse
  a duplicate edge the way disconnect-everything incidentally did, so two people adding the *same*
  control at the same moment now each connect. A duplicate is additive and invisible on read; a
  destroyed attachment is neither.
- **A save can no longer be built from an id it cannot use.** Relationship writes filter on an
  equality against an id, and an equality whose value is missing serialises away — leaving a filter
  with no condition, which does not match nothing but matches *everything* carrying that label.
  Measured rather than reasoned: a connect built that way attaches the element to every control in
  the deployment, and a disconnect built that way clears every link of that type the element has.
  Neither reports an error, and a read collapses parallel edges, so neither is visible from the
  interface afterwards. What makes this a class rather than a list of sites is that the schema's
  non-null discipline stops at the input-object boundary: top-level ids are declared non-null and
  rejected before the server sees them, but every member of an input object is nullable, and these
  filters are built inside input objects. There are two answers, because the situations differ. An
  entry in a list names one item among many, so it is dropped and the rest of the write stands —
  refusing the whole save would block someone out of an edit they have no way to repair. A scalar
  *is* the edit, so it refuses. An empty parent is an edit rather than an absence: it means "put me
  at the root", which is what dragging a node onto the canvas sends. It can only be written once
  the root is known, so a save made before it resolves now refuses and the caller keeps what it had
  — previously that combination left the element with no parent at all and reported success.
- **Clearing a field now works, and an absence now means "leave it alone".** Two of the data-item
  writer's fields were worse than ungated: an absent sensitivity or regulatory-flag list did not
  merely get re-sent, it *cleared* the stored value. That is what a full sync means by an absence
  and the exact opposite of what an interactive save means by one, and both callers share the
  method — so the only way for the dialog to avoid wiping a classification was to send one, from a
  snapshot taken when it opened, reverting whatever anybody else had set in the meantime. A clear
  is still reachable and now has to be stated: a supplied null sensitivity, or a supplied empty
  flag list. The push path says its clears out loud rather than arriving at them by omission. The
  same distinction closes a smaller defect in the model dialog: emptying the last compliance driver
  wrote nothing and reported that it had, because the helper that prepares a scope treated an empty
  list and an absent one alike — which is the right reading of the stored form, where both mean
  unset, and the wrong thing to say back to it. An absent key says nothing; an empty list is an
  instruction.
- **An element's lock is released by the operation that took it.** The only mutual exclusion the
  platform has on an element could release a lock that was still being held, and then let the
  holder release somebody else's. Each record was minted with an operation identifier that nothing
  ever compared, and three paths deleted by key alone — the damaging one being a budget timer that
  freed the key while the operation it named was still writing. A runs long and its own timer frees
  the key; B arrives, finds nothing, registers; A finishes and deletes B's record; B's timer is now
  armed and unowned and fires into C's life. Nothing went red. The timer no longer releases — it
  warns. An operation outliving its budget is a thing to look at, not a lock to break, and aborting
  it is not honestly available: nothing here can cancel a transaction in flight, so the work would
  carry on and commit while its caller was told it had timed out. The five-minute sweep beside it
  is deleted rather than repaired: it was unreachable while the timer always got there first, and
  the only thing it could do once the timer stopped deleting was reintroduce the same bug on a
  longer fuse. Every time-based release is the defect, whatever its interval.
- **Rebinding an element's class takes the same lock as writing its attributes.** Two mutations
  write an element's derived findings through the same helpers, and only one of them held a lock —
  so an attribute write and a class rebind on one element were excluded from each other by nothing
  at all, and neither had any idea the other was running. The lock is taken on the element id, so
  the two now exclude each other rather than each only itself, and it wraps the whole call rather
  than the write transaction: the part a database cannot arbitrate is what happens before any
  transaction opens — the preflight read, and the module calls whose findings the transaction then
  writes. Engine-level conflict detection gives a transaction atomicity; it does not give two
  callers the absence of overlapping read-decide-write work across separate sessions.
- **The guard that refuses to affirm a superseded finding now reads inside the transaction it
  guards.** Affirming a superseded finding resurrects a retired row into a second live finding for
  one risk. The guard read in one session and wrote in another, so a supersede landing between the
  two passed a guard that had already decided — and the retry made that window *worse* rather than
  narrower. With the competing supersede still uncommitted, the guard's read saw the pre-supersede
  state and passed; the write then conflict-aborted, and the driver's managed retry re-ran the
  write alone, because the read sat outside the callback and was never repeated. So the retry
  landed the affirmation on top of a supersede that had committed in the meantime: the guard did
  not merely fail to fire, the retry machinery carried the affirmation over it. The read now
  happens inside the write's own transaction, so a retry re-reads, and the refusal is thrown rather
  than returned so that the rollback is the refusal's own mechanism — returning a sentinel would
  have committed the lock the refused call took in order to read under.
- **A document read can no longer be pointed outside the scope of the call that asked for it.** The
  read took a scope and never consulted it: its multi-key mode read the address straight out of the
  caller's filter, which arrives as JSON that nothing validates, so naming another scope's address
  read another scope's documents. The address must now name the call's own scope. The type check is
  part of the fix rather than tidiness beside it — the address is assigned out of unvalidated JSON,
  so it can arrive as a string, and on a string a membership test is substring matching, which
  defeats a scope check written without the guard.
- **The plugin's reviewer was missing two tools its own skill calls.** The surface skill runs as the
  read-only reviewer agent, whose frontmatter enumerates a tool allowlist; naming that list makes
  those the only tools available, and neither of the two the skill instructs it to call was on it.
  The skill describes one of them as the only model-wide exposure route, so the exposure counts and
  the whole of the MITRE-grounded gap analysis could not run. Both are reads, and the read-only
  mandate is prompt-enforced and unchanged by this: the allowlist never was the control that kept
  the reviewer from writing. A create-and-run tool that appears twice in the skill is deliberately
  not added — both appearances are inside fenced blocks telling the reader how to run an analysis,
  so it is printed text rather than a call.
- **A tactic an ATT&CK release renames no longer sorts to the front of the matrix.** The client
  sorts the server's tactic list against a hardcoded matrix order, and that sort compared bare
  lookup results — which yield −1 for any name the list does not carry, placing an unrecognised
  tactic first rather than treating it as unplaced. An unknown name now sorts last and is still
  returned, since dropping it would lose a tactic the caller asked for, and unknown names tie so
  their relative order is left as the server returned it. A dataset ingested before v19 still
  reports the retired name, so a transitional alias maps it onto the slot Stealth now occupies.

### Security

- **Nine advisories cleared across four dependencies.** `multer` floored at 2.3.0 for four
  advisories — the previous floor admitted 2.2.0 as a legal resolution and the lockfile was pinned
  exactly there, so a frozen install would have held a vulnerable resolution indefinitely, and one
  of the four names that single version as its whole vulnerable range. One caveat is worth stating
  plainly: 2.3.0 does not fully close the field-array advisory, whose guard is opt-in and defaults
  to unbounded. That is inert here, because `multer` arrives only as a transitive of the Express
  adapter and nothing instantiates it — but anyone adding a multipart upload endpoint must set that
  limit explicitly. `hono` moves to 4.13.5 for three advisories, from a lockfile resolving 4.13.1,
  inside the range of all three. `vitest` moves to 4.1.11 in the console's interface project, whose
  own lockfile the workspace-wide update does not reach; no override was needed, the declared range
  already admitted the fix and the lockfile was simply stale. And `google.golang.org/grpc` 1.83.2
  for a panic reachable on an xDS-configured server — not reachable here, where gRPC is indirect
  and the only listening socket is a plain HTTP server, and taken because it is cheap.
- **Three dependency overrides were dropped after checking whether each still did any work.** The
  check is a resolution probe with the override removed rather than a version comparison, because
  the lockfile records ranges rewritten to mirror the active override and so cannot answer the
  question on its own. An `ajv` floor bought no margin, since the minimum resolution without it is
  already the patched version. A `minimatch` entry was forcing two dependents onto a major neither
  declared, because an override key's qualifier matches a dependent's *declared* range rather than
  its resolution. A `zod` pin rested on a peer requirement the SDK does not actually state, and had
  begun forcing a version outside the plugin's own declared range. A `lodash` override that looks
  inert is kept and bounded below the next major: without it a second copy resolves through a
  transitive that pins an older version exactly, and an open-ended override resolves to the highest
  satisfying version fleet-wide, which is how a future major gets hoisted across consumers that
  only ever declared the old one.

### Documentation

- **The user guides describe the product that ships.** A second audit against the source found the
  same class of drift the previous pass removed, spread across most of the guide set: interface
  affordances that exist in no component, invented example output, deprecated concepts taught as
  current, and integrations described as shipping when nothing implements them. Module assignment
  is retired — the class catalogue is deployment-wide, and the guides now explain where classes
  come from and how to get more rather than how to assign a module to a model. A bidirectional
  issue-tracker sync section is gone; the real seam is one optional, inbound-only, pull-on-read
  hook that no shipped module implements. Retired AI class generation is gone from four guides that
  still told readers to click an icon no settings surface carries, replaced with the class picker
  and browse drawer that do exist. A merged issue is created with an empty attribute string, so
  severity and scoring are dropped — documented with a warning rather than left implied. Analysis
  status renders as Ready, Working, Paused, Done or Failed and never "idle"; re-running replaces a
  row's result rather than accumulating history; and the distribution's shipped analysis type runs
  no AI, so the module-dependent hedge on progress and clarifying questions is restored. The
  countermeasure documentation now names which relations are actually exposed and emitted and which
  are reserved, and states that a countermeasure derives from the control's own classes and is
  identical wherever assigned — assignment decides coverage, scoped to the element or its immediate
  parent boundary.
- **The operator guides cover the administrator gate and the access list.** New sections state who
  can change a connected deployment, which controls need the role, what each of the four refusals
  means, and that a deployment connected with a recipe naming no team is not checked at all. Two
  documents said disconnecting never contacts the cloud and is always available; neither has been
  true since the gate shipped, and the correction names the two narrower guarantees that do hold —
  a session you already hold keeps the ability to revert while the *platform* is down, since the
  check asks a different dependency, and a deployment whose configuration can never obtain the
  credential is not locked in.
- **The flow-store document describes the write the platform now makes.** Its two save listings
  sent the whole merged element, and the word *delta* appeared nowhere in 848 lines — a reader
  following it would have built exactly the caller the platform has just stopped accepting. A new
  section carries the mechanism end to end: why narrowing exists at all, what a call site must
  supply and why the object naming the user's edit is the only part that states intent, the
  merge-then-project order and why the baselines are taken before the merge, the four rules the
  projection keeps with the real case behind each, and the replace-versus-delta decision table —
  including the duplicate-edge trade taken deliberately. Ten further drifts were found while
  verifying it, none of them in the brief: four listings did not match the code they claimed to
  show, two more were earlier implementations, a deduplication window was stated as five seconds
  and is fifteen, and a retry section implied mutations retry when they deliberately do not. Source
  citations are symbols now rather than line ranges, every one of which had drifted onto a closing
  brace or a blank line.
- **The operations reference describes the methods that exist.** Six writer signatures were wrong,
  two of them with worked examples that would not have run. The audit past those six is where the
  value is: every one of the eight MITRE methods documented on the two framework classes is absent
  from the code, two analysis methods resolve an identifier rather than a session, a subscription
  example a reader would copy calls a signature that takes no callback, and two documented read
  methods exist nowhere in the package. Alongside the corrections it now states the two contracts
  every writer obeys, from the writer's side — a field the element does not define is not written,
  and a link list is a delta when the caller can say what it held before and a replace when it
  cannot.

## [0.8.0] - 2026-09-03

Two things an operator does often get shorter. A deployment now reads its subscription from the
cloud on every catalog load rather than from a value frozen into its configuration when it
connected, so a package bought today reaches a running deployment with a **Refresh** instead of a
reconnect. And analyses open from a button on the canvas rather than from a tab buried in the model
dialog. Alongside them: two corrections to numbers the product reports, a plugin that could not
authenticate against anything sitting behind the platform, and a content mount that could report
itself current while the platform served something else. Compared against the previous tag,
`v0.7.0`.

**Upgrading:** take the new bundle, and if you use the plugin, move to `@dether.net/dethereal`
0.4.4. Nothing in an existing `.env` needs an edit, and no saved recipe needs regenerating — the
retired `DEPLOYMENT_PACKAGES` value is accepted on paste and dropped, so a recipe you already hold
keeps applying. One case does need you to act: if the **Content** tab reports that subscriptions
cannot be checked on this deployment, that deployment's configuration predates the permission the
check needs, and only a fresh recipe fixes it — read what disconnecting costs before you apply one.
Reports and counts produced before this release may be inflated; see the first two items under
*Fixed*.

### Added

- **A deployment reads its subscription from the cloud, not from its own configuration.** The
  console used to learn which content packages a deployment was entitled to from a value written
  into its configuration at the moment it connected, and gated the **Content** tab on that copy. A
  subscription is not a fixed fact. Buying a package stayed invisible until the operator regenerated
  the recipe and reconnected — and a disconnect removes every cloud-provided module, after which the
  platform deletes the classes those modules contributed along with every link into them, including
  links from analyses already run. The cheapest way to see a new package cost the graph.
  `GET /api/packages` now asks the content service on every catalog load, carrying the operator's own
  access token on a header of its own; the public catalog half of the same call still carries no
  credential. Subscribe, come back, click **Refresh** at the top of the tab, and the package is
  mountable straight away. A lapsed subscription arrives the same way. Not being able to ask
  restricts nothing: no token — the ordinary state of a reloaded tab, since the browser holds it in
  memory only — a timeout, a refusal, a malformed answer, or a content service that predates the
  surface all leave the subscription undetermined, under a line saying which of them happened. An
  unreachable service must never make a subscriber look unsubscribed. An empty list is different:
  that is an answer, and it means entitled to nothing. A deployment whose configured scope cannot ask
  at all is told exactly that, rather than invited to retry something that will never work.
- **Analyses open from the canvas, not from a tab in the model dialog.** They are now the fourth
  button on the data flow editor's toolbar — **Analyses**, the sparkle icon, beside **Model
  settings**. Analyses are the loop you return to while modelling (run, wait, answer, view) and were
  sitting two clicks behind two tabs you edit once; worse, that tab lived inside the form whose
  submit saves the model, so pressing Enter while renaming an analysis saved the model and closed the
  dialog out from under you. The "needs your input" badge moves onto the new button, where a run
  paused at a human-in-the-loop interrupt is visible on the canvas without opening anything — it
  never lit before, because it matched on a field the platform returns as a list. There is no route
  to analyses from the model browser any more: the tile opens the canvas, and the dialog behind
  right-click carries General and Controls, so the guides route through the editor. The canvas polls
  every 20 seconds and idles while the tab is hidden, refetching when you come back, in place of the
  dialog's unconditional 5. Every toolbar button is now keyboard reachable and carries a real
  tooltip; the lock button had neither.

### Fixed

- **Three write paths were appending duplicate relationship edges, and counts read off them were
  wrong.** Saving a component, a boundary or a data flow re-created every control and data-item
  association it already had — one extra edge per element per save, including a save that changed
  nothing but a position on the canvas. Assigning a control to elements it was already assigned to
  did the same, and passing one element twice in a single call produced two edges from it. The MITRE
  pack exporter put export wall-clock inside the relationship `MERGE` pattern, which made the
  timestamp part of the edge's identity, so every regeneration matched nothing and duplicated the
  whole set: measured across one regenerate-and-re-ingest cycle, 22,895 edges became 42,972. Nothing
  underneath deduplicates — neither supported engine can express an endpoint-pair uniqueness
  constraint on a relationship, and the GraphQL `connect` compiles to a bare `CREATE` — so these
  accumulated until a downstream aggregation exhausted memory. Element saves are now replace
  semantics, which is what the comment above each of them already claimed, and they are self-healing:
  an ordinary save collapses duplicates already on disk for that element. Control assignment reads
  what is attached and connects only the difference. A second pack ingest is now a no-op, all 123
  relationship types at a ratio of 1.00. Nothing here sweeps the database, though — edges outside
  those healing paths stay where they are, and any figure you read off them before this release was
  too high.
- **The threat report's ledger over-counted, by a lot.** It reported roughly 7.7× the true element
  rows, 8.0× the finding entries and 5.8× the supporting-control entries. Three defects in one query,
  all of them the same underlying thing: the engine's aggregation silently declines to collapse
  certain shapes and returns plausible-but-wrong data rather than failing. Deduplicating a collection
  of maps stops working the moment any value in the map is null, and most exposure fields are null on
  an active finding; a list-valued column was carried as a grouping key, which multiplied the element
  rows themselves; and the duplicate `SUPPORTS` edges above rode through unchecked, which is where
  the control count came from. The obvious remedy is worse than the bug — re-projecting from
  collected nodes gives the right count of the wrong data, where a two-finding element reads as its
  first finding twice and the second is silently dropped. The shape that shipped deduplicates on a
  scalar tuple and re-projects by index, which also preserves nulls rather than turning "not scored"
  into a placeholder score. If you acted on a report produced before this release, its totals were
  inflated; the duplicate edges behind part of that are still on disk, and the query no longer counts
  them. The query is now pinned against a real engine rather than against inference, with every
  assertion comparing identities rather than lengths — the first version of that suite asserted
  lengths and passed against a ledger reporting one finding twice in place of two.
- **The plugin could not authenticate against anything behind the platform.** Two refusals, both live
  at once, and either alone was enough. It presented the OIDC identity token as its bearer; the
  platform's own guard accepts that, because it validates a signature and an audience rather than a
  token's use, so nothing looked wrong locally — while a resource server behind the platform does
  check, refuses anything that is not an access token, and the refusal arrives as an opaque server
  error. The bearer is the access token now, on both the stored-token and the transparent-refresh
  path; the second fails an hour later and is the one an edit misses. And the login hardcoded
  `openid profile email`, so no token it could mint carried a resource-server scope even after the
  swap. It now requests what the platform advertises, falling back to those base scopes where a
  platform advertises none, which is what keeps existing stored sessions valid. Requesting more is not
  enough on its own: a refresh grant carries no scope parameter, so a session minted under the old
  scope can never widen by refreshing. The plugin records what was actually granted and falls through
  to a fresh authorization instead of refreshing an under-scoped token forever. Keeping the bearer and
  the identity token apart is also what keeps audit attribution honest, since only the identity token
  carries an email address. Separately, a module resolver refused upstream now reports
  `UNAUTHENTICATED` rather than a generic module failure, which had been sending operators to
  investigate a platform that was fine.
- **A content mount could report itself up to date while the platform served the previous version.**
  The console writes a mount's marker before its module file, deliberately: the other order can leave
  a loadable module in a directory that both mount and unmount then refuse. The cost landed on a
  re-mount. A module-file write that failed afterwards — or an abrupt death between the two writes,
  which no error return can report — left the marker at the new pin and a valid module file at the
  old one, and the currency check only asked whether that file existed. The row rendered `up to date`
  while the platform went on serving the previous pin's classes, schemas, guides and evaluation. The
  check now reads the file back and asks whether it names the pin the marker records. A mismatch gets
  its own state — **module file mismatched**, rendered in the fault tone rather than the warning tone
  used for a merely outdated mount — and the row offers **Repair**, which mounts again at the pin
  already recorded rather than quietly substituting a different version. Publishing a module file now
  writes a temporary file and renames it into place, closing that window for every failure the
  temporary write catches.
- **Icons went missing on the load after signing in.** Coming back from the identity provider
  rendered every icon as an empty square until a cache-bypassing reload. Icons are a webfont, and the
  callback page paints one — starting the font download — then navigates away, cancelling it
  mid-flight and leaving the next document to render without it. That page's two glyphs are inline
  SVG now, and the font is preloaded from the emitted bundle, which also fixes slow icons on any cold
  load rather than only after a login.
- **The settings panel opened on whichever tab the last selection left it on.** Dropping a component
  or drawing a data flow landed you on Exposures or Controls — two empty tables for an element that
  has just been created — hiding the name and description you came there to fill in. A newly created
  element now opens on General, and the panel stays put if you are part-way through editing a
  different one.

### Changed

- **`@dether.net/dethereal` 0.4.4.** The plugin is versioned and published on its own line; this
  version carries the authentication fix above and its refreshed dependency ranges. *Correction:*
  0.4.4 was declared here and never published — the registry stayed at 0.4.3. The authentication fix
  first reaches an installed plugin in 0.4.5, under the 0.9.0 release.
- **The browser tab reads "Dethernety | Threat Modeling".** The previous title was a strained
  portmanteau matching nothing else in the product. A tab, a bookmark and a history entry all read
  from it, so the brand leads and the rest survives truncation.

### Security

- **The bundle's runtime layout is harder to redirect.** `data/` carries the sticky bit, so a
  non-owner can no longer replace one of its children between runs — the directories under it are
  world-writable by necessity, and permissioning each by name follows a symlink planted in place of
  one. The bit is deliberately not applied to the modules, schema and mode directories, whose entries
  are written by containers and legitimately replaced under a different user than installed them.
  Separately, the mode file is refused outright if it is a symlink: an existence test dereferences,
  so a dangling link there would have had the bundle create the operator's file wherever the link
  pointed — holding a configuration layer that turns authentication off.
- **URL-shaped recipe values are refused if they carry userinfo.** A `user@host` prefix is lifted out
  of the host during parsing, so a value could name one host, pass every other check, and resolve to
  another. The redirect the console writes, and derives its allowed origins from, is now validated
  where it is written rather than left to its caller.
- **Six advisories cleared across three dependencies**, each of which resolved below its fix in this
  workspace's lockfile: `fast-uri` floored at 3.1.6, `qs` at 6.16.0, and `browserslist` newly pinned
  at 4.28.7. The `browserslist` pin matters more than the version suggests — the lockfile held three
  distinct copies, so clearing the advisory on the highest would have left two in range. Also
  `google.golang.org/grpc` 1.83.1 for a heap-exhaustion advisory reachable by fragmenting HTTP/2 data
  frames; it is an indirect dependency and nothing here serves gRPC.

### Documentation

- **The guides route through the editor, and drop a click target that never existed.** Every
  walkthrough that said to open the model dialog and click the Analysis tab now stops at a step the
  reader cannot perform — worst of them the threat report's getting-started page, where it was step
  2 of a shipped module's onboarding. Four documents also told you to open the model dialog by
  clicking the model's name on the canvas; that name plate has never had a click handler, and it is
  the **Model settings** button beside it that opens the dialog. Two more sent readers hunting for a
  star icon to start a run, which analysis rows have not carried since they gained labelled buttons.
- **The operator guide said a disconnect costs nothing, above an operation that deletes data.** It
  now states what a disconnect removes — every cloud-provided module, and at the next restart the
  classes those modules contributed together with every link to them, including links in analyses
  already run — and the console asks you to accept the same list before it proceeds. That correction
  was owed before this release and would be owed without it.
- **Two false claims in the architecture set were corrected, and four shipped designs stopped calling
  themselves drafts.** One document described an append-only method as using a
  disconnect-and-reconnect pattern it must not use; the other cited a test file that exists nowhere
  in the repository, above a table formatted as an inventory that was really a pre-implementation
  plan. The plan is now labelled as one, beside a dated as-built table with measured counts.

## [0.7.0] - 2026-08-26

Entitled code arrives on the deployment. The console could already mount content packages, whose
bytes the platform fetches per request; it can now install a signed **artifact** — code delivered
once, verified before it is placed, loaded from disk thereafter. Alongside it: a knowledge-graph
access contract that answers identically from a local graph or a remote service, a batch of
correctness fixes in the plugin and the editor, and a deployment fix without which the bundle does
not start on a bind mount at all. Compared against the previous tag, `v0.6.1`.

**Upgrading:** take the new bundle. If your database never started — the container exiting
immediately, or restarting forever on a permission error naming its log file — that is the first
item under *Fixed* and it is why. The new bundle adds one directory beside your data
(`data/memgraph-log`); nothing else requires an edit to an existing `.env`.

### Added

- **The console installs, reports and removes signed artifacts.** `POST /api/artifacts` fetches a
  descriptor and an archive from the content service carrying the operator's own access token on its
  own header — the console holds no credential of its own for this and keeps nothing between
  requests. The archive is verified against an identity **derived from the key and version that were
  requested**, never from anything the service returned, and the stamp inside the payload must name
  the same two. Signing is keyless: there is no key to distribute, nothing to rotate, and no
  override. A tampered archive, an unverifiable one, or one carrying another version's valid
  signature is refused and nothing is placed. What is installed is discovered by scanning the
  modules directory rather than tracked in a ledger, so a scan cannot disagree with the disk.
- **A knowledge-graph access contract with two implementations.** `KgClient` is a closed set of
  named, keyed, batch-shaped queries — never raw Cypher, never an unkeyed enumeration — and a
  consumer cannot tell whether it is being answered from the deployment's own graph or from an HTTP
  service. One contract suite runs against both to prove they answer alike. `createKgClient` selects
  from configuration rather than introspection: a base URL with a valid digest gives the remote
  implementation, a base URL with a missing or malformed one reports unavailable and logs the
  misconfiguration once, and no base URL at all gives the local implementation.
- **Disconnecting from the cloud now asks first, and takes the cloud's modules with it.** A
  deployment the console reports as pure open-source while it still serves cloud-provided modules is
  not one. The disconnect removes every module the console placed — content mounts, installed
  artifacts, the knowledge-graph connection — each identified by the marker file written beside it,
  and never touches a directory it did not write. The console deletes files and issues no database
  command; what the platform does with a module it no longer finds is stated in the confirmation
  before anything is removed.

### Fixed

- **The database would not start on a bind mount — on any host, for one of two reasons.** Two
  independent faults shared a single symptom, and each platform showed only one of them.

  The first is **ownership**. The database refuses a data directory it does not own — an ownership
  comparison, not a permission one — and the control script answered that question from the
  container engine's *name*: the operator's own uid under Docker. That holds for Docker Engine on
  Linux, where uids pass through to a bind mount, and is false on Docker Desktop, whose file-sharing
  layer presents every bind mount as root-owned. On macOS and Windows the database was handed a uid
  that could never match. The script now asks the engine directly, with a short-lived container that
  reports the owner as the container sees it, so there is nothing left to infer.

  The second is **the log directory**, and it is why the first was so hard to read. The image ships
  `/var/log/memgraph` writable only by its own user, so a container running as anyone else dies on
  its first log line — reporting a permission error that names the log file while the ownership
  fault it was really failing on goes unmentioned. On macOS the corrected uid is root, which can
  write anywhere, so fixing ownership alone appeared to fix everything; on Linux the corrected uid
  is the operator, and the database still could not start. The log directory now comes from the
  host, created world-writable, which satisfies the image's own user in named-volume mode and the
  operator in bind mode. A named volume would not do: the engine seeds one from the image,
  ownership included.

  Verified on four combinations — Docker Desktop and Podman on macOS, Docker Engine and rootless
  Podman on Linux — each starting healthy and writing its log where the operator can read it.
- **The console told operators their callback URLs were already registered.** The text sat directly
  beneath a box containing two callback URLs and said local development addresses are always
  accepted and not listed there — wrong twice over, since the reader is looking at exactly the thing
  it claims is not shown, and only specific host, port and path combinations are registered. A
  reader who believed it skipped the step; the failure then lands at the identity provider, where
  nothing in the operator's own logs explains it. It now says to paste both and save, without
  exception. The same sentence has been corrected in the connect procedure of the documentation.
- **A second delete never opened its dialog.** Deleting a second component from the data-flow
  settings panel silently did nothing until a page reload. The panel raised its own flag while the
  confirm dialog closed itself internally, leaving flag and visible state disagreeing; the next
  delete then assigned `true` to a ref already holding `true`, which is not a reactive change, so
  nothing remounted and no watcher fired.
- **Class binding ignored component type.** A component class is bound to exactly one component
  type, but a PROCESS component could be offered — and successfully assigned — a STORE class. The
  exposures and countermeasures instantiated from that class then described something the element is
  not. Both directions of the hole are closed, and the error taxonomy documents the constraint.
- **The plugin reported success for work that did not happen.** An audit surfaced a recurring shape
  — an operation claiming to have done something it had not, or a metric measuring a proxy rather
  than the thing it is named after — and the confirmed instances are fixed. Attribute stubs were
  seeded with each field's schema default instead of null, so the enrichment checklist skipped them
  by construction and shipped an assertion nobody had made. A follow-up guards every path that can
  destroy an attribute file, not just the one the first pass covered.
- **Every URL-shaped recipe value is held to its contract.** The scheme check constrains scheme
  alone — https, or http only on loopback — and never the destination, which is the product rather
  than a defect: a recipe names the cloud service a deployment talks to. Refusing redirects is the
  control that matters when the host is caller-nameable by design, and the comments on that path now
  say so rather than asserting a property the code does not have.
- **The signer refusal named only one spelling of a workflow file.** The pattern accepts both
  extensions; the message mentioned one, sending an operator to check a value that was already
  correct.

### Documentation

- The console's public documentation describes the artifact install, its routes and its second
  credential — the previous set described a daemon with three responsibilities and listed eleven of
  its sixteen routes, and the credential inventory predated both a second credential and an outbound
  trust boundary.
- The plugin's nineteen documents were audited against source; eighty-four discrepancies were
  raised, seventeen refuted as design records or misreadings, and the rest applied — each
  re-verified before it was written.

## [0.6.1] - 2026-08-14

A deployment fix. The bundle shipped in 0.6.0 does not start under Podman when Podman's own
compose provider is the one installed — `./byodt up` fails on unusable image references. Docker
deployments are unaffected. Compared against the previous tag, `v0.6.0`.

**Upgrading:** take the new bundle. If you keep your existing `.env`, add the registry to the
three third-party image keys (`docker.io/…`, as in `.env.example`) — that one edit is what an
existing file is missing.

### Fixed

- **Only the last `--env-file` was being read.** The control script passed two — the readable
  configuration and the generated secret — which Docker Compose merges and Podman's compose
  provider does not: it keeps the last and drops the other. Every value interpolated from the
  configuration then resolved empty, so the deployment came up with no images, no published port
  and no database user. What disguised it as an image problem is that the values carrying a
  default in `compose.yaml` fell back and looked healthy; only those without one appeared blank.
  The script now passes one file and hands the secret to Compose through the environment, which
  also keeps it out of any file beside the readable configuration.
- **The console image reference was built by nesting one variable inside another's default.**
  Podman's compose provider does not expand that, so the reference reached the engine as a
  literal `…:${PLATFORM_VERSION}`. The control script now derives the value itself, which keeps
  `PLATFORM_VERSION` the single version knob without depending on nested expansion. An explicit
  `CONSOLE_IMAGE` still wins, so a mirror stays repointable.
- **The third-party images were named without a registry.** Docker quietly assumes Docker Hub;
  Podman refuses an unqualified name unless the host has configured a search registry, which a
  default installation has not. They are fully qualified now.
- **The database would not start on its own data directory.** Memgraph requires the directory to
  be *owned* by the user it runs as — an ownership check, which no permission bits satisfy — and
  which host user that corresponds to inside the container depends on the engine. On the default
  host bind mount it never matched, so the database exited immediately and was restarted forever,
  logging only its banner. The control script now runs the database as the user that owns the
  directory, derived from the engine it resolved. The data stays owned by, and readable by, the
  operator, which is the whole reason to choose a bind mount; chowning the directory to the
  image's own user would have started the database but left its data unreadable from the host.
  A named volume is unaffected either way — the engine creates it owned correctly.
- **A first run could wedge itself on the schema file.** One file is bind-mounted into the
  platform, and a container engine handed a bind source that does not exist creates a *directory*
  in its place. The one-shot whose job is to write that file then failed with "is a directory", on
  every retry, until someone removed it by hand. The ordering that should have prevented it — the
  platform waiting for the one-shot to finish — is honoured by Docker Compose but not reliably by
  Podman's provider. The control script now creates the file itself before anything mounts it, and
  clears the stray directory if a previous run left one. It refuses outright if that path is a
  symbolic link, and creates the file carrying its mode rather than adjusting the mode afterwards:
  the directory has to be world-writable for the one-shot to write there, so following a link
  planted in it would let anything with local access redirect a file the operator creates.

### Added

- **Continuous integration resolves the bundle under both compose providers**, and fails on an
  image reference that is empty, untagged, unexpanded or unqualified — the four shapes the
  defects above took. The Podman leg pins the provider explicitly: left to choose, Podman prefers
  Docker's provider when it is installed, which is precisely why every check run before the
  release agreed with Docker and none of this surfaced.

## [0.6.0] - 2026-08-14

The release that makes the platform self-hostable: a signed deployment you download and run,
and an operator console that sets it up and reports on it — in place of assembling a stack by
hand. Compared against the previous tag, `v0.5.0`.

**Upgrading:** nothing in the platform itself changes. The `demo/` directory is gone — see
*Removed* — and the deployment bundle replaces it as the supported way to run Dethernety. In the
bundle, `PLATFORM_VERSION` is the single version knob: it selects the platform image and the
console image together, so upgrading is a one-line change.

### Added

- **A complete deployment, published as a signed release asset.** `byodt-<version>.tar.gz`
  carries a compose stack — graph database, embedding server, platform, operator console and an
  nginx front door — plus `byodt`, a wrapper over Docker **or** Podman that carries the two
  environment files every command needs, so the database password stays out of the readable
  layer. `./byodt up` seeds the configuration, generates that password, creates the runtime
  directories and starts the stack. One published port serves the platform and the console on the
  same origin, bound to loopback by default.
- **An operator console**, served through the front door at `/console/`. It runs twice, in two
  forms. Before the platform starts, a one-shot places the schema, fetches and verifies the
  signed modules, and ingests the MITRE corpus; a version or schema problem stops the start,
  while a module or ingest problem is recorded and the stack still comes up, so the deployment is
  diagnosable rather than silently empty. Then a daemon serves the console itself: per-service
  status, the failure states worth acting on, and the configuration changes the operator owns.
  Published as a multi-architecture image (`linux/amd64`, `linux/arm64`), cosign-signed against
  the release workflow's own identity with build provenance attested.
- **Verified module installation.** The console resolves the release by `PLATFORM_VERSION` and
  never picks a version of its own; it verifies each payload against the signed `modules.json`
  index with the certificate identity pinned to the exact release workflow, and extracts under
  hardened tar limits.
- **Operational commands** in the bundle: `status`, `logs`, `restart`, `update`, `down`,
  `destroy`, and snapshot-based `backup` / `restore` — a hot, consistent graph snapshot copied
  out of the stack, restorable onto any deployment of the same version. Automatic in-place
  snapshots are configurable for crash recovery, and the database's storage can be a host bind
  mount or a named volume, which is the difference between an inspectable data directory and one
  that survives a VM-backed runtime's file-sharing layer.
- **TLS at the front door**, terminating for the whole deployment — platform, console and API
  behind one endpoint — from a generated self-signed certificate or your own.
- **An optional cloud-connected posture.** A deployment stays local and calls out to nothing
  unless an operator pastes a deployment login recipe into the console, which writes it into a
  configuration layer the platform reads on the next recreate. The console copies out only a
  closed set of variable names and refuses the whole paste if the recipe carries anything else,
  so the recipe cannot reach the variables that would turn authentication off or load code at
  boot. Disconnecting rewrites the same file with the local values and contacts nothing, so the
  recovery path never depends on the thing it recovers from.
- **Content mounts.** On a cloud-connected deployment the console can mount content-backed
  modules — a small stub naming a module key and an immutable pin, not a download — and report
  when a newer version of a mounted package exists.
- **Deployment documentation**: an architecture set covering the deployment, the console, the
  supply chain and the security model, and a user set covering installation, configuration,
  operations, the cloud connection and troubleshooting.

### Changed

- **`@dether.net/dethereal` 0.3.5.** The plugin is versioned and published on its own line; this
  version carries its refreshed dependency ranges.
- **The documentation names the deployment rather than a demo.** The README, the configuration
  guide and the glossary describe a deployment you run, with the auth-disabled mode named for
  what it is — single-user and development — rather than for a demonstration.

### Removed

- **The `demo/` directory.** It existed to stand a stack up before there was a supported way to
  run one; the deployment bundle is that way now, and keeping a second, differently-configured
  stack in the tree only invited running the wrong one.

### Security

- **`nanoid` floored at 3.3.18** (`GHSA-2v37-7h3g-55p8`, CVSS 8.2 — custom generators can loop
  indefinitely at size zero). It arrives transitively through `postcss`, so it is pinned by
  override rather than lifted; the upper bound is load-bearing, because an unbounded floor
  resolves an ESM-only major into a consumer that cannot take it.

## [0.5.0] - 2026-08-07

A release that removes a service from the deployment, adds security boundary zoning to the
model, and hardens the platform across four libraries. Compared against the previous tag,
`v0.4.0`.

**Upgrading:** the OPA server is no longer part of any deployment — see *Removed*. Container
images are now published, so a deployment no longer has to build one.

### Added

- **Security boundary zoning** — trust zones, domains, roles and approved channels on
  boundaries, with conduits between them. Declared zone policy surfaces in the Threat Report,
  and Boundary Crossings appear in the export alongside the data-flow policy. The Dethereal
  plugin models and pushes zoning as well, so it is authorable from either surface.
- **Published container images.** Releases now publish a multi-architecture image
  (`linux/amd64`, `linux/arm64`) to the GitHub Container Registry, signed with cosign against
  the release workflow's own identity — so verification needs no key from us — with build
  provenance attested alongside. The run summary prints the `cosign verify` invocation.
- **`DtRemoteModule`** in `@dethernety/dt-module`: a sibling of `DtFileOpaModule` that serves
  class metadata, templates, guides, embeddings and evaluation from an HTTP content service
  instead of a local data directory. Every difference — network, caching, unavailability — is
  expressed through the existing `DTModule` contract, so the platform stays unaware that a
  module is remote.
- **`afterInstall` module lifecycle hook**, invoked post-commit, with documentation.
- **Class unassignment** — a remove-class action in the UI, and explicit-null `classData` on
  model push so the removal survives a round trip.
- **Read-only `dt-core` accessors exposed to module bundles**, plus disposition-reason prefill.
- **Optional per-request token on the four content methods** (`getClassTemplate`,
  `getClassGuide`, `getExposures`, `getCountermeasures`), a deployment access allowlist, and a
  configurable OIDC scope — all backward compatible with existing modules.
- **Rego finding mappers as a reusable subpath export** of `@dethernety/dt-module`.
- **A signed module release channel.** The open-source code modules are published as
  cosign-signed release assets alongside a signed `modules.json` index, which carries the release
  tag so an older index cannot be replayed as a current one. Payloads are stamped with the
  identity of the release that produced them. The release workflow is split in two so the signing
  token is never present while any dependency's install scripts run. *(Recorded after the fact:
  this landed between the entry below being written and the tag being cut, so it shipped in
  0.5.0 — its assets are this release's assets — without appearing here.)*

### Changed

- **Rego evaluates in process.** Both the runtime and authoring paths now use
  `@dethernety/regorus-wasm`, a vendored WebAssembly build of Regorus, instead of calling out to
  a policy server.
- **`@dethernety/dt-module` is versioned independently of the platform** from this release. It
  moves with its own interface rather than with the application.
- **`@dether.net/dethereal` 0.3.4** — the plugin is versioned and published on its own line, not
  with the platform. This version carries its refreshed dependency ranges; a package whose
  declared dependencies move has to be republished for the change to reach anyone installing it,
  and the repository had moved ahead of the published copy.
- **The default MITRE embedding corpus** is committed rather than regenerated per build.

### Removed

- **The OPA server.** It is gone from the compose stack, the configuration guide and the
  documentation, and nothing in the platform contacts a policy server. Deployments running one
  for this platform can decommission it; no configuration replaces it.

### Fixed

- **`OIDC_JWKS_URI` was read as `OIDC_JKWS_URI`.** The transposition was internally consistent,
  so nothing appeared broken — but an operator who spelled the variable correctly got
  schema-level authentication silently un-enforced outside production, and a boot failure
  naming a variable they had not set inside it.
- **The production container image probed the wrong port.** It declared `EXPOSE 3000` and
  health-checked `localhost:3000` while the server listens on 3003, so the container reported
  `unhealthy` for its whole life and anything gating on health waited for a condition that
  could not arrive. `docker:run` published the same wrong port.
- Node labels are drawn above connection handles in the diagram editor.
- **Dethereal drift detection** sees source files outside the model directory, so a model whose
  sources live elsewhere in the repository no longer reports as drift-free when it is not.
- MITRE technique mappings in `dethernety-general` re-synced after a corrected export.
- **Four remediation sweeps** across the backend, the frontend, the data-access layer and the
  module base library, covering concurrency, correctness, crash safety, the analysis lifecycle,
  module-installer safety, class-identity migration, cross-engine DDL, and honest health
  reporting.

### Security

- **Only verified JWT claims reach the GraphQL auth context.** The context factories previously
  placed the unverified `Authorization` bearer into `context.jwt`, which the schema layer treats
  as authenticated.
- **Fail-closed query depth guard**, and security headers in every environment rather than only
  in production.
- **Deployment access allowlist**, fail-closed for a network-reachable deployment on a shared
  identity provider.
- **A tag name could execute in the release workflow.** A release step built its program text by
  string concatenation around the tag, so the name a release is cut from was executable rather
  than data. It is passed as a variable and matched literally now. *(Also recorded after the
  fact — same window as the module channel above.)*
- Dependency sweeps with security override floor bumps.

## [0.4.0] - 2026-06-24

A feature release expanding the Threat Report's reachability analysis, redesigning
the analysis-run experience, and overhauling the issue-management surface — closed
out with a full dependency-security pass. Compared against the previous tag, `v0.3.0`.

### Added

- **Threat Report — Blast Radius analysis**: a reachability mode tracing how far an
  attacker can reach from a node, Pick-Two choke-point identification with first-hop
  flow, and a "view strip" that jumps from a Blast Radius node into the Pick-Two view.
- **Analysis dialog redesign**: a `hasDocument` completion signal threaded through
  `AnalysisStatus`, a status-derived run phase, two-button + overflow row actions
  driven by that phase, and an Analysis-tab badge when a run needs input.
- **Maximizable master-detail exposures view** in the diagram UI.
- **Loading states** across the dataflow editor and model browser.
- **embeddinggemma** as the default MITRE-framework embedding model, with the
  generated corpus committed so it no longer regenerates on every build.

### Changed

- **Issue-management surface** (the `/issues` list and editor) substantially reworked
  for correctness, performance, UX, and accessibility: a summary/detail split with
  lazy-loaded detail, severity surfaced on collapsed rows, decoupled search and
  filter inputs, legible loading/empty/error states, a confirmed-and-explained merge
  flow, accessible selection and filter menus, and coalesced auto-save with a
  save-state indicator.
- **Faster module boot** — unchanged modules are no longer re-installed on startup;
  installation is skipped via a module content hash.
- **Module bundles share the host JSONForms engine** (via `__HOST_DEPENDENCIES__`)
  instead of bundling their own copy.
- **Module packaging** copies external `.graphql` schema fragments into the bundle.

### Fixed

- **dethereal control pipeline**: wrong-kind bindings, push diagnostics, subagent
  relay, and consent handling.
- **dethereal enrichment quality**: data-item handling, multi-class Controls, rank
  scoring, and general hardening.
- **mitre-frameworks** ships committed framework data instead of regenerating it on
  every build.
- **dt-ui** generates UUIDs without requiring a secure (HTTPS) context.
- **dt-module** keeps analysis runs alive across a stream disconnect.

### Security

- **Dependency maintenance and residual-CVE remediation.** A maintenance sweep plus a
  follow-up pass raised `pnpm.overrides` floors and eliminated vulnerable transitive
  versions across `hono`, `@hono/node-server`, `multer`, `dompurify`, `protobufjs`,
  `@grpc/grpc-js`, `ws`, `esbuild`, `form-data`, `@babel/core`, `undici` (by bumping
  its sole consumer `testcontainers` from 10 to 12), and `js-yaml` (a scoped override
  that drops the legacy 3.x copy pulled by coverage tooling). Every advisory was
  closed by a genuine version fix.

## [0.3.0] - 2026-06-08

A feature release centred on residual-risk reporting, the finding disposition
lifecycle, and a substantially expanded default module. Releases 0.1.1 through
0.2.1 were published as GitHub releases without changelog entries; this entry
resumes the changelog and compares against the previous tag, `v0.2.1`.

### Added

- **Threat Report module** — query-based residual-risk and disposition reporting:
  graded MITRE coverage matrix, flow-route reachability analysis, crown-jewel
  tile with killer-route cross-references, per-component profiles, posture
  summary, a structural boundary-crossing ledger with a faithful minimap,
  snapshot lifecycle with staleness detection, and JSON/HTML export.
- **coverage-tools module** — graded, element-scoped MITRE coverage primitive
  consumed by the Threat Report.
- **Finding disposition lifecycle** — pending / confirmed / disposed states with
  lifecycle badges, one-click affirm, and an affirm-edit dialog. The new
  **AFFIRMED** disposition keeps a finding live across the ledger, coverage
  metrics, and exports.
- **MITRE technique picker** for assigning ATT&CK techniques to findings.
- **MITRE verb edges** — countermeasure→technique verb relationships surfaced in
  GraphQL with allowlisted edge provenance and append-only justification
  durability.
- **Asset-context sync** — user-asserted threat-model context (crown jewels,
  data-item sensitivity and regulatory flags, compliance drivers) promoted to
  first-class platform fields and surfaced in the diagram editor and model dialog.
- **Data-item lifecycle association** — data items can be associated across the
  full element lifecycle.
- **Atomic class-change mutation** and a redesigned class-picker family backed by
  a `listClasses` query.
- **Cascade-delete orphan prevention** — atomic `deleteModel`, lifecycle hooks,
  and an admin orphan sweep.
- **dethernety-general** default module expanded to 75 component classes,
  including container and operating-system-host boundaries and file-based issue
  classes (replaces the former dethernety-module as the default).

### Changed

- `Exposure.score` and `Countermeasure.score` widened to `Float`.
- MITRE search aligned to the Memgraph tier with an updated default embedding
  model.

### Fixed

- `createAnalysis` null-return and Memgraph constraint fallback.
- `elementsWithExtendedInfo` model resolution bounded to prevent a Memgraph
  timeout on large models.
- Numerous dt-ui disposition and exposure UX corrections, including readable
  control-dialog theming, terse pending badges that fit the tab rail, and a
  dirty-guard on the control editor.

## [0.2.1] - 2026-04-22

Two-commit follow-up to v0.2.0. One architectural simplification in Dethereal's
enrichment flow, one TypeScript strict-mode cleanup. No breaking changes.

### Dethereal

- **MITRE tactic coverage now platform-derived.** `/dethereal:surface` now
  aggregates `Exposure.exploitedBy` across analysed elements instead of reading a
  hand-maintained `mitre_attack_techniques` field on component attributes. The
  security-enricher agent's 3-step MITRE anti-hallucination protocol
  (`search_mitre_attack` → validate → persist) is removed — the platform graph is
  now the single source of truth for technique mappings. Module policies already
  declare `exploited_by: [T...]` on every exposure; removing the duplicate
  client-side list eliminates a two-source-of-truth drift risk. Escape hatch for
  uncovered techniques is a module policy addition, not a hand annotation. (#106)
- **TypeScript strict-mode fixes in three tools.** `generate-attribute-stubs`,
  `manage-controls`, and `validate-model` now pass `noUncheckedIndexedAccess`
  cleanly — replaces ad-hoc structural parameter types with dt-core types,
  narrows `apolloClient` once at the action-dispatch site, and adds a JWT
  payload-segment guard. No behaviour change. (#109)

## [0.2.0] - 2026-04-20

This release introduces **Dethereal**, a Claude Code plugin that brings
AI-assisted threat modeling and DevSecOps shift-left into the developer's editor,
plus a per-Control library with crash-safe write-ahead logging and
shared-ownership safety. It also lands the **file-based v2 module architecture**,
**pre-computed class embeddings** for offline install, a CVSS v3.1-aligned
**`AttackVector`** field on Exposures, and a **chunked archive upload** transport
for multi-megabyte module imports.

### Dethereal Plugin (new)

A Claude Code plugin for AI-assisted threat modeling against the Dethernety
platform.

- **14 slash commands**, **4 specialized AI agents**, **22 MCP tools**,
  **11-step guided workflow** (#65, #97)
- **Class matching, control gap analysis, embedding pipeline** (#84)
- **Multi-module selection** in the classification workflow (#82)
- **Control integration** — classification, coverage analysis, two-tier
  reporting (#88)
- Full user docs: getting started, guided workflow, glossary, command reference,
  sync & version control, model concepts, agents & architecture

### Control Library (new)

Per-Control file mirror (`controls/<id>.json`) with platform sync, crash-safe
greenfield ID rebinding, and append-only audit log (#104).

- **Two-Write Rule** — every Control change writes to both the per-Control file
  and the platform; the audit log captures every decision
- **WAL-protected ID rebinding** — atomic rename of `greenfield-*` → server UUID
  survives mid-write crashes
- **Shared-ownership safety prompts** on push when a Control is referenced by
  multiple model elements
- **Recovery verbs**: `repair-wal`, `promote-external-edit`, `tombstone`,
  `merge-from-file`
- **Path-traversal hardening** — `validatePathConfinement`, `assertSafeRelPath`,
  `assertSafeControlId` defence-in-depth at every boundary
- **Coarse model-dir lock** with PID-aware stale-lock recovery serialises
  concurrent `manage_controls` invocations

### Modules — File-Based v2 Architecture

- **File-based v2 modules** — module manifest, classes, exposures, countermeasures
  live as files; loader unifies install paths (#85, #91)
- **Module custom resolvers** — DTModules can register GraphQL resolver functions;
  module workspace receives structured interrupts (#67, #61)
- **Module schema extensions, SSE auth, analysis flow navigation** (#58)
- **Pre-computed class embeddings** ship with the catalog for offline install —
  no embed-on-install latency (#97)
- **`AttackVector` on Exposure** (CVSS v3.1-aligned: `network` / `adjacent` /
  `local` / `physical`); backfilled across the dethernety-module catalog
  (#89, #90)

### Platform — Chunked Archive Upload

- **Chunked archive upload backend** on the GraphQL API — `UploadSessionManager`
  (in-memory per-user session, 5-min TTL, sweeper) + reusable `importFromTarball`
  helper enables multi-megabyte module imports without raising the platform
  body-parser limit. Includes a `module-manager.sh export` subcommand to produce
  importable tarballs, plus `value_type` backfill on 32 guide entries (#99)

### Demo & Build

- Demo: clean up straggler containers and surface real MITRE ingest build
  errors (#98)

### Security & Dependencies

- Resolve `@apollo/federation-internals` prototype pollution (#80)
- Resolve remaining transitive dependency vulnerabilities (#75, #77, #78)
- Tighten `ajv` overrides; bump 33 dependencies (#74)
- Bump `hono` override to ≥4.12.7 (prototype pollution fix) (#55)
- Remove dead `apollo-server-express` (#75)
- `noauth` gate in module resolver wrapper; pass `configurable` to LangGraph (#72)
- Routine dependency sync — 2026-04-16 (#101)
- Bump safe minor/patch dependencies (#79)

## [0.1.3] - 2026-03-13

### Security

- Resolve 6 transitive dependency vulnerabilities via `pnpm.overrides`:
  - **serialize-javascript** (HIGH: RCE) — eliminated by upgrading webpack to
    >=5.105.4
  - **express-rate-limit** (HIGH: IPv4-mapped IPv6 rate-limit bypass) — bumped to
    >=8.2.2
  - **hono** (MEDIUM: prototype pollution) — bumped to >=4.12.7
  - **dompurify** (MEDIUM: XSS) — bumped to >=3.3.2
  - **file-type** (MEDIUM: infinite loop in ASF parser) — bumped to >=21.3.1
  - **ajv** (MEDIUM: ReDoS) — bumped to >=6.14.0

### Improvements

- Bump TypeScript target from ES2021 to ES2023 across all packages (dt-ws,
  dt-core, dt-module, dethernety-module)
- Add `{ cause: error }` to all catch-rethrow sites in dt-ws services for proper
  error cause chaining
- Re-enable ESLint 10 `preserve-caught-error` rule in dt-ws

### Dependencies

- Bump `vue-tsc` to 3.2.5
- Bump `@eslint/js` from 9.39.2 to 10.0.1
- Bump `@types/node` from 22.19.0 to 25.5.0

## [0.1.2] - 2026-03-13

### Apollo Client 4 Migration

- Upgrade `@apollo/client` from v3 to v4 across dt-ui, dt-core (22 data access
  classes), and dethereal
- Replace `onError` with `ErrorLink` class and `CombinedGraphQLErrors.is()`
  pattern
- Remove `NormalizedCacheObject` generic parameter (no longer needed in v4)
- Replace `@vue/apollo-composable` with minimal local shim (`apolloComposable.ts`)

### Remove Deprecated Plugins

- Remove `unplugin-vue-router`, `vite-plugin-pages`, `vite-plugin-vue-layouts`,
  `@types/vue`
- Replace with explicit route definitions in `router/index.ts` using
  `DefaultLayout` wrapper
- Update `unplugin-auto-import` to use `vue-router` instead of `vue-router/auto`

### UI Polish

- Add pointer cursor to clickable model name overlay on dataflow canvas
- Add pointer cursor to app bar logo/title

### Breaking Changes

- `dt-core` data access classes now accept `Apollo.ApolloClient` instead of
  `ApolloClient<NormalizedCacheObject>`

## [0.1.1] - 2026-03-04

### Added

- **Auth-less mode** — run Dethernety without an OIDC provider for local
  evaluation and demos
- **Demo environment** — one-command `demo.sh` script with Docker Compose
  (Memgraph + OPA + Dethernety)
- **Module manager CLI** — install, list, and remove modules from the command
  line
- **ZIP-based export/import** — export and import complete threat models as ZIP
  archives
- **Testing foundation** — test setup and initial test suites for dt-ui, dt-ws,
  and dethereal

### Fixed

- Exposure dialog compatibility with Neo4j GraphQL v7
- Model export/import round-trip bugs
- Analysis button now hidden when no analysis classes are available

### Changed

- Upgraded OPA SDK
- Removed automated Claude security review workflow
- Updated CLAUDE.md with corrected documentation references

## [0.1.0] - 2026-02-27

### Added

- **dt-ui**: Interactive threat modeling frontend with Vue 3, Vuetify, and Vue Flow
- **dt-ws**: NestJS backend with GraphQL API and graph database integration
- **dethereal**: Supplementary application
- **dt-core**: Shared TypeScript data access layer and core interfaces
- **dt-module**: Base classes and utilities for the extensible module system
- **dethernety-general**: Default threat modeling module with component classes, controls, and exposures
- **mitre-frameworks**: MITRE ATT&CK and D3FEND framework data and ingestion tooling
- **demo**: Docker Compose environment for quick local evaluation
- **Dockerfile.production**: Production-ready container image
- MITRE ATT&CK technique and mitigation mapping
- MITRE D3FEND defensive technique integration
- Drag-and-drop data flow diagram editor
- Security boundary and trust level modeling
- Exposure detection and risk scoring
- Control and countermeasure management
- Module-based extensibility system
- GraphQL API with real-time subscriptions
- OIDC/JWT authentication support

[0.8.0]: https://github.com/dether-net/dethernety-oss/compare/v0.7.0...v0.8.0
[0.7.0]: https://github.com/dether-net/dethernety-oss/compare/v0.6.1...v0.7.0
[0.6.1]: https://github.com/dether-net/dethernety-oss/compare/v0.6.0...v0.6.1
[0.6.0]: https://github.com/dether-net/dethernety-oss/compare/v0.5.0...v0.6.0
[0.5.0]: https://github.com/dether-net/dethernety-oss/compare/v0.4.0...v0.5.0
[0.4.0]: https://github.com/dether-net/dethernety-oss/compare/v0.3.0...v0.4.0
[0.3.0]: https://github.com/dether-net/dethernety-oss/compare/v0.2.1...v0.3.0
[0.2.1]: https://github.com/dether-net/dethernety-oss/compare/v0.2.0...v0.2.1
[0.2.0]: https://github.com/dether-net/dethernety-oss/compare/v0.1.3...v0.2.0
[0.1.3]: https://github.com/dether-net/dethernety-oss/compare/v0.1.2...v0.1.3
[0.1.2]: https://github.com/dether-net/dethernety-oss/compare/v0.1.1...v0.1.2
[0.1.1]: https://github.com/dether-net/dethernety-oss/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/dether-net/dethernety-oss/releases/tag/v0.1.0
