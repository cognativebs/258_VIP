# Orchestr8 Master Prompt — VIP × VITURE Luma Ultra integrations v1.0

**Who runs this:** Orchestr8 Build Spec Council (authors the work order).  
**Who builds after emit:** Cursor (prototype only).  
**Who does not build in this run:** Orchestr8 agents (Autonomy 0 / ADR 0003).

Paste the fenced block in §2 into Orchestr8 Console → **Build Spec** → goal box.  
Team: **Build Spec Council** (`architect` → `domain_expert` → `tester` → `critic`).  
Do not switch to Analysis / Comics Ask for this run.

Official hardware name is **VITURE Luma Ultra** (operator notes said “Luna Ultra”).  
iPhone cable in notes = **USB-C XR Charging Adapter Ultra** (not Adapter Pro).

---

## 1. How to run

1. Gateway up: `GET http://127.0.0.1:5210/v1/health` → `ok: true`.
2. Console: `http://127.0.0.1:3001` → **Build Spec**.
3. AI team → preset **Build Spec Council** (critic stays on).
4. Paste §2. Run **Run Build Spec Council**.
5. If **VETOED**: **Revise from veto (1×)** only. If still blocked, stop — do not loop.
6. On emit: open the spec under `docs/specs/`, then paste `cursor_prompt` into Cursor for the **prototype**.

---

## 2. Paste this into the Build Spec goal

```
MASTER PROMPT — Orchestr8 authors a critic-passed v1.0 work order. Cursor will build a prototype from that emit. Autonomy 0: do not write or execute application code in this run.

TITLE TO EMIT: VIP × VITURE Luma Ultra integrations app v1.0 (prototype)

MISSION
Author ONE build_spec_v1 for a v1.0 prototype integrations FACE that shows VIP decisions on VITURE Luma Ultra glasses. IQVault (collector) and VaultOS (LGS) stay faces on the SAME VIP services — do not fork backend logic. Glasses chrome is NOT VIP core (ADR 0001: VIP never touches hardware glasses). Route the app as a new adapter/face that CONSUMES VIP typed contracts. Feature freeze is OFF; glasses are deferred in backlog — pickup via this Build Spec is allowed. Report the ADR 0001 routing in constraints; do not put glasses UI inside packages/intelligence or services/api business rules.

V1.0 SUCCESS (product, not a science project)
A critic-passed spec whose Cursor prompt builds a PROTOTYPE that:
1) Reads live VIP holdings/recommendations through existing APIs (no new market-price scalar columns).
2) Renders a glasses-safe HUD: huge type, 3–5 lines, one primary action (Buy / Hold / Grade / Sell / Lot / Pass) with confidence + reasons. No fake point prices — ranges + evidence count + recency + confidence.
3) Every derived field carries provenance (source, method, model/rule version, confidence, verification_status). Inferred grades stay "NM assumed · unverified".
4) Works with glasses UNPLUGGED via a mock host (operator can demo on a laptop window).
5) Documents the chosen v1 HOST PATH (one only) and why the others wait.

TEAM (this Orchestr8 run)
Council: build_spec. Pipeline: architect → domain_expert → tester → critic.
- Architect: schemas/contracts first, file plan grounded in REPO CONTEXT, acceptance tests, paste-ready cursor_prompt ≤ 2500 chars, JSON < ~6k tokens. Emit ```json with "schema":"build_spec_v1" FIRST. No markdown fences inside cursor_prompt.
- Domain Expert: enforce AGENTS.md + ADR 0001/0003. Preserve terms: asset, holding, priced_unit, sale, market_value, collection_hunt, external_id, assumed_grade.
- Tester: acceptance tests a human can run on Windows without the glasses attached; plus one test that names the mock host.
- Critic: veto on core-logic fork, invented Viture APIs, missing provenance, fake precision, scope that includes Neckband native Unity + AT&T provisioning + iPhone 6DoF in the same spec.

EXPECTATIONS
- Orchestr8 creates the SPEC (and a short follow-on slice list in risks/out_of_scope). Cursor builds the prototype later.
- v1.0 is a HUD + host adapter + mock. Not a shipping XR store, not camera card-ID, not POS.
- Do not invent Viture endpoints. Cite only operator research below. If an SDK binary is required, the spec must say "fetch at build time, never commit vendor blobs".
- No new Postgres tables/columns unless the spec names them and they are required for the prototype (prefer zero migrations).
- TCGplayer public API is closed — do not assume it.
- High-dollar recs remain critic-eligible; HUD must not auto-execute Buy/Sell.

WHAT WE ALREADY KNOW — CHATS (operator evidence, Aug 2026)
- Operator: Gregory Williamson, Windows (Greg_Admin), repo D:\Projects\Business_Ideas\258_Labs\258_VIP.
- Stack: VIP API :8787, Comics :5200, Orchestr8 gateway :5210, IQVault web :3000, Orchestr8 Console :3001, Binder :3010. Desktop Launch IQVault.bat starts the stack; one browser tab + Binder ↗ / Orchestr8 ↗ pop-outs.
- Orchestr8 is a separate Python process; keys only in orchestr8/.env. Health ok is "at least one provider key".
- Decisions over inventory. Raw imports immutable. Data sources are swappable adapters.
- Custom roles live in orchestr8/custom_agents/; named teams save as custom councils (unverified). Do not depend on those for this spec.
- Prior conclusion: Orchestr8 can AUTHOR a large hardware/software integration spec; it cannot DO the hardware work. Slice jobs. One veto revision.

