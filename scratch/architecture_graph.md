# Graphify Architecture Map


```mermaid
graph LR
    subgraph Client [Client UI Layer (21st.dev)]
        Landing[Screen: Auth & Landing]
        Planning[Screen: Planning & RSVP]
        Lobby[Screen: Match Lobby & Setup]
        Scoring[Screen: Ball-by-Ball Live]
        History[Screen: Match History]
        CookieWidget[Cookie Consent Widget (DPDP)]
    end

    subgraph Gateway [Security & Gateway Layer]
        SecRate[Rate Limiter & Exponential Backoff]
        SecVal[Strict Schema Validator]
        SecErr[Zero-Info Leakage Error Handler]
    end

    subgraph SocketBus [Socket.io Real-Time Pipeline]
        RoomSync[Room & Planning State Sync]
        ChatSync[Live Chat & Announcements (8ms)]
        ScoreSync[Ball-by-Ball Score Engine]
        AlertBus[Direct Ping & Quiet Mode Router]
    end

    subgraph Storage [Dual-Mode Storage Engine]
        MongoCloud[(MongoDB Atlas Cloud)]
        LocalJson[(Atomic Local JSON Store)]
    end

    Landing -->|POST /api/auth/*| SecRate --> SecVal --> RoomSync
    Planning -->|Socket: planning:*| AlertBus & ChatSync
    Lobby -->|Socket: room:*| RoomSync
    Scoring -->|Socket: match:*| ScoreSync
    CookieWidget -->|Opt-in Callbacks| Client
    RoomSync & ChatSync & ScoreSync --> Storage
    Storage --> MongoCloud & LocalJson
```
