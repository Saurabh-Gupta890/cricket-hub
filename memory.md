# 🧠 CricketHub — Project Memory & Decision Log

This memory document tracks key architectural decisions, resolved issues, regression pitfalls, and repository invariants.

---

## 1. Core Repository Invariants

1. **Dual-Mode Persistence**:
   - Always retain atomic JSON file backup in `data/` even when MongoDB Cloud is active.
   - Never clear user store, room store, or match history on server restarts.
2. **Participant vs. Host Permission Rules**:
   - Only the **Host** can toggle Quiet Alerts, remove players from rooms, set/reschedule match dates, and delete chat messages/announcements.
   - **Participants** can ping other individual teammates when Quiet Alerts is OFF, vote availability, and chat.
   - When **Quiet Alerts is ON**, pings and alerts are blocked for **ALL** users (host and players alike).
3. **Real-time Chat Ingestion**:
   - `socket.on('chat:message')` MUST push incoming message objects directly to `state.room.match.chat` on the client before re-rendering to guarantee instant ~8ms display without requiring page refreshes.
4. **Never-Get-Hacked Security**:
   - All REST and socket inputs must pass through `src/utils/validator.js` (strict reject with HTTP 400).
   - Auth endpoints must check `checkAuthRateLimit` with exponential backoff on invalid OTPs.
   - Stack traces and database errors must never leak to client responses.

---

## 2. Resolved Pitfalls & Fix History

| Component | Pitfall | Permanent Resolution |
| :--- | :--- | :--- |
| **Mobile RSVP Card** | Action buttons in top row caused player name & live badge to get clipped on small phone screens. | Separated buttons into dedicated `.rsvp-card-actions` row underneath player header. |
| **Chat Latency** | Client socket listener was re-rendering from room state without appending the new message, requiring refresh. | Added local array append with deduplication inside `socket.on('chat:message')`. |
| **Quiet Mode Gating** | Broadcast alerts were still firing when quiet alerts was enabled. | Server rejects nudge and broadcast calls with `{ quiet: true }` when `room.quietAlerts` is true. |
| **DPDP Compliance** | Tracking scripts firing without user knowledge. | Built opt-in cookie consent banner with granular categories and zero tracking before affirmative consent. |
