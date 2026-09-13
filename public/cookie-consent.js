/**
 * ═══════════════════════════════════════════════════════════════════════
 *  CRICKETHUB PRIVACY & COOKIE CONSENT MODULE
 *  Compliant with Digital Personal Data Protection (DPDP) Act 2023 & GDPR
 * ═══════════════════════════════════════════════════════════════════════
 */

(function () {
  'use strict';

  const STORAGE_KEY = 'crickethub_cookie_consent_v1';

  // Default consent state: Strict opt-in (all non-essential false)
  const defaultConsent = {
    essential: true, // Always required for match rooms, authentication, and core WebSocket sync
    analytics: false,
    marketing: false,
    timestamp: null,
    status: 'unanswered' // 'accepted_all' | 'rejected_non_essential' | 'custom'
  };

  /**
   * Retrieve saved consent from localStorage
   */
  function getSavedConsent() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return null;
      return JSON.parse(raw);
    } catch (e) {
      return null;
    }
  }

  /**
   * Save consent to localStorage
   */
  function saveConsent(consentObj) {
    try {
      const toSave = {
        ...consentObj,
        essential: true,
        timestamp: Date.now()
      };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(toSave));
      return toSave;
    } catch (e) {
      console.error('Failed to persist cookie consent:', e);
      return consentObj;
    }
  }

  /**
   * ═══════════════════════════════════════════════════════════════════════
   *  SCRIPT EXECUTION HOOKS
   * ═══════════════════════════════════════════════════════════════════════
   */

  /**
   * Called when user grants consent for one or more optional categories
   * @param {Object} categories - { essential: true, analytics: boolean, marketing: boolean }
   */
  function onConsentGranted(categories) {
    console.log('🛡️ [Privacy/DPDP] Consent Granted for categories:', categories);

    // ── 1. GOOGLE ANALYTICS HOOK ──────────────────────────────────────
    if (categories.analytics) {
      /*
       * >>> PASTE YOUR GOOGLE ANALYTICS (GA4 / GTM) SCRIPT HERE <<<
       * Example:
       * const gaScript = document.createElement('script');
       * gaScript.async = true;
       * gaScript.src = 'https://www.googletagmanager.com/gtag/js?id=G-XXXXXXXXXX';
       * document.head.appendChild(gaScript);
       * window.dataLayer = window.dataLayer || [];
       * function gtag(){dataLayer.push(arguments);}
       * gtag('js', new Date());
       * gtag('config', 'G-XXXXXXXXXX');
       */
      console.log('📊 [Analytics Hook] Analytics tracking enabled by user consent.');
    }

    // ── 2. META PIXEL / MARKETING HOOK ────────────────────────────────
    if (categories.marketing) {
      /*
       * >>> PASTE YOUR META (FACEBOOK) PIXEL OR MARKETING TAGS HERE <<<
       * Example:
       * !function(f,b,e,v,n,t,s){if(f.fbq)return;n=f.fbq=function(){n.callMethod?
       * n.callMethod.apply(n,arguments):n.queue.push(arguments)};if(!f._fbq)f._fbq=n;
       * n.push=n;n.loaded=!0;n.version='2.0';n.queue=[];t=b.createElement(e);t.async=!0;
       * t.src=v;s=b.getElementsByTagName(e)[0];s.parentNode.insertBefore(t,s)}(window,
       * document,'script','https://connect.facebook.net/en_US/fbevents.js');
       * fbq('init', 'YOUR_PIXEL_ID');
       * fbq('track', 'PageView');
       */
      console.log('🎯 [Marketing Hook] Marketing & targeting pixels enabled by user consent.');
    }
  }

  /**
   * Called when user rejects all non-essential cookies
   */
  function onConsentDenied() {
    console.log('🛡️ [Privacy/DPDP] Non-essential cookies denied by user. Running in pure essential mode.');
    // Ensure any runtime tracking cookies are purged if previously set
  }

  /**
   * ═══════════════════════════════════════════════════════════════════════
   *  DOM BANNER & PREFERENCES UI
   * ═══════════════════════════════════════════════════════════════════════
   */

  function createConsentWidgetDOM() {
    // Check if already injected
    if (document.getElementById('cookie-consent-widget')) return;

    const container = document.createElement('div');
    container.id = 'cookie-consent-widget';
    container.innerHTML = `
      <!-- Floating Cookie Settings Persistent Badge -->
      <button id="btn-open-cookie-settings" class="cookie-settings-badge" title="Privacy & Cookie Settings (DPDP / GDPR)" aria-label="Open Cookie Settings">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M12 2a10 10 0 1 0 10 10 4 4 0 0 1-5-5 4 4 0 0 1-5-5"></path>
          <path d="M8.5 8.5v.01"></path>
          <path d="M7.5 15.5v.01"></path>
          <path d="M15.5 15.5v.01"></path>
          <path d="M11.5 12.5v.01"></path>
        </svg>
        <span>Cookie Settings</span>
      </button>

      <!-- Main Privacy Banner (Floating Card) -->
      <div id="cookie-consent-banner" class="cookie-consent-card glass-card" style="display:none" role="dialog" aria-modal="true" aria-labelledby="cookie-banner-title">
        <div class="cookie-card-header">
          <div style="display:flex;align-items:center;gap:0.5rem">
            <span style="font-size:1.35rem">🍪</span>
            <div>
              <h4 id="cookie-banner-title" style="margin:0;font-size:0.95rem;font-weight:700;color:var(--text-1)">Your Privacy & Data Choices</h4>
              <p style="margin:0;font-size:0.75rem;color:var(--text-3)">Digital Personal Data Protection Act (DPDP) 2023 & GDPR Compliant</p>
            </div>
          </div>
        </div>

        <p class="cookie-card-text">
          CricketHub uses essential cookies for room sync, live scorekeeping, and authentication. With your permission, we also use analytics to improve match planning. Learn more in our <a href="javascript:void(0)" onclick="openPrivacyPolicyModal()" class="privacy-link">Privacy Policy</a>.
        </p>

        <!-- Granular Preferences Panel (Accordion) -->
        <div id="cookie-preferences-panel" class="cookie-preferences-panel" style="display:none">
          <div class="cookie-category-item">
            <div class="cookie-cat-info">
              <span class="cookie-cat-title">Strictly Essential</span>
              <span class="cookie-cat-desc">Required for match rooms, session tokens, and live score synchronization. Cannot be disabled.</span>
            </div>
            <label class="toggle-switch disabled">
              <input type="checkbox" checked disabled />
              <span class="slider round"></span>
            </label>
          </div>

          <div class="cookie-category-item">
            <div class="cookie-cat-info">
              <span class="cookie-cat-title">Analytics & Performance</span>
              <span class="cookie-cat-desc">Anonymized telemetry to optimize server response times and scorecard rendering.</span>
            </div>
            <label class="toggle-switch">
              <input type="checkbox" id="toggle-cookie-analytics" />
              <span class="slider round"></span>
            </label>
          </div>

          <div class="cookie-category-item">
            <div class="cookie-cat-info">
              <span class="cookie-cat-title">Marketing & Personalization</span>
              <span class="cookie-cat-desc">Customizes match notifications and squad recommendations.</span>
            </div>
            <label class="toggle-switch">
              <input type="checkbox" id="toggle-cookie-marketing" />
              <span class="slider round"></span>
            </label>
          </div>
        </div>

        <!-- Action Buttons -->
        <div class="cookie-card-actions">
          <button id="btn-cookie-accept-all" class="btn btn-primary btn-sm cookie-btn">
            Accept All
          </button>
          <button id="btn-cookie-reject-all" class="btn btn-secondary btn-sm cookie-btn">
            Reject Non-Essential
          </button>
          <button id="btn-cookie-manage" class="btn btn-ghost btn-sm cookie-btn">
            Manage Preferences
          </button>
          <button id="btn-cookie-save-prefs" class="btn btn-primary btn-sm cookie-btn" style="display:none">
            Save My Preferences
          </button>
        </div>
      </div>
    `;

    document.body.appendChild(container);
    attachWidgetEvents();
  }

  function attachWidgetEvents() {
    const banner = document.getElementById('cookie-consent-banner');
    const prefsPanel = document.getElementById('cookie-preferences-panel');
    const btnAcceptAll = document.getElementById('btn-cookie-accept-all');
    const btnRejectAll = document.getElementById('btn-cookie-reject-all');
    const btnManage = document.getElementById('btn-cookie-manage');
    const btnSavePrefs = document.getElementById('btn-cookie-save-prefs');
    const btnFloatingSettings = document.getElementById('btn-open-cookie-settings');
    const toggleAnalytics = document.getElementById('toggle-cookie-analytics');
    const toggleMarketing = document.getElementById('toggle-cookie-marketing');

    // 1. Accept All
    btnAcceptAll?.addEventListener('click', () => {
      const consent = saveConsent({
        essential: true,
        analytics: true,
        marketing: true,
        status: 'accepted_all'
      });
      banner.style.display = 'none';
      onConsentGranted(consent);
      if (window.toast) window.toast('✅ Cookie preferences saved: All cookies accepted');
    });

    // 2. Reject Non-Essential
    btnRejectAll?.addEventListener('click', () => {
      const consent = saveConsent({
        essential: true,
        analytics: false,
        marketing: false,
        status: 'rejected_non_essential'
      });
      banner.style.display = 'none';
      onConsentDenied();
      if (window.toast) window.toast('🛡️ Only strictly essential cookies enabled');
    });

    // 3. Manage Preferences Toggle
    btnManage?.addEventListener('click', () => {
      const isExpanded = prefsPanel.style.display !== 'none';
      if (isExpanded) {
        prefsPanel.style.display = 'none';
        btnSavePrefs.style.display = 'none';
        btnManage.textContent = 'Manage Preferences';
      } else {
        prefsPanel.style.display = 'block';
        btnSavePrefs.style.display = 'inline-flex';
        btnManage.textContent = '▲ Collapse';
      }
    });

    // 4. Save Custom Preferences
    btnSavePrefs?.addEventListener('click', () => {
      const analyticsChecked = !!toggleAnalytics?.checked;
      const marketingChecked = !!toggleMarketing?.checked;

      const consent = saveConsent({
        essential: true,
        analytics: analyticsChecked,
        marketing: marketingChecked,
        status: 'custom'
      });

      banner.style.display = 'none';
      if (analyticsChecked || marketingChecked) {
        onConsentGranted(consent);
      } else {
        onConsentDenied();
      }
      if (window.toast) window.toast('✅ Custom privacy preferences saved');
    });

    // 5. Open Settings via Floating Badge
    btnFloatingSettings?.addEventListener('click', () => {
      const current = getSavedConsent() || defaultConsent;
      if (toggleAnalytics) toggleAnalytics.checked = !!current.analytics;
      if (toggleMarketing) toggleMarketing.checked = !!current.marketing;

      prefsPanel.style.display = 'block';
      btnSavePrefs.style.display = 'inline-flex';
      btnManage.textContent = '▲ Collapse';
      banner.style.display = 'flex';
      banner.scrollIntoView({ behavior: 'smooth' });
    });
  }

  /**
   * Initialize Consent State on Page Load
   */
  function initCookieConsent() {
    createConsentWidgetDOM();

    const saved = getSavedConsent();
    const banner = document.getElementById('cookie-consent-banner');
    const toggleAnalytics = document.getElementById('toggle-cookie-analytics');
    const toggleMarketing = document.getElementById('toggle-cookie-marketing');

    if (!saved) {
      // First visit: Show banner with zero non-essential consent
      setTimeout(() => {
        if (banner) banner.style.display = 'flex';
      }, 500);
      onConsentDenied();
    } else {
      // Returning visit: Populate toggles and execute authorized hooks
      if (toggleAnalytics) toggleAnalytics.checked = !!saved.analytics;
      if (toggleMarketing) toggleMarketing.checked = !!saved.marketing;

      if (saved.analytics || saved.marketing) {
        onConsentGranted(saved);
      } else {
        onConsentDenied();
      }
    }
  }

  // ═══════════════════════════════════════════════════════════════════════
  //  LEGAL, PRIVACY & DATA DECLARATION MODAL CONTROLLER
  // ═══════════════════════════════════════════════════════════════════════

  window.switchLegalTab = function (tabName) {
    const tabs = ['terms', 'privacy', 'data'];
    tabs.forEach(t => {
      const btn = document.getElementById(`legal-tab-${t}`);
      const pane = document.getElementById(`legal-pane-${t}`);
      if (btn) btn.classList.toggle('active', t === tabName);
      if (pane) pane.classList.toggle('active', t === tabName);
    });
  };

  window.openLegalModal = function (tabName = 'privacy') {
    const modal = document.getElementById('privacy-policy-modal');
    if (modal) {
      modal.style.display = 'flex';
      window.switchLegalTab(tabName);
    }
  };

  window.closeLegalModal = function () {
    const modal = document.getElementById('privacy-policy-modal');
    if (modal) modal.style.display = 'none';
  };

  window.openPrivacyPolicyModal = function () {
    window.openLegalModal('privacy');
  };

  window.openTermsModal = function () {
    window.openLegalModal('terms');
  };

  window.openDataDeclarationModal = function () {
    window.openLegalModal('data');
  };

  window.closePrivacyPolicyModal = function () {
    window.closeLegalModal();
  };

  window.openCookieSettings = function () {
    const btn = document.getElementById('btn-open-cookie-settings');
    if (btn) btn.click();
  };

  /**
   * DPDP Act 2023 §11 / GDPR Art. 15: Right to Access & Data Portability
   * Exports all locally held user data, consent logs, and room references.
   */
  window.exportMyUserData = function () {
    try {
      const user = localStorage.getItem('crickethub_user') ? JSON.parse(localStorage.getItem('crickethub_user')) : null;
      const consent = getSavedConsent();
      const lastRoom = localStorage.getItem('crickethub_last_room') || null;

      const exportPayload = {
        exportDate: new Date().toISOString(),
        dataFiduciary: 'CricketHub (compliance@crickethub.app)',
        statutoryFramework: 'Digital Personal Data Protection Act, 2023 & GDPR',
        userData: user || 'No active account on this device',
        privacyAndConsent: consent || 'Default opt-in settings',
        activeRoomReference: lastRoom,
        securityGuarantees: {
          encryptionInTransit: 'TLS 1.3',
          phoneMasking: 'Enabled',
          thirdPartySelling: 'None / Strictly Prohibited'
        }
      };

      const dataStr = 'data:text/json;charset=utf-8,' + encodeURIComponent(JSON.stringify(exportPayload, null, 2));
      const downloadAnchor = document.createElement('a');
      downloadAnchor.setAttribute('href', dataStr);
      downloadAnchor.setAttribute('download', `crickethub_data_export_${Date.now()}.json`);
      document.body.appendChild(downloadAnchor);
      downloadAnchor.click();
      downloadAnchor.remove();

      if (typeof window.showToast === 'function') {
        window.showToast('📥 Data exported successfully! Check your downloads.', 'success');
      } else {
        alert('📥 Your personal data export has been downloaded.');
      }
    } catch (e) {
      console.error('Failed to export user data:', e);
      alert('Failed to generate data export.');
    }
  };

  /**
   * DPDP Act 2023 §12 / GDPR Art. 17: Right to Erasure / Right to be Forgotten
   */
  window.requestDataErasure = function () {
    const confirmErasure = confirm(
      '⚠️ Exercise Right to Erasure (DPDP Act 2023 §12)?\n\n' +
      'This will erase your stored login session, profile caches, and local cookie preferences from this device.\n\n' +
      'Do you wish to proceed?'
    );

    if (confirmErasure) {
      try {
        localStorage.removeItem('crickethub_user');
        localStorage.removeItem('crickethub_token');
        localStorage.removeItem(STORAGE_KEY);
        localStorage.removeItem('crickethub_last_room');

        if (typeof window.showToast === 'function') {
          window.showToast('🛡️ Account & personal data wiped from device.', 'info');
        }

        setTimeout(() => {
          window.location.reload();
        }, 1200);
      } catch (e) {
        console.error('Failed to erase data:', e);
      }
    }
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initCookieConsent);
  } else {
    initCookieConsent();
  }
})();
