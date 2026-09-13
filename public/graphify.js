/**
 * ═══════════════════════════════════════════════════════════════════════
 *  GRAPHIFY & CONTEXT7 — SQUAD RELATIONSHIP & MATCH INTELLIGENCE ENGINE
 *  Interactive force-directed synergy network & contextual match analytics
 * ═══════════════════════════════════════════════════════════════════════
 */

(function () {
  'use strict';

  class GraphifySquadNetwork {
    constructor(canvasId) {
      this.canvas = document.getElementById(canvasId);
      if (!this.canvas) return;
      this.ctx = this.canvas.getContext('2d');
      this.nodes = [];
      this.links = [];
      this.selectedNode = null;
      this.hoveredNode = null;
      this.draggingNode = null;
      this.activeFilter = 'all';
      this.animFrame = null;
      this.width = this.canvas.width = this.canvas.offsetWidth || 360;
      this.height = this.canvas.height = this.canvas.offsetHeight || 300;
      this.scale = 1;
      this.panX = 0;
      this.panY = 0;

      this.initEvents();
    }

    initEvents() {
      if (!this.canvas) return;

      const getPos = (e) => {
        const rect = this.canvas.getBoundingClientRect();
        const clientX = e.touches ? e.touches[0].clientX : e.clientX;
        const clientY = e.touches ? e.touches[0].clientY : e.clientY;
        return {
          x: (clientX - rect.left - this.panX) / this.scale,
          y: (clientY - rect.top - this.panY) / this.scale
        };
      };

      const onPointerDown = (e) => {
        const pos = getPos(e);
        const hit = this.getNodeAt(pos.x, pos.y);
        if (hit) {
          this.draggingNode = hit;
          this.selectedNode = hit;
          this.updateNodeInspector(hit);
        }
      };

      const onPointerMove = (e) => {
        const pos = getPos(e);
        if (this.draggingNode) {
          this.draggingNode.x = pos.x;
          this.draggingNode.y = pos.y;
          this.draggingNode.vx = 0;
          this.draggingNode.vy = 0;
        } else {
          const hit = this.getNodeAt(pos.x, pos.y);
          this.hoveredNode = hit;
          this.canvas.style.cursor = hit ? 'pointer' : 'default';
        }
      };

      const onPointerUp = () => {
        this.draggingNode = null;
      };

      this.canvas.addEventListener('mousedown', onPointerDown);
      this.canvas.addEventListener('mousemove', onPointerMove);
      window.addEventListener('mouseup', onPointerUp);

      this.canvas.addEventListener('touchstart', onPointerDown, { passive: true });
      this.canvas.addEventListener('touchmove', onPointerMove, { passive: true });
      window.addEventListener('touchend', onPointerUp, { passive: true });

      window.addEventListener('resize', () => {
        this.resize();
      });
    }

    resize() {
      if (!this.canvas) return;
      const rect = this.canvas.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) {
        this.width = this.canvas.width = rect.width;
        this.height = this.canvas.height = rect.height;
      }
    }

    setFilter(filter) {
      this.activeFilter = filter;
      const filterBtns = document.querySelectorAll('.graph-filter-btn');
      filterBtns.forEach(btn => {
        if (btn.getAttribute('data-filter') === filter) {
          btn.classList.add('active');
        } else {
          btn.classList.remove('active');
        }
      });
    }

    buildFromSquad(members, groupName = 'Cricket Squad') {
      this.resize();
      const rawMembers = Array.isArray(members) ? members : Object.values(members || {});
      if (rawMembers.length === 0) {
        this.nodes = [];
        this.links = [];
        return;
      }

      const centerX = this.width / 2;
      const centerY = this.height / 2;
      const count = rawMembers.length;

      this.nodes = rawMembers.map((m, idx) => {
        const angle = (idx / Math.max(1, count)) * 2 * Math.PI;
        const radius = Math.min(this.width, this.height) * 0.32;
        const isCaptain = m.role === 'captain' || m.isHost;
        const role = m.role || (isCaptain ? 'Captain' : 'All-Rounder');

        return {
          id: m.phone || m.name || `node_${idx}`,
          name: m.name || 'Player',
          role: role,
          isCaptain: !!isCaptain,
          isOnline: !!m.isOnline,
          color: m.color || '#00e5ff',
          avatar: m.avatar || '🏏',
          x: isCaptain ? centerX : centerX + radius * Math.cos(angle) + (Math.random() - 0.5) * 20,
          y: isCaptain ? centerY : centerY + radius * Math.sin(angle) + (Math.random() - 0.5) * 20,
          vx: 0,
          vy: 0,
          radius: isCaptain ? 24 : 18,
          synergy: Math.floor(75 + Math.random() * 24)
        };
      });

      // Connect nodes to captain and nearest peers
      this.links = [];
      const captain = this.nodes.find(n => n.isCaptain) || this.nodes[0];
      for (let i = 0; i < this.nodes.length; i++) {
        const a = this.nodes[i];
        if (captain && a !== captain) {
          this.links.push({ source: captain, target: a, strength: 0.8, type: 'captain' });
        }
        // Connect to sequential peer for perimeter ring
        const next = this.nodes[(i + 1) % this.nodes.length];
        if (next && next !== a && next !== captain && a !== captain) {
          this.links.push({ source: a, target: next, strength: 0.4, type: 'peer' });
        }
      }

      this.startSimulation();
      this.updateContext7Intelligence(this.nodes, groupName);
    }

    startSimulation() {
      if (this.animFrame) cancelAnimationFrame(this.animFrame);
      const step = () => {
        this.updatePhysics();
        this.render();
        this.animFrame = requestAnimationFrame(step);
      };
      step();
    }

    stopSimulation() {
      if (this.animFrame) cancelAnimationFrame(this.animFrame);
    }

    updatePhysics() {
      const centerX = this.width / 2;
      const centerY = this.height / 2;

      // Spring Link forces
      for (const link of this.links) {
        const dx = link.target.x - link.source.x;
        const dy = link.target.y - link.source.y;
        const dist = Math.sqrt(dx * dx + dy * dy) || 1;
        const targetDist = link.type === 'captain' ? 90 : 70;
        const force = (dist - targetDist) * 0.02 * (link.strength || 0.5);
        const fx = (dx / dist) * force;
        const fy = (dy / dist) * force;

        if (link.source !== this.draggingNode && !link.source.isCaptain) {
          link.source.vx += fx;
          link.source.vy += fy;
        }
        if (link.target !== this.draggingNode && !link.target.isCaptain) {
          link.target.vx -= fx;
          link.target.vy -= fy;
        }
      }

      // Node repulsion forces
      for (let i = 0; i < this.nodes.length; i++) {
        for (let j = i + 1; j < this.nodes.length; j++) {
          const a = this.nodes[i];
          const b = this.nodes[j];
          const dx = b.x - a.x;
          const dy = b.y - a.y;
          const dist = Math.sqrt(dx * dx + dy * dy) || 1;
          const minDist = (a.radius + b.radius) * 2.2;
          if (dist < minDist) {
            const force = (minDist - dist) * 0.05;
            const fx = (dx / dist) * force;
            const fy = (dy / dist) * force;
            if (a !== this.draggingNode) { a.vx -= fx; a.vy -= fy; }
            if (b !== this.draggingNode) { b.vx += fx; b.vy += fy; }
          }
        }
      }

      // Centering & Damping
      for (const node of this.nodes) {
        if (node === this.draggingNode) continue;
        if (node.isCaptain) {
          node.vx += (centerX - node.x) * 0.08;
          node.vy += (centerY - node.y) * 0.08;
        } else {
          node.vx += (centerX - node.x) * 0.01;
          node.vy += (centerY - node.y) * 0.01;
        }

        node.vx *= 0.85;
        node.vy *= 0.85;
        node.x += node.vx;
        node.y += node.vy;

        // Boundary bounce
        const pad = node.radius + 6;
        if (node.x < pad) { node.x = pad; node.vx *= -0.5; }
        if (node.x > this.width - pad) { node.x = this.width - pad; node.vx *= -0.5; }
        if (node.y < pad) { node.y = pad; node.vy *= -0.5; }
        if (node.y > this.height - pad) { node.y = this.height - pad; node.vy *= -0.5; }
      }
    }

    getNodeAt(x, y) {
      for (let i = this.nodes.length - 1; i >= 0; i--) {
        const node = this.nodes[i];
        if (!this.matchesFilter(node)) continue;
        const dx = node.x - x;
        const dy = node.y - y;
        if (Math.sqrt(dx * dx + dy * dy) <= node.radius + 4) {
          return node;
        }
      }
      return null;
    }

    matchesFilter(node) {
      if (this.activeFilter === 'all') return true;
      if (this.activeFilter === 'captain') return node.isCaptain;
      if (this.activeFilter === 'online') return node.isOnline;
      const role = (node.role || '').toLowerCase();
      if (this.activeFilter === 'batter') return role.includes('bat');
      if (this.activeFilter === 'bowler') return role.includes('bowl');
      if (this.activeFilter === 'allrounder') return role.includes('all');
      return true;
    }

    render() {
      const ctx = this.ctx;
      ctx.clearRect(0, 0, this.width, this.height);

      // Background subtle grid
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.03)';
      ctx.lineWidth = 1;
      const gridSize = 30;
      for (let x = 0; x < this.width; x += gridSize) {
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, this.height);
        ctx.stroke();
      }
      for (let y = 0; y < this.height; y += gridSize) {
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(this.width, y);
        ctx.stroke();
      }

      // Draw Links
      for (const link of this.links) {
        const srcVisible = this.matchesFilter(link.source);
        const tgtVisible = this.matchesFilter(link.target);
        const alpha = (srcVisible && tgtVisible) ? 0.35 : 0.08;

        ctx.strokeStyle = link.type === 'captain'
          ? `rgba(0, 229, 255, ${alpha})`
          : `rgba(255, 215, 64, ${alpha * 0.7})`;
        ctx.lineWidth = link.type === 'captain' ? 2 : 1;
        ctx.setLineDash(link.type === 'captain' ? [] : [4, 4]);

        ctx.beginPath();
        ctx.moveTo(link.source.x, link.source.y);
        ctx.lineTo(link.target.x, link.target.y);
        ctx.stroke();
        ctx.setLineDash([]);
      }

      // Draw Nodes
      for (const node of this.nodes) {
        const isFiltered = !this.matchesFilter(node);
        const isHovered = this.hoveredNode === node;
        const isSelected = this.selectedNode === node;
        const alpha = isFiltered ? 0.25 : 1.0;

        ctx.save();
        ctx.globalAlpha = alpha;

        // Glowing pulse aura for selected / captain
        if (node.isCaptain || isSelected) {
          ctx.beginPath();
          ctx.arc(node.x, node.y, node.radius + (node.isCaptain ? 6 : 4), 0, Math.PI * 2);
          ctx.fillStyle = node.isCaptain ? 'rgba(0, 229, 255, 0.15)' : 'rgba(255, 215, 64, 0.18)';
          ctx.fill();
        }

        // Node Circle Body
        ctx.beginPath();
        ctx.arc(node.x, node.y, node.radius, 0, Math.PI * 2);
        ctx.fillStyle = '#161922';
        ctx.fill();
        ctx.lineWidth = isSelected ? 3 : (node.isCaptain ? 2.5 : 1.5);
        ctx.strokeStyle = isSelected ? '#ffd740' : (node.color || '#00e5ff');
        ctx.stroke();

        // Avatar text
        ctx.font = `${node.radius * 0.9}px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(node.avatar || '🏏', node.x, node.y + 1);

        // Online dot indicator
        if (node.isOnline) {
          ctx.beginPath();
          ctx.arc(node.x + node.radius * 0.7, node.y - node.radius * 0.7, 4.5, 0, Math.PI * 2);
          ctx.fillStyle = '#00e676';
          ctx.fill();
          ctx.lineWidth = 1.5;
          ctx.strokeStyle = '#161922';
          ctx.stroke();
        }

        // Captain Crown Badge
        if (node.isCaptain) {
          ctx.font = '10px sans-serif';
          ctx.fillText('👑', node.x, node.y - node.radius - 4);
        }

        // Player Name Label
        ctx.font = isSelected ? 'bold 11px Inter, sans-serif' : '10px Inter, sans-serif';
        ctx.fillStyle = isSelected ? '#ffd740' : '#e0e0e0';
        ctx.fillText(node.name, node.x, node.y + node.radius + 12);

        ctx.restore();
      }
    }

    updateNodeInspector(node) {
      const panel = document.getElementById('graphify-node-details');
      if (!panel) return;
      panel.innerHTML = `
        <div class="graph-inspector-card">
          <div style="display:flex;align-items:center;gap:0.6rem">
            <div style="width:36px;height:36px;border-radius:50%;background:#202634;border:1px solid ${node.color};display:flex;align-items:center;justify-content:center;font-size:1.1rem">
              ${node.avatar || '🏏'}
            </div>
            <div>
              <div style="font-weight:700;font-size:0.95rem;color:var(--text-1)">
                ${node.name} ${node.isCaptain ? '<span class="captain-badge">👑 CAPTAIN</span>' : ''}
              </div>
              <div style="font-size:0.75rem;color:var(--text-3)">
                ${node.role} · <span style="color:${node.isOnline ? 'var(--success)' : 'var(--text-3)'}">● ${node.isOnline ? 'Live Now' : 'Offline'}</span>
              </div>
            </div>
          </div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:0.5rem;margin-top:0.6rem">
            <div class="graph-stat-pill">
              <span class="graph-stat-lbl">Synergy</span>
              <span class="graph-stat-val" style="color:var(--primary)">${node.synergy}%</span>
            </div>
            <div class="graph-stat-pill">
              <span class="graph-stat-lbl">Role Rating</span>
              <span class="graph-stat-val" style="color:var(--warning)">9.${node.synergy % 10}/10</span>
            </div>
          </div>
        </div>
      `;
      panel.style.display = 'block';
    }

    updateContext7Intelligence(nodes, groupName) {
      const hud = document.getElementById('context7-hud');
      if (!hud) return;

      const total = nodes.length;
      const online = nodes.filter(n => n.isOnline).length;
      const allRounders = nodes.filter(n => (n.role || '').toLowerCase().includes('all')).length;
      const batters = nodes.filter(n => (n.role || '').toLowerCase().includes('bat')).length;
      const bowlers = nodes.filter(n => (n.role || '').toLowerCase().includes('bowl')).length;

      // Synergy calculation formula
      const balanceScore = Math.min(98, Math.max(65, Math.floor(70 + (allRounders * 5) + (total >= 11 ? 15 : total * 1.2))));
      const winProbability = Math.min(88, Math.max(45, Math.floor(50 + (balanceScore - 70) * 1.2 + (online * 2))));

      hud.innerHTML = `
        <div class="context7-metric-grid">
          <div class="context7-metric-card">
            <div class="context7-lbl">⚡ Squad Synergy</div>
            <div class="context7-val" style="color:var(--primary)">${balanceScore}%</div>
            <div class="context7-sub">${total} players · ${allRounders} all-rounders</div>
          </div>
          <div class="context7-metric-card">
            <div class="context7-lbl">🎯 Win Forecast</div>
            <div class="context7-val" style="color:var(--success)">${winProbability}%</div>
            <div class="context7-sub">Based on squad depth & synergy</div>
          </div>
          <div class="context7-metric-card">
            <div class="context7-lbl">👥 Live Readiness</div>
            <div class="context7-val" style="color:var(--warning)">${online}/${total}</div>
            <div class="context7-sub">${online === total ? 'All active on pitch' : `${total - online} awaiting confirmation`}</div>
          </div>
        </div>
      `;
    }
  }

  // Global exports & modal openers
  window.GraphifySquadNetwork = GraphifySquadNetwork;

  let activeGraph = null;

  window.openGraphifyModal = function () {
    const modal = document.getElementById('graphify-modal');
    if (!modal) return;
    modal.style.display = 'flex';

    if (!activeGraph) {
      activeGraph = new GraphifySquadNetwork('graphify-canvas');
    }

    const room = window.state?.room;
    let members = room?.planning?.members;
    if (!members || Object.keys(members).length === 0) {
      members = room?.group?.members || [];
    }

    activeGraph.buildFromSquad(members, room?.groupName || room?.matchName || 'Squad');
  };

  window.closeGraphifyModal = function () {
    const modal = document.getElementById('graphify-modal');
    if (modal) modal.style.display = 'none';
    if (activeGraph) activeGraph.stopSimulation();
  };

  window.setGraphFilter = function (filter) {
    if (activeGraph) activeGraph.setFilter(filter);
  };
})();