WHAT WE ALREADY KNOW — VITURE PRODUCT RESEARCH (verify, do not expand)
Official product: VITURE Luma Ultra XR glasses (operator said "Luna Ultra"). No onboard battery; powered over USB-C / magnetic connector.
Sensors: front RGB camera + dual grayscale depth cameras (spatial / 6DoF / hands) — hardware present; software path depends on HOST.
SpaceWalker = Viture companion app (multi-screen, Immersive 3D). Developer portal: viture.com/developer (XR Glasses SDK for Win/Mac/Linux/Android; Unity XR SDK is Neckband-first).
Luma Ultra on Linux: older WebHID/One SDK does NOT work (Carina / USB control transfers; vendor IDs reported in the wild as 35ca:1104 glasses + 35ca:1102 mic). Do not spec a WebHID-only Luma path.

HOST OPTIONS — council MUST pick exactly one for v1.0 prototype file_plan. Others go to out_of_scope / later slices.

A) iPhone 15/16/17 + "iPhone Ultra cord"
   Hardware: USB-C XR Charging Adapter Ultra (or Mobile Dock Mini). Bundle exists as "Luma Ultra USB-C iPhone Pack Ultra".
   Software: SpaceWalker for iOS.
   Reality: 3DoF Pin Mode only. 6DoF and hand gestures are NOT supported on iOS today.
   Adapter Pro (older iPhone charger dongle): on Luma Ultra only AV + charge passthrough; immersive / 3DoF / OSD not supported. Do not spec Adapter Pro as the Luma Ultra iPhone path.
   iPhone 16e and iPhone Air: not compatible with XR glasses (vendor note).
   Verdict pressure: good for "phone as display + 3DoF pin" field glance; BAD as the 6DoF v1 host.

B) VITURE Pro Neckband
   Full 6DoF + hand gestures (latest firmware on glasses and neckband). Untethered spatial OS; phone can be Bluetooth trackpad/keyboard.
   Unity XR SDK + 6DoF + hand tracking is the real app platform.
   Verdict pressure: correct 6DoF product path; TOO LARGE for a first Cursor prototype (native Android/Unity, vendor SDK blobs). Candidate for v1.1+ after the HUD contract exists.

C) Windows (operator's daily machine) + SpaceWalker
   6DoF in SpaceWalker (virtual screens pinned in space). Gestures not yet on desktop SpaceWalker (vendor: coming).
   Glasses can also act as a USB-C monitor (no SDK) showing a browser HUD.
   Verdict pressure: best v1.0 prototype host — Greg already runs VIP here; mock + real window; no iPhone 6DoF lie.

D) Non-Apple phone + new dedicated AT&T line
   Android SpaceWalker: multi-screen / 3DoF-class phone use. Vendor: Android 6DoF "coming soon" — do not treat as shipping.
   Dedicated AT&T line is OPERATOR CONNECTIVITY (hotspot / separate work number / tethering), not an app feature. Spec may REQUIRE "reachable VIP base URL" and document tethering. Do not spec AT&T APIs, eSIM provisioning, or carrier account setup.
   Verdict pressure: optional field host after Windows HUD works; not v1.0 unless the council can justify it without 6DoF claims.

DEFAULT RECOMMENDATION (council may override with evidence):
v1.0 file_plan = Windows-first glasses HUD (Next or existing monorepo app) + HostAdapter interface (mock | spacewalker_window | future_neckband) + consume VIP API. iPhone Ultra-cord = documented 3DoF companion later. Neckband 6DoF/gestures = next slice. AT&T line = operator note only.

CONTRACTS FIRST (must appear in contracts_first)
- GlassesHudCard / GlassesHudAction zod: action enum Buy|Hold|Grade|Sell|Lot|Pass, confidence 0–1, reasons[], valueRange {low,high,currency} | null, evidenceCount, recency, provenance, verification_status.
- HostAdapter: { id, connected, dof: "none"|"3"|"6", gestures: boolean, pushHud(card), onIntent?(action) }.
- No decision-engine fork. Map existing recommendation payloads → HUD card. If VIP has no rec, HUD says insufficient evidence (not $0).

FILE PLAN HINTS (ground in repo; do not invent trees)
Prefer a new apps/* workspace (e.g. apps/glasses-hud or apps/vip-wear) OR a single /glasses route on iqvault-web if that is honestly smaller. packages/* only if a typed HUD contract must be shared. Do not modify vault_tcg or binder-vault. Do not add infra/db/migrations unless unavoidable — if you need one, STOP in the spec and say so rather than sneaking columns.

ACCEPTANCE TESTS (sharpen, keep runnable without hardware)
1) Mock host: open HUD, see a Pass/Hold card with provenance and a range or an honest "insufficient evidence".
2) Unplugged glasses: app still loads; host.connected false; no crash.
3) Mapping test: fixture VIP recommendation → HUD action + reasons; never a single point price presented as fact.
4) Spec text states chosen host path and explicitly lists iPhone-6DoF and AT&T-provisioning as out of scope if not chosen.

OUT OF SCOPE FOR THIS SPEC
Native Unity Neckband app; committing Viture SDK binaries; camera/CV card identification; POS; marketplace automation; eSIM/AT&T; iOS 6DoF; WebHID Luma driver; forking IQVault/VaultOS backends; silent grade fill-in.

OUTPUT
One critic-passed build_spec_v1. cursor_prompt is the only thing Cursor needs to start the prototype. Add 3–6 named follow-on slice titles in out_of_scope (Neckband 6DoF, iPhone 3DoF pin, Android field host, etc.) — titles only, no second full spec.
```

---

## 3. After Orchestr8 emits

Cursor should receive **only** the emitted `cursor_prompt` (plus the spec markdown).  
Do not paste this master prompt into Cursor as the build brief — it is too large and will sprawl past v1.0.