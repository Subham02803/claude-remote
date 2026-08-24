# Claude Remote — Product Scope & Use Cases

**Status:** Draft v1 (discovery)
**Date:** 2026-08-24
**Owner:** Subham Biswas

> This document is deliberately non-technical. It describes *what* the product is for,
> *who* uses it, and *what they need to be able to do* — not how it is built.

---

## 1. The Problem

I run Claude on my own machine to work on my projects. That machine is powerful,
already set up, and has all my code, credentials and context on it.

The problem is that **Claude only works when I am physically sitting in front of that
machine.** The moment I step out — a commute, an errand, a meeting, lunch, a walk, an
evening out — the machine goes idle. Claude stops not because the work is done, but
because there is nobody there to type the next prompt, answer a question, or approve
an action.

Two distinct losses happen:

1. **Idle time.** Hours where my machine could have been making progress but wasn't.
2. **Stalled runs.** Claude is *mid-task*, hits a question or a permission prompt, and
   then just waits — sometimes for hours — for a one-word answer I could have given
   from my phone in three seconds.

## 2. The Product, in One Sentence

A private, secure web app that lets me **drive Claude on my own machine from any
browser, anywhere** — start work, watch it happen, answer its questions, and collect
the results — without needing to be at the desk.

## 3. Product Principles

These are the tie-breakers when scope decisions get hard.

| # | Principle | What it means in practice |
|---|-----------|---------------------------|
| P1 | **My machine stays the brain** | The work happens on my own machine, with my code and my setup. The web app is a remote control, not a replacement environment. |
| P2 | **Never lose a session** | Closing the browser, losing signal, or switching devices must never kill work in progress. |
| P3 | **Unblocking is the killer feature** | Answering a question or approving an action must be effortless — ideally one tap. |
| P4 | **Private by default** | This is a door into my personal machine. Nobody else gets in, ever, unless I explicitly say so. |
| P5 | **Phone-first, not phone-tolerated** | Most away-from-desk moments happen on a phone. The small screen is the primary design target. |
| P6 | **Honest about state** | I must always be able to tell, at a glance, whether Claude is working, waiting on me, finished, or broken. |

## 4. Who Uses It

### Primary persona — "Me, away from the desk" (the only persona for v1)
- Owns the machine, owns the projects, trusts Claude with them already.
- Technically expert; does **not** need hand-holding or explanations.
- Often on a phone, on mobile data, with one hand free and 2 minutes of attention.
- Wants **throughput**, not a beautiful IDE.

### Secondary persona — "Me, on a different computer"
- Laptop at a café, a borrowed desktop, a work machine.
- Wants the full experience: real typing, real reading, reviewing diffs properly.

### Deferred persona — "A teammate or collaborator" (explicitly out of v1)
- Someone I want to give limited, temporary, observed access to.
- Noted only so that v1 decisions don't make this impossible later.

## 5. Scope

### 5.1 In Scope (v1 — the thing worth building)

**Access & Trust**
- Open a browser anywhere, sign in securely, reach my machine.
- Strong login, second factor, and a session that stays alive on a trusted device so I
  am not re-authenticating in a taxi.
- See every device/session that currently has access.
- Revoke any device instantly. A single "cut all access now" action.

**Running Work**
- Send a prompt to Claude on my machine and have it start immediately.
- Watch the response stream in live, as it happens.
- Interrupt / stop a run that is going the wrong way.
- Answer Claude's clarifying questions.
- Approve or deny Claude's permission requests (the file it wants to write, the command
  it wants to run) with clear one-tap controls.

**Not Losing Anything**
- Close the browser mid-run; the work keeps going on my machine.
- Come back later and see everything that happened while I was gone.
- Full scrollback history for each conversation.
- Reconnect after signal loss and land back where I was, not at a blank screen.
- Pick up on my laptop a session I started on my phone.

**Working Across Projects**
- Several projects available; choose which one a prompt runs against.
- More than one session running at the same time, without them interfering.
- A clear overview: which sessions exist, which project each is on, what each is doing
  right now.

**Being Told Things**
- Get notified when a run finishes.
- Get notified — more loudly — when Claude is **blocked waiting on me**.
- Get notified when something failed.
- Notifications that reach me when the browser is closed.

