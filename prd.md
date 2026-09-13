# 🏏 CricketHub — Product Requirements Document (PRD)

**Product Name:** CricketHub  
**Version:** 3.0.0 (Enterprise & Privacy-Ready)  
**Status:** Active Production  
**Compliance Standards:** India Digital Personal Data Protection (DPDP) Act 2023, GDPR, WCAG 2.1 AA  

---

## 1. Executive Summary & Vision

CricketHub is a high-performance, real-time Progressive Web Application (PWA) designed for local cricket clubs, weekend teams, and tournament organizers. It unifies match availability polling (RSVP), captaincy squad management, real-time ball-by-ball scorekeeping, interactive squad synergy analytics (Graphify/Context7), and push notifications into a mobile-first, privacy-compliant platform.

---

## 2. Target Personas

| Persona | Role | Key Pain Points & Needs |
| :--- | :--- | :--- |
| **Team Captain (Host)** | Organizes matches & squads | Needs quick match creation, player RSVP tracking, lockscreen push notifications, date/time rescheduling, and moderation controls. |
| **Squad Player** | Confirms availability & chats | Needs one-tap RSVP (Coming, Maybe, Can't Come), instant real-time chat, profile customization, and lockscreen alert pings. |
| **Live Scorer / Umpire** | Scores the match ball-by-ball | Needs rapid one-thumb score entry, undo capability, automatic strike rotation, extras (wide, no-ball, bye), wagon wheel, and scorecard export. |
| **Viewer / Fan** | Watches match live | Needs real-time live score updates via WebSockets without manual page refreshes. |

---

## 3. Core Functional Requirements

### 3.1. Authentication & Session Management
- **Phone Number OTP Login / Signup**: Passwordless login with cryptographic 6-digit OTPs.
- **Session Persistence**: 365-day persistent session token synced across browser storage and HTTP-only cookies.
- **Rate-Limiting & Exponential Backoff**: Per-IP and per-account rate limits with exponential backoff on repeated failures.

### 3.2. Match Planning & RSVP Availability
- **Room Code Sharing**: Unique 4-character room codes (`CRK-XXXX`) with one-click clipboard share and deep link support.
- **Four-State Availability**: Confirmed (`Coming`), Tentative (`Maybe`), Unavailable (`Can't Come`), and `Pending`.
- **Live Online Presence**: Real-time indication of who is `Live Now 🟢` vs `Offline ⚪`.
- **Squad Pings & Quiet Mode**: Direct participant-to-participant pings; host-controlled "Quiet Alerts for All" toggle to pause all notifications.

### 3.3. Cricket Squads & Groups
- **Private Squad Rosters**: Persistent squad groups with unique squad codes (`GRP-XXXX`).
- **Captain Delegation**: Captains can add teammates, assign roles (`Captain`, `Batter`, `Bowler`, `All-Rounder`), and link squads to matches.

### 3.4. Graphify & Context7 Squad Intelligence
- **Force-Directed Synergy Graph**: Interactive Canvas visualization of teammates, roles, and partnership synergy scores.
- **Context7 Match HUD**: Real-time balance index, win forecast calculations, and squad readiness radar.

### 3.5. Live Ball-by-Ball Scorekeeping
- **Ball Outcomes**: Runs (0, 1, 2, 3, 4, 6), Wickets (Bowled, Caught, LBW, Run Out, Stumped, Hit Wicket), Extras (Wide, No Ball + Free Hit, Bye, Leg Bye, Penalty).
- **Match Engine**: Automatic strike rotation, over completion detection, bowler spell limits, innings changeover, super overs, and wagon wheel shot tracking.

---

## 4. Privacy & DPDP Act 2023 / GDPR Compliance

1. **Explicit Opt-in Cookie Consent**:
   - Zero non-essential cookies loaded prior to affirmative user consent.
   - Granular category toggles: **Essential** (Always On), **Analytics**, **Marketing/Targeting**.
   - Persistent "Cookie Settings" floating badge for instant consent withdrawal.
2. **Data Principal Rights (DPDP Act 2023 §11–13)**:
   - Right to Access summary of personal data.
   - Right to Correction and Erasure of player profile.
   - Right to Grievance Redressal and Consent Withdrawal.
3. **Data Fiduciary Notice (§5)**:
   - Clear disclosure of data collected (Phone number, display name, avatar, match scores).
   - Strict purpose limitation (match coordination only, no 3rd-party data selling).

---

## 5. Non-Functional & Security Requirements

- **Lighthouse Scores**: 95+ across Performance, Accessibility, Best Practices, and SEO.
- **Zero Information Leakage**: Server errors sanitized; internal file paths and stack traces suppressed in client responses.
- **Mobile Ergonomics**: 44px+ touch targets, single-hand thumb navigation, safe-area inset support (`env(safe-area-inset-bottom)`).
