# Claude Design Brief

Project: Monad Agent Black Box

## Product Feeling

This is a flight recorder for autonomous on-chain agents.

It should feel like:

- incident command
- chain forensics
- agent observability
- high-trust infrastructure

It should not feel like:

- a generic AI chatbot
- a landing page
- a meme game
- a trading dashboard
- a SaaS marketing page

## Core Screen

Design one primary demo page with these zones:

1. Header
   - Product name: Agent Black Box
   - Session ID
   - Status: Running / Confirmed / Replayed
   - Monad testnet badge

2. Timeline
   - Dominant center column.
   - Events: goal, plan, simulation, risk rejection, policy approval, execution submitted, execution confirmed, summary.
   - Each event has role, timestamp, severity, and hash status.

3. Risk Debate Panel
   - Candidate A: rejected.
   - Candidate B: approved.
   - Reason codes should be scannable.
   - The rejected path must be visually memorable.

4. Proof Panel
   - Registry address.
   - Session ID.
   - Event count.
   - Content hash.
   - Final tx hash.
   - Explorer links.
   - Hash match indicator.

5. Trace Detail Drawer
   - Opens when clicking an event.
   - Shows concise explanation and raw JSON.
   - Shows hash comparison.

## Visual Direction

Use a restrained dark interface with sharp contrast and enough color to encode state.

Suggested palette:

- Background: near-black, not pure black.
- Panels: dark gray with subtle borders.
- Accent 1: electric green for verified/proved.
- Accent 2: amber for warnings.
- Accent 3: red for rejected/critical.
- Accent 4: Monad purple only as a supporting accent, not the whole palette.

Avoid:

- purple-blue gradient-heavy theme
- decorative orbs
- oversized hero copy
- nested cards inside cards
- large blocks of explanatory text

## Typography And Density

The audience is developers. Keep it dense but readable.

- Use compact headings.
- Use monospace for hashes and addresses.
- Use small status pills.
- Make long hashes copyable/truncated with tooltip.
- Keep all critical proof fields visible in the first viewport.

## Demo States

Design for these states:

1. Empty: "No session selected" with Run Demo button.
2. Running: events appear as pending/confirmed.
3. Complete: all proof fields verified.
4. Replay: shows a seeded trace with a replay badge.
5. Failure: RPC failed, but seeded replay is available.

## Required Copy

Short tagline:

> A flight recorder for autonomous on-chain agents.

Short proof copy:

> This trace payload hashes to the contentHash emitted by TraceRegistry on Monad testnet.

Short risk copy:

> The risk agent rejected this path before execution.

## Deliverables

- Primary desktop layout.
- Mobile fallback layout if time allows.
- Component styling guidance.
- Color/token suggestions.
- Any icons or visual metaphors needed for the implementation agent.