**Reviewing Output**
- Read what Claude wrote back, formatted properly (code, lists, tables).
- See which files were changed and what changed in them.
- Enough context to decide "good, continue" vs "no, stop" without opening a laptop.

**Phone Ergonomics**
- Comfortable reading and scrolling on a small screen.
- Reduced typing: saved/reusable prompts, recent prompts, quick replies.
- Big, unambiguous, hard-to-mis-tap approve/deny controls.

### 5.2 In Scope (v1.5 — fast follow, likely wanted within weeks)

- **Prompt queue:** line up several prompts to run one after another, so the machine has
  hours of work rather than minutes.
- **Prompt library:** saved, named, reusable prompts for the things I ask repeatedly.
- **Scheduled runs:** "start this at 9am", "run this every night".
- **Voice input:** speak the prompt instead of typing it on a phone keyboard.
- **Usage visibility:** rough sense of how much has been consumed today / this session,
  so a runaway loop doesn't burn a budget unnoticed.
- **Activity log:** a plain record of what was run, by which device, and when.

### 5.3 Later / Nice to Have

- Sharing a read-only view of a session with someone else.
- Limited guest access for a collaborator, time-boxed and revocable.
- Comparing/reviewing changes more richly before accepting them.
- Installable, app-like experience with offline reading of past sessions.
- Reaching more than one machine (e.g. desktop at home *and* a server).

### 5.4 Explicitly Out of Scope

Naming these protects the v1 from bloating into a product it isn't.

- **Not a hosted Claude service.** It does not run Claude in the cloud on my behalf.
- **Not a full IDE.** No pretending to be a browser code editor with a file tree,
  refactoring, and language servers.
- **Not a team collaboration platform.** No org accounts, roles, billing, seats.
- **Not a public/multi-tenant product.** Personal tool first; commercialisation is a
  separate conversation, not a v1 requirement.
- **Not a general remote desktop.** It exposes Claude, not my whole machine.
- **Not a project management tool.** No tickets, boards, or sprint tracking.

## 6. Use Cases

Ordered roughly by how much value they deliver.

### UC-1 — Unblock a waiting run *(highest value)*
Claude has been working for 20 minutes and now needs a yes/no. I am on a bus. I get a
notification, open the app, read the one-line question, tap **Approve**, and the machine
carries on. Elapsed time: 15 seconds.

### UC-2 — Start work while away
I think of the next thing to do while walking. I open the app, pick the project, send the
prompt, and put my phone away. By the time I'm home, it's done.

### UC-3 — Check in on a long run
I kicked off something big before leaving. Every so often I glance at the app to confirm
it is still progressing sensibly, and that it hasn't gone off the rails.

### UC-4 — Stop something going wrong
I look at the stream and see Claude heading down a bad path. I stop it immediately,
rather than coming home to an hour of wasted work I have to unpick.

### UC-5 — Keep the machine busy for hours
Before going out for the evening, I queue several independent prompts. The machine works
through them sequentially instead of idling. *(v1.5)*

### UC-6 — Answer a clarifying question
Claude asks which of two approaches I want. I reply in one short sentence from my phone
and it proceeds with the right one, instead of guessing wrong or waiting.

### UC-7 — Review results before I get back
On the train home I read through what was done, skim the changed files, and decide what
the next prompt should be. I arrive at my desk already knowing my next move.

### UC-8 — Device handoff
I start a session on my phone at a café, then continue it on my laptop when I sit down —
same conversation, same context, nothing retyped.

### UC-9 — Survive a bad network
The signal drops in a lift or a tunnel. When it returns, the app reconnects and shows me
everything I missed. Nothing was lost, nothing was duplicated.

### UC-10 — Run parallel work on different projects
Project A is compiling/running something slow while I have Claude start on Project B.
Two sessions, one overview screen, no confusion about which is which.

### UC-11 — Repeat a routine prompt
The prompt I run every morning is saved. Two taps to fire it, no retyping. *(v1.5)*

### UC-12 — Emergency lockout
I lose my phone. From any other browser I revoke every session and cut all access to my
machine immediately.

