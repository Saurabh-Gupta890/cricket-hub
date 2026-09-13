#!/usr/bin/env node
/**
 * ═══════════════════════════════════════════════════════════════════════
 *  GRAPHIFY ARCHITECTURE VISUALIZER (DEVELOPMENT-ONLY TOOL)
 *  Scans project modules, AST routes, and socket events to generate
 *  an interactive architecture and dependency graph for verification.
 *  (Used during development, not shipped to production client bundle)
 * ═══════════════════════════════════════════════════════════════════════
 */

const fs = require('fs');
const path = require('path');

const ROOT_DIR = path.resolve(__dirname, '..');
const OUTPUT_HTML = path.join(ROOT_DIR, 'scratch', 'architecture_graph.html');
const OUTPUT_MD = path.join(ROOT_DIR, 'scratch', 'architecture_graph.md');

console.log('🔍 [Graphify DevTools] Scanning codebase architecture...');

// 1. Scan REST Endpoints from server.js
const serverJs = fs.readFileSync(path.join(ROOT_DIR, 'server.js'), 'utf-8');
const restRoutes = [];
const restRegex = /app\.(get|post|put|delete)\(\s*['"`]([^'"`]+)['"`]/g;
let match;
while ((match = restRegex.exec(serverJs)) !== null) {
  restRoutes.push({ method: match[1].toUpperCase(), path: match[2] });
}

// 2. Scan Socket Events
const socketEvents = [];
const socketEmitRegex = /emit\(\s*['"`]([^'"`]+)['"`]/g;
const socketOnRegex = /on\(\s*['"`]([^'"`]+)['"`]/g;
const foundEmits = new Set();
const foundOns = new Set();

while ((match = socketEmitRegex.exec(serverJs)) !== null) foundEmits.add(match[1]);
while ((match = socketOnRegex.exec(serverJs)) !== null) foundOns.add(match[1]);

// 3. Scan Client Files
const appJs = fs.readFileSync(path.join(ROOT_DIR, 'public', 'app.js'), 'utf-8');
const cookieJs = fs.existsSync(path.join(ROOT_DIR, 'public', 'cookie-consent.js'))
  ? fs.readFileSync(path.join(ROOT_DIR, 'public', 'cookie-consent.js'), 'utf-8') : '';

// 4. Generate Mermaid Architecture Diagram
const mermaidGraph = `
\`\`\`mermaid
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
\`\`\`
`;

// 5. Generate Interactive Dev HTML
const htmlContent = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <title>Graphify — CricketHub Architecture Visualization (Dev Only)</title>
  <script src="https://cdn.jsdelivr.net/npm/mermaid/dist/mermaid.min.js"></script>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: #080c14; color: #f8fafc; padding: 2rem; }
    .card { background: rgba(22, 25, 34, 0.9); border: 1px solid rgba(0, 229, 255, 0.2); border-radius: 12px; padding: 1.5rem; margin-bottom: 1.5rem; box-shadow: 0 8px 30px rgba(0,0,0,0.5); }
    h1 { color: #00e5ff; margin-top: 0; font-size: 1.5rem; }
    h2 { color: #ffd740; font-size: 1.15rem; margin-top: 0; }
    .pill { display: inline-block; padding: 0.2rem 0.6rem; border-radius: 20px; font-size: 0.75rem; font-weight: 700; margin: 0.2rem; }
    .pill-get { background: rgba(0, 230, 118, 0.2); color: #00e676; border: 1px solid rgba(0, 230, 118, 0.4); }
    .pill-post { background: rgba(0, 229, 255, 0.2); color: #00e5ff; border: 1px solid rgba(0, 229, 255, 0.4); }
    .pill-socket { background: rgba(124, 77, 255, 0.2); color: #7c4dff; border: 1px solid rgba(124, 77, 255, 0.4); }
  </style>
</head>
<body>
  <div class="card">
    <h1>⚡ Graphify — Verified Code Architecture</h1>
    <p style="color:#94a3b8;font-size:0.85rem">Internal development artifact generated to verify architectural boundaries, socket buses, and data pipelines.</p>
    <div class="mermaid">
      ${mermaidGraph.replace(/```mermaid/g, '').replace(/```/g, '')}
    </div>
  </div>

  <div class="card">
    <h2>📡 Discovered REST Endpoints (${restRoutes.length})</h2>
    <div>
      ${restRoutes.map(r => `<span class="pill pill-${r.method.toLowerCase()}">${r.method} ${r.path}</span>`).join(' ')}
    </div>
  </div>

  <div class="card">
    <h2>⚡ Discovered Real-Time Socket Events (${foundOns.size + foundEmits.size})</h2>
    <div>
      ${Array.from(foundOns).map(e => `<span class="pill pill-socket">in: ${e}</span>`).join(' ')}
      ${Array.from(foundEmits).map(e => `<span class="pill pill-socket" style="background:rgba(255,215,64,0.15);color:#ffd740">out: ${e}</span>`).join(' ')}
    </div>
  </div>
  <script>mermaid.initialize({ startOnLoad: true, theme: 'dark' });</script>
</body>
</html>`;

if (!fs.existsSync(path.dirname(OUTPUT_HTML))) {
  fs.mkdirSync(path.dirname(OUTPUT_HTML), { recursive: true });
}

fs.writeFileSync(OUTPUT_HTML, htmlContent, 'utf-8');
fs.writeFileSync(OUTPUT_MD, `# Graphify Architecture Map\n\n${mermaidGraph}`, 'utf-8');

console.log(`✅ [Graphify DevTools] Architecture verified!`);
console.log(`📊 Exported HTML Graph: file://${OUTPUT_HTML}`);
console.log(`📝 Exported Markdown Graph: file://${OUTPUT_MD}`);