### UC-13 — See what happened overnight
A scheduled run executed at 6am. I wake up, open the app, and read the summary of what
Claude did while I slept. *(v1.5)*

### UC-14 — Catch a failure early
A run dies because something on the machine broke. I am told promptly, with enough detail
to know whether it's worth trying again or needs me physically present.

## 7. Key User Journeys

**J1 — First-time setup (once)**
Get the machine connected → sign in from a browser → confirm I can see my projects → run
a trivial prompt end to end → trust established.

**J2 — The 30-second unblock (many times a day)**
Notification → open → read question → tap answer → close. Must feel instant.

**J3 — Fire and forget (daily)**
Open → pick project → prompt → confirm it started → leave. Return later to results.

**J4 — The commute review (daily)**
Open → see all sessions and their states → read through the finished one → send the
follow-up prompt → arrive home with momentum.

## 8. What "Good" Looks Like (Success Criteria)

Written as outcomes, not metrics to game.

- **Idle time collapses.** My machine works during hours it used to sit still.
- **Blocked time collapses.** A question from Claude is answered in seconds, not hours.
- **I stop hurrying home.** Being away no longer means work stops.
- **I actually trust it.** I use it on real projects, not just toy prompts — because I am
  confident nobody else can get in and nothing gets silently lost.
- **The phone experience doesn't annoy me.** I reach for it by choice, not as a
  last resort.
- **Nothing is ever lost.** Zero incidents of "I lost a session / lost the output".

## 9. Non-Functional Expectations (in plain language)

- **Security is the feature, not a checkbox.** This is remote access to my personal
  machine. A breach here is worse than a broken feature. Locked down by default,
  everything revocable, no accidental public exposure.
- **Feels live.** Output appears as it is produced. A visible lag makes the whole thing
  feel dead and untrustworthy.
- **Honest state.** Working / waiting-on-me / done / failed must never be ambiguous.
- **Forgiving of bad connections.** Mobile data, lifts, trains, hotel wifi.
- **Durable.** Survives browser close, tab close, phone sleep, and reboots of the app
  itself.
- **Low ceremony.** From "phone in pocket" to "prompt sent" in under a minute.

## 10. Risks & Concerns

| Risk | Why it matters | Early stance |
|------|----------------|--------------|
| Remote access to a personal machine | Worst-case outcome of a mistake is severe | Treat security as a v1 blocker, not a v2 hardening pass |
| Approving actions without full context | On a phone I might approve something I'd have questioned at a desk | Show clearly *what* is being approved; make deny the easy, safe option |
| Runaway runs burning time or budget | Nobody is watching for long stretches | Notifications on completion/failure; usage visibility early; easy stop |
| Notification fatigue | If everything pings, I ignore all of it | Only two things must interrupt me: **blocked** and **failed** |
| Phone typing friction | Long prompts on a phone are miserable | Saved prompts, recent prompts, voice input |
| Feature creep into "browser IDE" | Would sink the project | The Out of Scope list is binding |
| The machine is off or asleep | Nothing works | Make this state obvious and explain it, rather than showing a mysterious error |

## 11. Open Questions

To resolve before scoping the build.

1. **How many projects** realistically need to be reachable — 2–3, or a whole folder of them?
2. **How many concurrent sessions** do I actually want at once? (Affects the whole overview UI.)
3. **Approval posture:** do I want to approve every action remotely, or pre-authorise
   certain categories so runs don't stall on routine things?
4. **Notification channel:** browser/push, or something I already watch (phone, chat app,
   email)? What is the one channel I will genuinely not ignore?
5. **Is anyone else ever getting access?** Even "maybe, read-only, one day" changes v1
   decisions. A hard "no, ever" simplifies a lot.
6. **How much output review** do I need on a phone — just the summary, or real file-level
   review?
7. **Does this ever become a product** for other people, or is it permanently a personal
   tool?
8. **What happens to a run when I am unreachable for hours** — should it wait
   indefinitely, time out, or proceed on a safe default?

## 12. Next Step

Confirm/correct the scope above (especially §5.4 and §11), then produce:
- a prioritised feature list for v1,
- screen-by-screen UX flows for the four key journeys in §7.

Only after that does any technical design begin.
