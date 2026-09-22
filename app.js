
    var state = { token: '', user: null, selectedAdminMobile: '', selectedAdminQuery: '', defaultRcCardPrice: 15, pendingVrn: '', busy: false, adminUsersQuery: '', adminAccessQuery: '', bulkConfirm: false, supportWhatsapp: '', supportPaymentQr: '', supportPaymentQrUrl: '', pendingTopupAmount: 0, adminKpiDetail: '', adminLiveBusy: false, notificationIds: {}, notifications: [], notificationUnread: 0, notificationPollTimer: null, notificationInitialised: false, purchaseRequestKey: '', purchaseRequestVrn: '', purchaseRequestType: '', transactionCategory: 'wallet', transactionPage: 1, transactionPages: 1, adminTransactionCategory: 'wallet', adminTransactionPage: 1, adminTransactionPages: 1 };
    var DOWNLOAD_PRICES = { mparivahan: 10, 'rc-card': 15 };
    var $ = function (selector) { return document.querySelector(selector); };
    var $$ = function (selector) { return Array.prototype.slice.call(document.querySelectorAll(selector)); };
    var installPrompt = null;
    var roboTimer = null;
    var roboMessages = [];
    var roboMessageIndex = 0;
    var roboGreetingLocked = false;
    var fetchingMessageTimer = null;
    var adminLiveTimer = null;
    var accountLiveTimer = null;
    var accountLiveBusy = false;
    // Keeps the A4/card reference layout crisp while reducing canvas/PDF work on mobile browsers.
    var RENDER_DPI = 240;

    function appIsInstalled() {
      return window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
    }

    function updateInstallButtons() {
      var hidden = appIsInstalled();
      ['#install-auth-button', '#install-dashboard-button'].forEach(function (selector) {
        var button = $(selector);
        if (button) button.hidden = hidden;
      });
    }

    async function installApp() {
      if (!installPrompt) {
        toast('Install option', 'Chrome menu se Install InstantRCcard choose karo. iPhone par Share → Add to Home Screen use karo.', 'info');
        return;
      }
      installPrompt.prompt();
      var choice = await installPrompt.userChoice;
      if (choice && choice.outcome === 'accepted') toast('App installed', 'InstantRCcard ab app ki tarah open hoga.', 'success');
      installPrompt = null;
      updateInstallButtons();
    }

    window.addEventListener('beforeinstallprompt', function (event) {
      event.preventDefault();
      installPrompt = event;
      updateInstallButtons();
    });
    window.addEventListener('appinstalled', function () {
      installPrompt = null;
      updateInstallButtons();
      toast('App installed', 'InstantRCcard app ready hai.', 'success');
    });
    if ('serviceWorker' in navigator) {
      window.addEventListener('load', function () {
        navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch(function () {
          // The website remains fully usable if a browser blocks offline installation.
        });
      });
    }

    // Refresh par pehle cookie session verify hota hai, isliye login flash nahi dikhega.
    $('#auth-view').hidden = true;
    $('#session-loading').hidden = false;
    window.setTimeout(function () {
      if (!$('#session-loading').hidden) clearSession();
    }, 12_000);

    async function callServer(name, args) {
      var url = '';
      var options = { credentials: 'same-origin', headers: { 'Accept': 'application/json' } };
      if (name === 'signup') { url = '/api/auth/signup'; options.method = 'POST'; options.headers['Content-Type'] = 'application/json'; options.body = JSON.stringify({ name: args[0], email: args[1], mobile: args[2], password: args[3] }); }
      else if (name === 'login') { url = '/api/auth/login'; options.method = 'POST'; options.headers['Content-Type'] = 'application/json'; options.body = JSON.stringify({ identifier: args[0], password: args[1] }); }
      else if (name === 'forgotPassword') { url = '/api/auth/forgot-password'; options.method = 'POST'; options.headers['Content-Type'] = 'application/json'; options.body = JSON.stringify({ email: args[0], mobile: args[1], newPassword: args[2], confirmPassword: args[3] }); }
      else if (name === 'logout') { url = '/api/auth/logout'; options.method = 'POST'; }
      else if (name === 'getMe') { url = '/api/auth/session'; }
      else if (name === 'buyRc') { url = '/api/rc/purchase'; options.method = 'POST'; options.headers['Content-Type'] = 'application/json'; options.body = JSON.stringify({ vrn: args[0], downloadType: args[1] || 'mparivahan', idempotencyKey: args[2] || '' }); }
      else if (name === 'getMyTransactions') { url = '/api/account/transactions?category=' + encodeURIComponent(args[0] || 'wallet') + '&page=' + encodeURIComponent(args[1] || 1) + '&limit=10'; }
      else if (name === 'getAds') { url = '/api/ads'; }
      else if (name === 'getSupportSettings') { url = '/api/support-settings'; }
      else if (name === 'getNotificationPublicKey') { url = '/api/notifications/public-key'; }
      else if (name === 'getNotifications') { url = '/api/notifications'; }
      else if (name === 'subscribeNotifications') { url = '/api/notifications/subscribe'; options.method = 'POST'; options.headers['Content-Type'] = 'application/json'; options.body = JSON.stringify({ subscription: args[0] }); }
      else if (name === 'unsubscribeNotifications') { url = '/api/notifications/unsubscribe'; options.method = 'POST'; options.headers['Content-Type'] = 'application/json'; options.body = JSON.stringify({ endpoint: args[0] || '' }); }
      else if (name === 'readNotifications') { url = '/api/notifications/read'; options.method = 'POST'; options.headers['Content-Type'] = 'application/json'; options.body = JSON.stringify({ ids: args[0] || [] }); }
      else if (name === 'getStats') { url = '/api/public/stats'; }
      else if (name === 'adminFindUser') { url = '/api/admin/users/search'; options.method = 'POST'; options.headers['Content-Type'] = 'application/json'; options.body = JSON.stringify({ query: args[0] }); }
      else if (name === 'adminSetUserRate') { url = '/api/admin/users/set-rate'; options.method = 'POST'; options.headers['Content-Type'] = 'application/json'; options.body = JSON.stringify({ query: args[0], price: args[1], clear: args[2] === true }); }
      else if (name === 'adminListUsers') { url = '/api/admin/users' + (args[0] ? '?q=' + encodeURIComponent(args[0]) : ''); }
      else if (name === 'adminListAccess') { url = '/api/admin/users/access' + (args[0] ? '?q=' + encodeURIComponent(args[0]) : ''); }
      else if (name === 'adminUpdateAccess') { url = '/api/admin/users/access'; options.method = 'POST'; options.headers['Content-Type'] = 'application/json'; options.body = JSON.stringify({ query: args[0], makeAdmin: args[1] !== false, permissions: args[2] || {} }); }
      else if (name === 'adminBulkRate') { url = '/api/admin/users/bulk-rate'; options.method = 'POST'; options.headers['Content-Type'] = 'application/json'; options.body = JSON.stringify({ price: args[0], clear: args[1] === true, scope: args[2] || 'all', mobiles: args[3] || [], confirm: args[4] === true }); }
      else if (name === 'adminSetUserStatus') { url = '/api/admin/users/status'; options.method = 'POST'; options.headers['Content-Type'] = 'application/json'; options.body = JSON.stringify({ mobile: args[0], active: args[1] !== false }); }
      else if (name === 'adminRecharge') { url = '/api/admin/recharge'; options.method = 'POST'; options.headers['Content-Type'] = 'application/json'; options.body = JSON.stringify({ mobile: args[0], amount: args[1], note: args[2] }); }
      else if (name === 'adminDebit') { url = '/api/admin/debit'; options.method = 'POST'; options.headers['Content-Type'] = 'application/json'; options.body = JSON.stringify({ mobile: args[0], amount: args[1], note: args[2] }); }
      else if (name === 'createWalletTopupRequest') { url = '/api/wallet/topup-request'; options.method = 'POST'; options.headers['Content-Type'] = 'application/json'; options.body = JSON.stringify({ amount: args[0] }); }
      else if (name === 'adminGetTopupRequests') { url = '/api/admin/wallet/topup-requests'; }
      else if (name === 'adminResolveTopupRequest') { url = '/api/admin/wallet/topup-requests/' + encodeURIComponent(args[0]); options.method = 'POST'; options.headers['Content-Type'] = 'application/json'; options.body = JSON.stringify({ status: args[1], amount: args[2], reason: args[3] || '' }); }
      else if (name === 'adminGetTransactions') { url = '/api/admin/transactions?category=' + encodeURIComponent(args[0] || 'wallet') + '&page=' + encodeURIComponent(args[1] || 1) + '&limit=10'; }
      else if (name === 'adminGetStats') {
        var qs = new URLSearchParams();
        if (args[0] && args[0].from) qs.set('from', args[0].from);
        if (args[0] && args[0].to) qs.set('to', args[0].to);
        url = '/api/admin/stats' + (qs.toString() ? '?' + qs.toString() : '');
      }
      else if (name === 'adminGetKpiDetails') {
        var detailQs = new URLSearchParams();
        detailQs.set('type', args[0] || 'wallet-requests');
        if (args[1] && args[1].from) detailQs.set('from', args[1].from);
        if (args[1] && args[1].to) detailQs.set('to', args[1].to);
        url = '/api/admin/stats/details?' + detailQs.toString();
      }
      else if (name === 'adminSetRating') { url = '/api/admin/settings/rating'; options.method = 'POST'; options.headers['Content-Type'] = 'application/json'; options.body = JSON.stringify({ rating: args[0] }); }
      else if (name === 'adminSetBaseline') { url = '/api/admin/settings/baseline'; options.method = 'POST'; options.headers['Content-Type'] = 'application/json'; options.body = JSON.stringify({ usersBaseline: args[0], downloadsBaseline: args[1] }); }
      else if (name === 'adminSetRcPrice') { url = '/api/admin/settings/rc-price'; options.method = 'POST'; options.headers['Content-Type'] = 'application/json'; options.body = JSON.stringify({ price: args[0] }); }
      else if (name === 'adminSetSupport') { url = '/api/admin/settings/support'; options.method = 'POST'; options.headers['Content-Type'] = 'application/json'; options.body = JSON.stringify({ whatsapp: args[0], paymentQr: args[1], clearQr: args[2] === true }); }
      else if (name === 'adminGetAds') { url = '/api/admin/ads'; }
      else if (name === 'adminAddAd') { url = '/api/admin/ads'; options.method = 'POST'; options.headers['Content-Type'] = 'application/json'; options.body = JSON.stringify({ title: args[0], imageData: args[1] }); }
      else if (name === 'adminDeleteAd') { url = '/api/admin/ads/' + encodeURIComponent(args[0]); options.method = 'DELETE'; }
      else if (name === 'adminToggleAd') { url = '/api/admin/ads/' + encodeURIComponent(args[0]); options.method = 'POST'; }
      else throw new Error('Unknown request');
      var requestController = null;
      var requestTimer = null;
      var requestTimeoutMs = name === 'buyRc' ? 32_000 : (name === 'getMe' || name === 'getSupportSettings' ? 8_000 : 0);
      if (requestTimeoutMs && window.AbortController) {
        requestController = new AbortController();
        options.signal = requestController.signal;
        requestTimer = window.setTimeout(function () { requestController.abort(); }, requestTimeoutMs);
      }
      var response;
      try {
        response = await fetch(url, options);
      } catch (error) {
        if (error && error.name === 'AbortError') {
          if (name === 'buyRc') throw new Error('RC provider response slow ho raha hai. Please dobara try karein.');
          throw new Error('Server response slow ho raha hai. Please refresh karke dobara try karein.');
        }
        throw error;
      } finally {
        if (requestTimer) clearTimeout(requestTimer);
      }
      var payload;
      try { payload = await response.json(); } catch (error) { throw new Error('Server se invalid response aaya.'); }
      return payload;
    }

    function normalizeMobile(value) { return String(value || '').replace(/\D/g, '').replace(/^91(?=\d{10}$)/, ''); }
    function normalizeVrn(value) { return String(value || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, ''); }
    function validEmail(value) { return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(String(value || '').trim()); }
    function validMobile(value) { return /^[6-9]\d{9}$/.test(value); }
    function validLoginIdentifier(value) {
      var raw = String(value || '').trim();
      var mobile = normalizeMobile(raw);
      return Boolean(raw && (validEmail(raw) || validMobile(mobile) || /^[A-Za-z][A-Za-z0-9 ._-]{1,79}$/.test(raw)));
    }
    function validVrn(value) { return /^[A-Z0-9]{4,15}$/.test(value); }
    function escapeHtml(value) { return String(value == null ? '' : value).replace(/[&<>"']/g, function (c) { return ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' })[c]; }); }
    function formatMoney(value) { return '₹' + Number(value || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 }); }
    function formatDate(value) { var d = new Date(value); return isNaN(d.getTime()) ? 'Just now' : d.toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }); }
    function priceForDownload(downloadType) {
      var serverPrices = state.user && state.user.prices;
      if (downloadType === 'rc-card' && serverPrices && serverPrices.rcCard != null) return Number(serverPrices.rcCard);
      if (downloadType === 'mparivahan' && serverPrices && serverPrices.mparivahan != null) return Number(serverPrices.mparivahan);
      return DOWNLOAD_PRICES[downloadType] || DOWNLOAD_PRICES.mparivahan;
    }

    function hasAdminPermission(permission) {
      if (!state.user || state.user.role !== 'admin') return false;
      var permissions = state.user.adminPermissions;
      // Older sessions without the new field are treated as legacy full admins;
      // the server remains the final authority for every protected request.
      return !permissions || permissions[permission] === true;
    }

    function adminPermissionLabel(permission) {
      return ({ kpi: 'KPI dashboard', recharge: 'Add payment / recharge', rates: 'Rate setting', ads: 'Advertisements', transactions: 'Transaction view', access: 'Admin access' })[permission] || permission;
    }

    function toast(title, message, type) {
      var item = document.createElement('div');
      item.className = 'toast ' + (type || 'info');
      item.innerHTML = '<span class="toast-icon">' + (type === 'success' ? '✓' : type === 'error' ? '!' : '✦') + '</span><span><strong>' + escapeHtml(title) + '</strong><p>' + escapeHtml(message) + '</p></span>';
      $('#toast-stack').appendChild(item);
      setTimeout(function () { item.classList.add('hide'); setTimeout(function () { item.remove(); }, 260); }, 4200);
    }

    function showWelcomePopup(user) {
      var modal = $('#welcome-back-modal');
      if (!modal) return;
      $('#welcome-back-name').textContent = String(user && user.name || 'User').split(' ')[0];
      modal.hidden = false;
      setTimeout(function () { if ($('#welcome-back-continue')) $('#welcome-back-continue').focus(); }, 40);
    }

    function closeWelcomePopup() {
      var modal = $('#welcome-back-modal');
      if (modal) modal.hidden = true;
      releaseRoboGreeting();
    }

    function setRoboMessage(text) {
      var bubble = $('#robo-message');
      if (!bubble) return;
      bubble.classList.remove('robo-message-show');
      void bubble.offsetWidth;
      bubble.textContent = text;
      bubble.classList.add('robo-message-show');
    }

    function releaseRoboGreeting() {
      if (!roboGreetingLocked) return;
      // Keep the personal greeting visible even after help/welcome interaction;
      // only the help panel changes while the robot animation runs independently.
      roboGreetingLocked = false;
    }

    function closeRoboHelp(releaseGreeting) {
      var panel = $('#robo-help-panel');
      if (panel) panel.hidden = true;
      if (releaseGreeting !== false) releaseRoboGreeting();
    }

    function openRoboHelp() {
      var panel = $('#robo-help-panel');
      if (!panel) return;
      panel.hidden = false;
      // Keep the frozen Hello, Name bubble visible while help choices are open.
    }

    function stopRoboAssistant() {
      if (roboTimer) window.clearTimeout(roboTimer);
      roboTimer = null;
      roboMessages = [];
      roboMessageIndex = 0;
      roboGreetingLocked = false;
      closeRoboHelp(false);
      var helper = $('#robo-helper');
      if (helper) helper.hidden = true;
    }

    function startRoboAssistant(user) {
      stopRoboAssistant();
      if (!user) return;
      var name = String(user.name || 'there').trim().split(' ')[0] || 'there';
      // The greeting is intentionally not cycled. Its text stays visibly frozen
      // while the SVG robot, status light and rings animate independently.
      roboGreetingLocked = true;
      var helper = $('#robo-helper');
      if (!helper) return;
      helper.hidden = false;
      setRoboMessage('Hello, ' + name);
    }

    function setDownloadStatus(title, text, type) {
      var box = $('#download-status');
      box.className = 'download-status ' + (type || '');
      $('#download-status-title').textContent = title;
      $('#download-status-text').textContent = text || '';
      $('#download-status-icon').textContent = type === 'error' ? '!' : type === 'loading' ? '…' : '✓';
      box.hidden = false;
    }

    function setFetchingOverlay(visible) {
      var overlay = $('#fetching-overlay');
      if (!overlay) return;
      if (fetchingMessageTimer) {
        clearInterval(fetchingMessageTimer);
        fetchingMessageTimer = null;
      }
      overlay.hidden = !visible;
      document.body.style.overflow = visible ? 'hidden' : '';
      if (!visible) return;

      var text = $('#fetching-overlay-text');
      var messages = [
        'Secure RC provider se connection ho raha hai…',
        'Front aur back image process ho rahi hai…',
        'Clear RC Card prepare ho raha hai…'
      ];
      var index = 0;
      if (text) text.textContent = messages[index];
      fetchingMessageTimer = window.setInterval(function () {
        index = (index + 1) % messages.length;
        if (text) text.textContent = messages[index];
      }, 1800);
    }

    function showWalletAlert(text) {
      $('#wallet-alert-text').textContent = text || 'RC Card download ke liye ' + formatMoney(priceForDownload('rc-card')) + ' wallet balance chahiye. Admin se recharge karwao.';
      $('#wallet-alert').hidden = false;
    }

    function hideWalletAlert() {
      $('#wallet-alert').hidden = true;
    }

    function showTopupAmountStep() {
      $('#topup-amount-step').hidden = false;
      $('#topup-payment-step').hidden = true;
      setTimeout(function () { $('#topup-amount').focus(); }, 30);
    }

    function openWalletTopup() {
      loadSupportSettings();
      var current = state.user ? Number(state.user.wallet || 0) : 0;
      $('#topup-current-balance').textContent = formatMoney(current);
      $('#topup-amount').value = '';
      state.pendingTopupAmount = 0;
      showTopupAmountStep();
      $('#wallet-topup-modal').hidden = false;
      document.body.style.overflow = 'hidden';
    }

    function closeWalletTopup() {
      $('#wallet-topup-modal').hidden = true;
      state.pendingTopupAmount = 0;
      if ($('#fetching-overlay').hidden && $('#download-options-modal').hidden) document.body.style.overflow = '';
    }

    function proceedToWalletPayment() {
      var amount = Number($('#topup-amount').value);
      if (!Number.isFinite(amount) || amount < 1 || amount > 100000) {
        toast('Amount enter karo', 'Topup amount ₹1 se ₹100000 ke beech hona chahiye.', 'error');
        return;
      }
      if (!state.supportPaymentQr && !state.supportPaymentQrUrl) {
        toast('Payment QR not set', 'Main Admin pehle payment QR configure karein.', 'error');
        return;
      }
      state.pendingTopupAmount = Math.round(amount);
      $('#topup-payment-amount').textContent = formatMoney(state.pendingTopupAmount);
      $('#topup-amount-step').hidden = true;
      $('#topup-payment-step').hidden = false;
    }

    function openWhatsAppWithFallback(nativeUrl, fallbackUrl) {
      var switchedAway = false;
      var finished = false;
      var fallbackTimer = null;
      var cleanup = function () {
        if (finished) return;
        finished = true;
        if (fallbackTimer) window.clearTimeout(fallbackTimer);
        document.removeEventListener('visibilitychange', onVisibilityChange);
        window.removeEventListener('pagehide', onPageHide);
      };
      var onVisibilityChange = function () {
        if (document.visibilityState === 'hidden') {
          switchedAway = true;
          cleanup();
        }
      };
      var onPageHide = function () {
        switchedAway = true;
        cleanup();
      };
      document.addEventListener('visibilitychange', onVisibilityChange);
      window.addEventListener('pagehide', onPageHide);
      fallbackTimer = window.setTimeout(function () {
        if (!switchedAway && !document.hidden) {
          cleanup();
          window.location.assign(fallbackUrl);
        }
      }, 1400);
      try {
        // Android installed PWAs need the native scheme first. If WhatsApp is
        // missing or the browser blocks the scheme, visibility stays visible
        // and the configured HTTPS wa.me URL is used after the short timeout.
        window.location.assign(nativeUrl);
      } catch (error) {
        cleanup();
        window.location.assign(fallbackUrl);
      }
    }

    function redirectToWalletTopupWhatsapp() {
      var amount = Number(state.pendingTopupAmount || $('#topup-amount').value);
      if (!Number.isFinite(amount) || amount < 1 || amount > 100000) {
        showTopupAmountStep();
        toast('Amount enter karo', 'Jitna wallet topup chahiye, woh amount daalo.', 'error');
        return;
      }
      if (!state.supportWhatsapp) {
        toast('WhatsApp number not set', 'Main Admin pehle WhatsApp support number configure karein.', 'error');
        return;
      }
      var button = $('#topup-whatsapp-button');
      setButtonLoading(button, true, 'WhatsApp open ho raha hai…');
      var clientReference = 'PAY-' + Date.now().toString(36).toUpperCase();

      // Keep this hidden form: the server creates the durable, idempotent
      // request and its pending Sheet outbox without bouncing the visible PWA.
      var frameName = 'topup-submit-' + Date.now();
      var frame = document.createElement('iframe');
      frame.name = frameName;
      frame.hidden = true;
      frame.setAttribute('aria-hidden', 'true');
      document.body.appendChild(frame);
      var form = document.createElement('form');
      form.method = 'POST';
      form.action = '/api/wallet/topup-whatsapp';
      form.target = frameName;
      form.style.display = 'none';
      var amountField = document.createElement('input');
      amountField.type = 'hidden';
      amountField.name = 'amount';
      amountField.value = String(Math.round(amount));
      form.appendChild(amountField);
      var referenceField = document.createElement('input');
      referenceField.type = 'hidden';
      referenceField.name = 'clientReference';
      referenceField.value = clientReference;
      form.appendChild(referenceField);
      document.body.appendChild(form);
      form.submit();

      var phone = '91' + state.supportWhatsapp;
      var message = 'Hello InstantRCcard support. Payment done. Amount: ₹' + Math.round(amount) + '. User mobile: +91 ' + (state.user && state.user.mobile ? state.user.mobile : '') + '. App payment reference: ' + clientReference + '. Payment screenshot aur receipt isi chat me bhej raha/rahi hoon.';
      var encodedMessage = encodeURIComponent(message);
      var nativeUrl = 'whatsapp://send?phone=' + phone + '&text=' + encodedMessage;
      var fallbackUrl = 'https://wa.me/' + phone + '?text=' + encodedMessage;
      openWhatsAppWithFallback(nativeUrl, fallbackUrl);
    }

    function setAuthMode(mode) {
      $$('.auth-tab').forEach(function (tab) { tab.classList.toggle('active', tab.dataset.authTab === mode); });
      $('.auth-tabs').hidden = mode === 'forgot';
      $('#login-form').hidden = mode !== 'login';
      $('#signup-form').hidden = mode !== 'signup';
      $('#forgot-form').hidden = mode !== 'forgot';
      $('#login-copy').hidden = mode !== 'login';
      $('#signup-copy').hidden = mode !== 'signup';
    }

    function setButtonLoading(button, loading, label) {
      button.disabled = loading;
      button.innerHTML = loading ? '<span class="loader"></span> Please wait…' : label;
    }

    function applyRcPrice(price) {
      var amount = formatMoney(price);
      // Logged-in users always see their personal rate. Public/auth marketing
      // numbers stay on the default global rate so other users aren't confused.
      var personalSelectors = ['#price-note-amount', '#format-option-price'];
      var publicSelectors = ['#form-footnote-price', '#auth-benefit-price', '#auth-float-price'];
      personalSelectors.forEach(function (selector) {
        var el = $(selector);
        if (el) el.textContent = amount;
      });
      if (!state.user) {
        publicSelectors.forEach(function (selector) {
          var el = $(selector);
          if (el) el.textContent = amount;
        });
      }
      if ($('#account-rc-price')) $('#account-rc-price').textContent = 'RC Card ' + amount;
      if ($('#account-rc-note')) {
        var hasCustomRate = Boolean(state.user && state.user.customRcCardPrice != null);
        $('#account-rc-note').textContent = hasCustomRate
          ? 'Aapka special RC Card rate • MParivahan Coming Soon'
          : 'MParivahan format Coming Soon';
      }
    }

    function applyPublicDefaultPrice(price) {
      var amount = formatMoney(price);
      ['#form-footnote-price', '#auth-benefit-price', '#auth-float-price'].forEach(function (selector) {
        var el = $(selector);
        if (el) el.textContent = amount;
      });
      if (!state.user) applyRcPrice(price);
    }

    async function loadPublicPricing() {
      try {
        var result = await callServer('getStats', []);
        if (result.success && result.rcCardPrice) {
          state.defaultRcCardPrice = Number(result.rcCardPrice);
          applyPublicDefaultPrice(result.rcCardPrice);
        }
      } catch (error) { /* pre-login pricing text is non-critical */ }
    }

    function isMainAdminUser(user) {
      return Boolean(user && user.role === 'admin' && (user.isMainAdmin === true || user.adminLabel === 'Main Admin'));
    }

    function adminRoleForUser(user) {
      if (!user || user.role !== 'admin') return 'User';
      return user.adminLabel || (isMainAdminUser(user) ? 'Main Admin' : 'Admin Assistant');
    }

    function applyAdminIdentityUi(user) {
      var isAdmin = Boolean(user && user.role === 'admin');
      var role = adminRoleForUser(user);
      var owner = isMainAdminUser(user);
      var rolePill = $('#user-role-pill');
      if (rolePill) {
        rolePill.textContent = role;
        rolePill.hidden = !isAdmin;
      }
      if ($('#dropdown-role')) $('#dropdown-role').textContent = isAdmin ? role + (owner ? ' · Full platform access' : ' · Assigned access only') : 'User account';
      if ($('#account-role-row')) $('#account-role-row').hidden = !isAdmin;
      if ($('#account-role')) $('#account-role').textContent = role;
      if ($('#admin-role-label')) $('#admin-role-label').textContent = role.toUpperCase() + ' ACCESS';
      if ($('#admin-scope-tag')) $('#admin-scope-tag').textContent = owner ? 'ALL PLATFORM' : 'ASSIGNED ONLY';
      if ($('#admin-kpi-role-label')) $('#admin-kpi-role-label').textContent = owner ? 'MAIN ADMIN · LIVE OVERVIEW' : 'ADMIN ASSISTANT · YOUR OVERVIEW';
      if ($('#admin-kpi-title')) $('#admin-kpi-title').textContent = owner ? 'Admin KPI dashboard' : 'My admin KPI dashboard';
      if ($('#admin-kpi-description')) $('#admin-kpi-description').textContent = owner ? 'All users, topup, RC download aur every admin ka complete overview.' : 'Sirf aapke assigned admin access aur aapke recharge/payment activity ka overview.';
      if ($('#admin-kpi-scope-tag')) $('#admin-kpi-scope-tag').textContent = owner ? 'ALL PLATFORM' : 'YOUR ACTIVITY';
    }

    function applyAdminAccessUi(user) {
      var isAdmin = Boolean(user && user.role === 'admin');
      var permissions = ['kpi', 'recharge', 'rates', 'ads', 'transactions', 'access'];
      var allowed = permissions.filter(hasAdminPermission);
      var navAdmin = $('#admin-nav');
      var navRates = $('#admin-rates-nav');
      var navAccess = $('#admin-access-nav');
      if (navAdmin) navAdmin.hidden = !isAdmin || !allowed.length;
      if (navRates) navRates.hidden = !isAdmin || !hasAdminPermission('rates');
      if (navAccess) navAccess.hidden = !isAdmin || !hasAdminPermission('access');

      var kpi = $('#admin-kpi-section');
      if (kpi) kpi.hidden = !isAdmin || !hasAdminPermission('kpi');
      var adminCard = $('#admin-card');
      if (adminCard) adminCard.hidden = !isAdmin;

      var sectionRules = {
        wallet: hasAdminPermission('recharge') || hasAdminPermission('transactions'),
        users: hasAdminPermission('rates'),
        ads: hasAdminPermission('ads'),
        access: hasAdminPermission('access')
      };
      var hasAdminPanelSection = Object.keys(sectionRules).some(function (key) { return sectionRules[key]; });
      var noPermission = $('#admin-no-permission');
      if (noPermission) noPermission.hidden = !isAdmin || hasAdminPanelSection;
      var sidebar = document.querySelector('.admin-sidebar');
      if (sidebar) sidebar.hidden = !isAdmin || !hasAdminPanelSection;
      Object.keys(sectionRules).forEach(function (section) {
        var button = $('[data-admin-section="' + section + '"]');
        if (button) button.hidden = !isAdmin || !sectionRules[section];
      });
      var rechargeTools = $('#admin-recharge-tools');
      if (rechargeTools) rechargeTools.hidden = !hasAdminPermission('recharge');
      var rateHint = $('#admin-rate-inline-hint');
      if (rateHint) rateHint.hidden = !hasAdminPermission('rates');
      var transactionsBlock = $('#admin-transactions-block');
      if (transactionsBlock) transactionsBlock.hidden = !hasAdminPermission('transactions');
      var topupRequestsBlock = $('#admin-topup-requests-block');
      if (topupRequestsBlock) topupRequestsBlock.hidden = !hasAdminPermission('recharge');
      ['#admin-settings-rating', '#admin-settings-baseline', '#admin-settings-price', '#admin-settings-support'].forEach(function (selector) {
        var settingsRow = $(selector);
        if (settingsRow) settingsRow.hidden = !isMainAdminUser(user);
      });
      if (isAdmin && hasAdminPanelSection) {
        var firstSection = hasAdminPermission('recharge') || hasAdminPermission('transactions') ? 'wallet' : hasAdminPermission('rates') ? 'users' : hasAdminPermission('ads') ? 'ads' : 'access';
        setAdminSection(firstSection);
      } else if (isAdmin) {
        setAdminSection('');
      }
    }

    function showApp(user) {
      state.user = user;
      applyAdminIdentityUi(user);
      $('#session-loading').hidden = true;
      $('#auth-view').hidden = true;
      $('#topbar').hidden = false;
      $('#dashboard').hidden = false;
      var initials = String(user.name || 'U').trim().charAt(0).toUpperCase();
      $('#avatar').textContent = initials;
      $('#user-name').textContent = user.name;
      if ($('#dropdown-avatar')) $('#dropdown-avatar').textContent = initials;
      if ($('#dropdown-name')) $('#dropdown-name').textContent = user.name;
      if ($('#dropdown-mobile')) $('#dropdown-mobile').textContent = '+91 ' + user.mobile;
      if ($('#dropdown-email')) $('#dropdown-email').textContent = user.email || 'Email not set';

      var firstName = String(user.name || 'User').trim().split(' ')[0] || 'User';
      $('#welcome-title').textContent = 'Hello, ' + firstName;
      $('#welcome-subtitle').textContent = 'Aapka RC desk ready hai. Palak jhapakte hi vehicle number se front + back RC Card PDF download karein.';
      $('#account-name').textContent = user.name;
      $('#account-mobile').textContent = '+91 ' + user.mobile;
      if ($('#account-email')) $('#account-email').textContent = user.email || 'Email not set';
      startRoboAssistant(user);
      startNotificationPolling();
      startAccountLiveUpdates();
      if ($('#admin-transactions-title')) $('#admin-transactions-title').textContent = isMainAdminUser(user) ? 'Latest platform transactions' : 'Your recharge transactions';
      applyAdminAccessUi(user);
      applyRcPrice(priceForDownload('rc-card'));
      updateWallet(user.wallet);
      loadAds();
      loadPublicStats();
      loadTransactions();
      if (user.role === 'admin') {
        if (hasAdminPermission('transactions')) loadAdminTransactions();
        if (hasAdminPermission('recharge')) loadAdminTopupRequests();
        if (hasAdminPermission('ads')) loadAdminAds();
        if (hasAdminPermission('kpi')) loadAdminStats();
        if (hasAdminPermission('rates')) loadAdminUsers('', { silent: true });
        startAdminLiveUpdates();
      } else {
        stopAdminLiveUpdates();
      }
    }

    function updateWallet(amount) {
      var value = Number(amount || 0);
      $('#wallet-amount').textContent = formatMoney(value);
      $('#balance-large').textContent = formatMoney(value);
      if ($('#dropdown-wallet')) $('#dropdown-wallet').textContent = formatMoney(value) + ' wallet balance';

      if (state.user) state.user.wallet = value;
    }

    function clearSession() {
      $('#session-loading').hidden = true;
      if ($('#wallet-alert')) $('#wallet-alert').hidden = true;
      if ($('#download-status')) $('#download-status').hidden = true;
      closeWelcomePopup();
      stopRoboAssistant();
      stopNotificationPolling();
      stopAccountLiveUpdates();
      stopAdminLiveUpdates();
      if (typeof closeUserDropdown === 'function') closeUserDropdown();
      state.token = '';
      state.user = null;
      state.transactionCategory = 'wallet';
      state.transactionPage = 1;
      state.adminTransactionCategory = 'wallet';
      state.adminTransactionPage = 1;
      state.adminKpiDetail = '';
      if ($('#admin-kpi-detail-panel')) $('#admin-kpi-detail-panel').hidden = true;
      $('#auth-view').hidden = false;
      $('#topbar').hidden = true;
      $('#dashboard').hidden = true;
      $('#admin-card').hidden = true;
      $('#admin-kpi-section').hidden = true;
      if ($('#admin-no-permission')) $('#admin-no-permission').hidden = true;
      if ($('#admin-access-section')) $('#admin-access-section').hidden = true;
      closeRoboHelp(false);
      setAuthMode('login');
    }

    function clientTransactionType(transaction) {
      return String(transaction && transaction.type || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
    }

    function clientTransactionKind(transaction) {
      var type = clientTransactionType(transaction);
      if (['RECHARGE', 'WALLETRECHARGE', 'WALLETTOPUP', 'TOPUP', 'WALLETDEBIT', 'DEBIT', 'ADMINDEBIT', 'ADMINWALLETDEBIT', 'ADMINWALLETCREDIT', 'WALLETCREDIT'].indexOf(type) >= 0) return 'wallet';
      return Boolean(transaction && transaction.vrn) ? 'rc' : 'other';
    }

    function clientTransactionLabel(transaction) {
      var type = clientTransactionType(transaction);
      if (type === 'ADMINWALLETCREDIT') return 'Admin wallet credit';
      if (type === 'WALLETCREDIT') return 'Wallet credit';
      if (['WALLETDEBIT', 'DEBIT', 'ADMINDEBIT', 'ADMINWALLETDEBIT'].indexOf(type) >= 0) return 'Wallet debit';
      if (['RECHARGE', 'WALLETRECHARGE', 'WALLETTOPUP', 'TOPUP'].indexOf(type) >= 0) return 'Wallet recharge';
      return 'RC download';
    }

    function renderPageButtons(container, page, pages, onPage) {
      if (!container) return;
      page = Number(page || 1);
      pages = Number(pages || 1);
      if (pages <= 1) { container.innerHTML = ''; return; }
      var items = [];
      function addPage(number) { if (items.indexOf(number) < 0) items.push(number); }
      if (pages <= 7) {
        for (var i = 1; i <= pages; i += 1) addPage(i);
      } else {
        addPage(1);
        if (page > 3) items.push('ellipsis-left');
        for (var n = Math.max(2, page - 1); n <= Math.min(pages - 1, page + 1); n += 1) addPage(n);
        if (page < pages - 2) items.push('ellipsis-right');
        addPage(pages);
      }
      var html = '<button class="pagination-button" data-page-action="prev" type="button"' + (page <= 1 ? ' disabled' : '') + '>‹ Prev</button>';
      items.forEach(function (item) {
        if (String(item).indexOf('ellipsis') === 0) html += '<span class="pagination-summary">…</span>';
        else html += '<button class="pagination-button' + (Number(item) === page ? ' active' : '') + '" data-page="' + item + '" type="button">' + item + '</button>';
      });
      html += '<span class="pagination-summary">Page ' + page + ' / ' + pages + '</span><button class="pagination-button" data-page-action="next" type="button"' + (page >= pages ? ' disabled' : '') + '>Next ›</button>';
      container.innerHTML = html;
      container.querySelectorAll('[data-page]').forEach(function (button) {
        button.addEventListener('click', function () { onPage(Number(button.dataset.page)); });
      });
      var previous = container.querySelector('[data-page-action="prev"]');
      var next = container.querySelector('[data-page-action="next"]');
      if (previous) previous.addEventListener('click', function () { if (page > 1) onPage(page - 1); });
      if (next) next.addEventListener('click', function () { if (page < pages) onPage(page + 1); });
    }

    function updateUserTransactionTabs() {
      $$('[data-user-transaction-category]').forEach(function (button) {
        button.classList.toggle('active', button.dataset.userTransactionCategory === state.transactionCategory);
      });
    }

    function renderTransactions(payload) {
      var list = $('#transaction-list');
      var transactions = payload && Array.isArray(payload.transactions) ? payload.transactions : [];
      if (!transactions.length) list.innerHTML = '<div class="empty-list">Is category me abhi koi transaction nahi hai.</div>';
      else list.innerHTML = transactions.map(function (tx) {
        var credit = Number(tx.amount) > 0;
        var kind = clientTransactionKind(tx);
        var label = clientTransactionLabel(tx);
        var icon = kind === 'rc' ? 'RC' : (credit ? '+' : '↓');
        return '<div class="transaction"><span class="transaction-icon ' + (credit ? 'recharge' : '') + '">' + icon + '</span><span class="transaction-copy"><b>' + escapeHtml(label) + (tx.vrn ? ' · ' + escapeHtml(tx.vrn) : '') + '</b><small>' + formatDate(tx.time) + ' • Balance ' + formatMoney(tx.balanceAfter) + '</small></span><span class="transaction-amount ' + (credit ? 'credit' : 'debit') + '">' + (credit ? '+' : '') + formatMoney(tx.amount) + '</span></div>';
      }).join('');
      renderPageButtons($('#transaction-pagination'), payload && payload.page, payload && payload.pages, function (page) { loadTransactions(state.transactionCategory, page); });
      updateUserTransactionTabs();
    }

    async function loadTransactions(category, page) {
      category = category || state.transactionCategory || 'wallet';
      page = Number(page || state.transactionPage || 1);
      state.transactionCategory = category;
      state.transactionPage = page;
      try {
        var result = await callServer('getMyTransactions', [category, page]);
        if (result.success) {
          state.transactionPage = Number(result.page || page);
          state.transactionPages = Number(result.pages || 1);
          renderTransactions(result);
        }
      } catch (error) { /* keep the dashboard usable */ }
    }

    function renderAds(ads) {
      var ticker = $('#ad-ticker');
      var track = $('#ad-track');
      if (!ticker || !track) return;
      if (!ads || !ads.length) {
        ticker.hidden = true;
        track.innerHTML = '';
        return;
      }
      ticker.hidden = false;
      track.innerHTML = '';
      var items = ads.concat(ads);
      items.forEach(function (ad, index) {
        var item = document.createElement('div');
        item.className = 'ad-item';
        if (index >= ads.length) item.setAttribute('aria-hidden', 'true');
        var image = document.createElement('img');
        image.src = ad.imageData;
        image.alt = ad.title || 'InstantRCcard offer';
        image.loading = 'lazy';
        item.appendChild(image);
        if (ad.title) {
          var title = document.createElement('span');
          title.textContent = ad.title;
          item.appendChild(title);
        }
        track.appendChild(item);
      });
    }

    async function loadAds() {
      try {
        var result = await callServer('getAds', []);
        if (result.success) renderAds(result.ads || []);
      } catch (error) { /* advertisements are non-critical */ }
    }

    function trimDecimals(value) {
      var rounded = Math.round(value * 100) / 100;
      return String(rounded).replace(/\.00$/, '').replace(/(\.\d)0$/, '$1');
    }

    function formatBigCount(value) {
      var n = Number(value || 0);
      if (n <= 0) return '';
      if (n >= 10000000) return trimDecimals(n / 10000000) + ' Cr+';
      if (n >= 100000) return trimDecimals(n / 100000) + ' Lakh+';
      return n.toLocaleString('en-IN') + '+';
    }

    async function loadPublicStats() {
      try {
        var result = await callServer('getStats', []);
        if (!result.success) return;
        $('#stat-users').textContent = formatBigCount(result.users) || 'Growing';
        $('#stat-downloads').textContent = formatBigCount(result.downloads) || 'Ready';
        $('#stat-rating').textContent = result.rating ? result.rating + '/5' : '—';
      } catch (error) { /* public stats are non-critical */ }
    }

    function renderAdminSupportFields() {
      var input = $('#admin-support-whatsapp-input');
      if (input) input.value = state.supportWhatsapp || '';
      var preview = $('#admin-payment-qr-preview');
      if (preview) {
        var source = state.supportPaymentQr || state.supportPaymentQrUrl || '';
        preview.src = source;
        preview.hidden = !source;
      }
    }

    function applySupportSettings(support) {
      support = support || {};
      if (Object.prototype.hasOwnProperty.call(support, 'whatsapp')) state.supportWhatsapp = normalizeMobile(support.whatsapp || '');
      if (Object.prototype.hasOwnProperty.call(support, 'paymentQr')) state.supportPaymentQr = support.paymentQr || '';
      if (Object.prototype.hasOwnProperty.call(support, 'paymentQrUrl')) state.supportPaymentQrUrl = support.paymentQrUrl || '';
      renderAdminSupportFields();
      var message = 'Hello InstantRCcard support. Mujhe RC download ya account help chahiye.';
      var url = state.supportWhatsapp
        ? 'https://wa.me/91' + state.supportWhatsapp + '?text=' + encodeURIComponent(message)
        : '#';
      $$('[data-whatsapp-support]').forEach(function (link) {
        link.href = url;
        link.dataset.configured = state.supportWhatsapp ? '1' : '0';
        link.setAttribute('aria-disabled', state.supportWhatsapp ? 'false' : 'true');
      });
      var qrBox = $('#topup-payment-qr-box');
      var qrImage = $('#topup-payment-qr');
      var qrEmpty = $('#topup-payment-qr-empty');
      if (qrBox && qrImage) {
        var qrSource = state.supportPaymentQr || state.supportPaymentQrUrl;
        qrImage.src = qrSource || '';
        qrImage.hidden = !qrSource;
        if (qrEmpty) qrEmpty.hidden = Boolean(qrSource);
        qrBox.hidden = false;
      }
    }

    async function loadSupportSettings() {
      try {
        var result = await callServer('getSupportSettings', []);
        if (result.success) applySupportSettings(result.support);
      } catch (error) { /* support configuration is non-critical */ }
    }

    function urlBase64ToUint8Array(value) {
      var padding = '='.repeat((4 - value.length % 4) % 4);
      var base64 = (value + padding).replace(/-/g, '+').replace(/_/g, '/');
      var raw = window.atob(base64);
      var output = new Uint8Array(raw.length);
      for (var i = 0; i < raw.length; i += 1) output[i] = raw.charCodeAt(i);
      return output;
    }

    function setNotificationButton(label) {
      var button = $('#enable-notifications');
      if (button) button.textContent = label;
    }

    function renderNotificationList() {
      var list = $('#notification-list');
      if (!list) return;
      if (!state.notifications.length) {
        list.innerHTML = '<div class="notification-empty">No notifications yet.</div>';
        return;
      }
      list.innerHTML = state.notifications.map(function (item) {
        var unreadClass = item.read ? '' : ' unread';
        return '<button class="notification-item' + unreadClass + '" type="button" data-notification-id="' + escapeHtml(item.id) + '"><b>' + escapeHtml(item.title || 'InstantRCcard activity') + '</b><small>' + escapeHtml(item.body || '') + '</small><time>' + escapeHtml(formatDate(item.createdAt)) + '</time></button>';
      }).join('');
      Array.prototype.slice.call(list.querySelectorAll('[data-notification-id]')).forEach(function (item) {
        item.addEventListener('click', function () { markNotificationsRead([item.dataset.notificationId]); });
      });
    }

    function updateNotificationUnread() {
      var unread = state.notifications.filter(function (item) { return !item.read; }).length;
      state.notificationUnread = unread;
      var badge = $('#notification-unread-badge');
      if (badge) {
        badge.hidden = unread < 1;
        badge.textContent = unread > 99 ? '99+' : String(unread);
      }
      var label = $('#notification-unread-label');
      if (label) label.textContent = unread ? unread + ' unread alert' + (unread === 1 ? '' : 's') : 'No unread alerts';
    }

    function setNotificationItems(items) {
      state.notifications = Array.isArray(items) ? items.slice() : [];
      updateNotificationUnread();
      renderNotificationList();
    }

    async function markNotificationsRead(ids) {
      var wanted = (ids || []).filter(Boolean);
      if (!wanted.length) return;
      try { await callServer('readNotifications', [wanted]); } catch (error) { return; }
      state.notifications.forEach(function (item) {
        if (wanted.indexOf(item.id) !== -1) item.read = true;
      });
      updateNotificationUnread();
      renderNotificationList();
    }

    function toggleNotificationPanel() {
      var panel = $('#notifications-panel');
      if (!panel) return;
      var open = !panel.hidden;
      if (open) {
        panel.hidden = true;
        return;
      }
      closeUserDropdown();
      panel.hidden = false;
      renderNotificationList();
    }

    async function syncNotifications(initial) {
      if (!state.user) return;
      try {
        var result = await callServer('getNotifications', []);
        if (!result.success) return;
        var items = Array.isArray(result.notifications) ? result.notifications : [];
        var firstLoad = initial || !state.notificationInitialised;
        var freshItems = [];
        items.forEach(function (item) {
          if (!state.notificationIds[item.id]) {
            state.notificationIds[item.id] = true;
            if (!firstLoad) freshItems.push(item);
          }
        });
        state.notificationInitialised = true;
        setNotificationItems(items);
        freshItems.forEach(function (item) {
          toast(item.title || 'New activity', item.body || '', 'info');
          if (!result.enabled && 'Notification' in window && Notification.permission === 'granted') {
            try { new Notification(item.title || 'InstantRCcard activity', { body: item.body || '', icon: '/instant-rccard-icon-192-v21.png' }); } catch (error) {}
          }
        });
      } catch (error) {}
    }

    function startNotificationPolling() {
      if (state.notificationPollTimer) clearInterval(state.notificationPollTimer);
      state.notificationIds = {};
      state.notifications = [];
      state.notificationUnread = 0;
      state.notificationInitialised = false;
      updateNotificationUnread();
      renderNotificationList();
      syncNotifications(true);
      state.notificationPollTimer = window.setInterval(function () { syncNotifications(false); }, 5_000);
      if ('Notification' in window && Notification.permission === 'granted') setNotificationButton('✓ App alerts ready');
    }

    function stopNotificationPolling() {
      if (state.notificationPollTimer) clearInterval(state.notificationPollTimer);
      state.notificationPollTimer = null;
      state.notificationIds = {};
      state.notifications = [];
      state.notificationUnread = 0;
      state.notificationInitialised = false;
      var panel = $('#notifications-panel');
      if (panel) panel.hidden = true;
      updateNotificationUnread();
      renderNotificationList();
    }

    async function enableNotifications() {
      if (!state.user) return;
      if (!('Notification' in window) || !('serviceWorker' in navigator) || !('PushManager' in window)) {
        toast('Notifications unavailable', 'Is device/browser me push notifications support nahi hai.', 'error');
        return;
      }
      try {
        var permission = Notification.permission;
        if (permission !== 'granted') permission = await Notification.requestPermission();
        if (permission !== 'granted') {
          toast('Permission required', 'Browser settings me notifications allow karo.', 'error');
          return;
        }
        var keyResult = await callServer('getNotificationPublicKey', []);
        var registration = await navigator.serviceWorker.ready;
        if (!keyResult.enabled || !keyResult.publicKey) {
          setNotificationButton('✓ App alerts on');
          toast('App alerts on', 'App open hone par notification history aur alerts milengi. Background push ke liye Web Push keys configure karein.', 'info');
          return;
        }
        var subscription = await registration.pushManager.getSubscription();
        if (!subscription) subscription = await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(keyResult.publicKey) });
        var saved = await callServer('subscribeNotifications', [subscription.toJSON()]);
        if (!saved.success) throw new Error(saved.message || 'Notification subscription failed');
        setNotificationButton('✓ Background alerts on');
        toast('Notifications on', 'Is device par admin/user activity alerts milenge.', 'success');
      } catch (error) {
        toast('Notification setup failed', error.message || 'Browser settings check karo.', 'error');
      }
    }

    async function loadAdminAds() {
      if (!state.user || state.user.role !== 'admin' || !hasAdminPermission('ads')) return;
      try {
        var result = await callServer('adminGetAds', []);
        if (result.success) renderAdminAds(result.ads || []);
      } catch (error) { /* admin ad list is non-critical */ }
    }

    function renderAdminAds(ads) {
      var list = $('#admin-ads-list');
      if (!list) return;
      if (!ads || !ads.length) {
        list.innerHTML = '<div class="empty-list">Abhi koi advertisement nahi hai.</div>';
        return;
      }
      list.innerHTML = ads.map(function (ad) {
        return '<div class="admin-ad-row"><img src="' + ad.imageData + '" alt=""><span><b>' + escapeHtml(ad.title || 'Untitled offer') + '</b><small>' + (ad.active ? 'Users ko visible' : 'Hidden') + '</small></span><button class="ad-toggle-button" data-ad-toggle="' + escapeHtml(ad.id) + '" type="button">' + (ad.active ? 'Hide' : 'Show') + '</button><button class="ad-delete-button" data-ad-delete="' + escapeHtml(ad.id) + '" type="button">Remove</button></div>';
      }).join('');
      $$('[data-ad-delete]').forEach(function (button) { button.addEventListener('click', function () { deleteAdvertisement(button.dataset.adDelete); }); });
      $$('[data-ad-toggle]').forEach(function (button) { button.addEventListener('click', function () { toggleAdvertisement(button.dataset.adToggle); }); });
    }

    function readAdImage(file) {
      return new Promise(function (resolve, reject) {
        if (!file || !file.type || file.type.indexOf('image/') !== 0) return reject(new Error('Image file select karo.'));
        var reader = new FileReader();
        reader.onerror = function () { reject(new Error('Image read nahi ho paayi.')); };
        reader.onload = function () {
          var image = new Image();
          image.onerror = function () { reject(new Error('Image valid nahi hai.')); };
          image.onload = function () {
            var maxWidth = 1200;
            var maxHeight = 320;
            var scale = Math.min(1, maxWidth / image.naturalWidth, maxHeight / image.naturalHeight);
            var canvas = document.createElement('canvas');
            canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
            canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
            var context = canvas.getContext('2d');
            context.fillStyle = '#ffffff';
            context.fillRect(0, 0, canvas.width, canvas.height);
            context.drawImage(image, 0, 0, canvas.width, canvas.height);
            var quality = .78;
            var output = canvas.toDataURL('image/jpeg', quality);
            while (output.length > 48000 && quality > .34) {
              quality -= .08;
              output = canvas.toDataURL('image/jpeg', quality);
            }
            while (output.length > 48000 && canvas.width > 420) {
              canvas.width = Math.round(canvas.width * .84);
              canvas.height = Math.round(canvas.height * .84);
              context = canvas.getContext('2d');
              context.fillStyle = '#ffffff';
              context.fillRect(0, 0, canvas.width, canvas.height);
              context.drawImage(image, 0, 0, canvas.width, canvas.height);
              output = canvas.toDataURL('image/jpeg', quality);
            }
            resolve(output);
          };
          image.src = reader.result;
        };
        reader.readAsDataURL(file);
      });
    }

    async function uploadAdvertisement() {
      if (!hasAdminPermission('ads')) { toast('Access restricted', 'Is admin account ko advertisement access nahi diya gaya.', 'error'); return; }
      var fileInput = $('#admin-ad-file');
      var titleInput = $('#admin-ad-title');
      var button = $('#admin-ad-upload');
      if (!fileInput.files || !fileInput.files[0]) { toast('Image select karo', 'Offer ya festival banner upload karo.', 'error'); return; }
      setButtonLoading(button, true, 'Upload');
      try {
        var imageData = await readAdImage(fileInput.files[0]);
        var result = await callServer('adminAddAd', [titleInput.value.trim(), imageData]);
        if (!result.success) { toast('Advertisement upload failed', result.message, 'error'); return; }
        titleInput.value = '';
        fileInput.value = '';
        await loadAdminAds();
        await loadAds();
        toast('Advertisement added', 'Sabhi users ke main page par banner show hoga.', 'success');
      } catch (error) { toast('Advertisement error', error.message, 'error'); }
      finally { setButtonLoading(button, false, 'Upload'); }
    }

    async function deleteAdvertisement(id) {
      if (!hasAdminPermission('ads')) { toast('Access restricted', 'Is admin account ko advertisement access nahi diya gaya.', 'error'); return; }
      if (!window.confirm('Is advertisement ko remove karna hai?')) return;
      try {
        var result = await callServer('adminDeleteAd', [id]);
        if (!result.success) { toast('Remove failed', result.message, 'error'); return; }
        await loadAdminAds();
        await loadAds();
        toast('Advertisement removed', 'Banner users ke page se hat gaya.', 'success');
      } catch (error) { toast('Remove error', error.message, 'error'); }
    }

    async function toggleAdvertisement(id) {
      if (!hasAdminPermission('ads')) { toast('Access restricted', 'Is admin account ko advertisement access nahi diya gaya.', 'error'); return; }
      try {
        var result = await callServer('adminToggleAd', [id]);
        if (!result.success) { toast('Update failed', result.message, 'error'); return; }
        await loadAdminAds();
        await loadAds();
      } catch (error) { toast('Update error', error.message, 'error'); }
    }

    function setAdminSection(section) {
      var allowed = {
        wallet: hasAdminPermission('recharge') || hasAdminPermission('transactions'),
        users: hasAdminPermission('rates'),
        ads: hasAdminPermission('ads'),
        access: hasAdminPermission('access')
      };
      if (!allowed[section]) {
        section = Object.keys(allowed).find(function (key) { return allowed[key]; }) || '';
      }
      $$('[data-admin-section]').forEach(function (button) { button.classList.toggle('active', button.dataset.adminSection === section); });
      if ($('#admin-wallet-section')) $('#admin-wallet-section').hidden = section !== 'wallet';
      if ($('#admin-users-section')) $('#admin-users-section').hidden = section !== 'users';
      if ($('#admin-ads-section')) $('#admin-ads-section').hidden = section !== 'ads';
      if ($('#admin-access-section')) $('#admin-access-section').hidden = section !== 'access';
      if ($('#admin-no-permission')) $('#admin-no-permission').hidden = Boolean(section);
      if (section === 'wallet' && hasAdminPermission('recharge')) loadAdminTopupRequests();
      if (section === 'users') loadAdminUsers(state.adminUsersQuery || '', { silent: true });
      if (section === 'access' && !state.adminAccessQuery) {
        $('#admin-access-list').innerHTML = '<div class="empty-list">Search karke existing user select karo.</div>';
      }
    }

    function safeImage(value) {
      if (!value) return null;
      if (typeof value === 'object') value = value.base64 || value.data || value.url || value.src || value.image || '';
      var source = String(value).trim();
      if (/^data:image\//i.test(source)) {
        var comma = source.indexOf(',');
        return comma > 0 ? source.slice(0, comma + 1) + source.slice(comma + 1).replace(/\s/g, '') : null;
      }
      if (/^https?:\/\//i.test(source)) return source;
      var raw = source.replace(/\s/g, '');
      if (!/^[A-Za-z0-9+/=_-]+$/.test(raw)) return null;
      return 'data:image/png;base64,' + raw;
    }

    function loadImage(source) {
      return new Promise(function (resolve, reject) {
        var image = new Image();
        var timer = window.setTimeout(function () {
          image.onload = null;
          image.onerror = null;
          reject(new Error('RC image load timeout ho gaya.'));
        }, 8000);
        if (/^https?:\/\//i.test(source)) image.crossOrigin = 'anonymous';
        image.onload = function () { clearTimeout(timer); resolve(image); };
        image.onerror = function () { clearTimeout(timer); reject(new Error('RC image load nahi ho paayi.')); };
        image.src = source;
      });
    }

    async function makeA4Png(frontValue, backValue) {
      var frontSource = safeImage(frontValue);
      var backSource = safeImage(backValue);
      if (!frontSource || !backSource) throw new Error('Front/back RC image valid nahi hai.');
      var loadedImages = await Promise.all([loadImage(frontSource), loadImage(backSource)]);
      var front = loadedImages[0];
      var back = loadedImages[1];
      var dpi = RENDER_DPI;
      var mm = function (value) { return Math.round(value * dpi / 25.4); };
      var pageWidth = Math.round(210 * dpi / 25.4);
      var pageHeight = Math.round(297 * dpi / 25.4);
      var cardWidth = mm(85.6); // standard bank-card width
      var cardHeight = mm(54);  // standard bank-card height
      var gap = mm(20);
      var top = mm(35);
      var canvas = document.createElement('canvas');
      canvas.width = pageWidth;
      canvas.height = pageHeight;
      var context = canvas.getContext('2d');
      context.fillStyle = '#ffffff';
      context.fillRect(0, 0, pageWidth, pageHeight);
      context.imageSmoothingEnabled = true;
      context.imageSmoothingQuality = 'high';

      function drawCard(image, y) {
        var scale = Math.min(cardWidth / image.naturalWidth, cardHeight / image.naturalHeight);
        var width = Math.max(1, Math.round(image.naturalWidth * scale));
        var height = Math.max(1, Math.round(image.naturalHeight * scale));
        var x = Math.round((pageWidth - width) / 2);
        var offsetY = Math.round((cardHeight - height) / 2);
        // White card-sized area preserves the real printed card dimensions.
        context.fillStyle = '#ffffff';
        context.fillRect((pageWidth - cardWidth) / 2, y, cardWidth, cardHeight);
        context.drawImage(image, x, y + offsetY, width, height);
      }

      drawCard(front, top);
      drawCard(back, top + cardHeight + gap);
      return await new Promise(function (resolve, reject) {
        canvas.toBlob(function (blob) {
          if (blob) resolve(blob); else reject(new Error('PNG create nahi ho paayi.'));
        }, 'image/png');
      });
    }

    async function renderCardCanvas(frontValue, backValue) {
      var frontSource = safeImage(frontValue);
      var backSource = safeImage(backValue);
      if (!frontSource || !backSource) throw new Error('Front/back RC image valid nahi hai.');
      var loadedImages = await Promise.all([loadImage(frontSource), loadImage(backSource)]);
      var front = loadedImages[0];
      var back = loadedImages[1];
      var dpi = RENDER_DPI;
      var mm = function (value) { return Math.round(value * dpi / 25.4); };
      // Compact RC Card: front aur back ek hi clear canvas par, bina A4 whitespace.
      var pageWidth = mm(85.6);
      var cardHeight = mm(54);
      var canvas = document.createElement('canvas');
      canvas.width = pageWidth;
      canvas.height = cardHeight * 2;
      var context = canvas.getContext('2d');
      context.fillStyle = '#ffffff';
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.imageSmoothingEnabled = true;
      context.imageSmoothingQuality = 'high';

      function drawCard(image, y) {
        var scale = Math.min(pageWidth / image.naturalWidth, cardHeight / image.naturalHeight);
        var width = Math.max(1, Math.round(image.naturalWidth * scale));
        var height = Math.max(1, Math.round(image.naturalHeight * scale));
        context.drawImage(image, Math.round((pageWidth - width) / 2), y + Math.round((cardHeight - height) / 2), width, height);
      }
      drawCard(front, 0);
      drawCard(back, cardHeight);
      return canvas;
    }

    async function renderReferenceCanvas(frontValue, backValue) {
      var frontSource = safeImage(frontValue);
      var backSource = safeImage(backValue);
      if (!frontSource || !backSource) throw new Error('Front/back RC image valid nahi hai.');
      var loadedImages = await Promise.all([loadImage(frontSource), loadImage(backSource)]);
      var front = loadedImages[0];
      var back = loadedImages[1];
      var dpi = RENDER_DPI;
      var mm = function (value) { return Math.round(value * dpi / 25.4); };
      var pageWidth = mm(210);
      var pageHeight = mm(297);
      var cardWidth = mm(85.6);
      var cardHeight = mm(54);
      var gap = mm(4);
      var sideMargin = Math.round((pageWidth - (cardWidth * 2 + gap)) / 2);
      var top = mm(18);
      var canvas = document.createElement('canvas');
      canvas.width = pageWidth;
      canvas.height = pageHeight;
      var context = canvas.getContext('2d');
      context.fillStyle = '#ffffff';
      context.fillRect(0, 0, pageWidth, pageHeight);
      context.imageSmoothingEnabled = true;
      context.imageSmoothingQuality = 'high';

      function roundBox(x, y, width, height) {
        context.save();
        context.beginPath();
        if (context.roundRect) context.roundRect(x, y, width, height, mm(2));
        else context.rect(x, y, width, height);
        context.fillStyle = '#eef7fb';
        context.fill();
        context.strokeStyle = '#c8dce5';
        context.lineWidth = mm(.7);
        context.stroke();
        context.restore();
      }

      function drawCard(image, x) {
        roundBox(x, top, cardWidth, cardHeight);
        var inset = mm(1.2);
        var maxWidth = cardWidth - inset * 2;
        var maxHeight = cardHeight - inset * 2;
        var scale = Math.min(maxWidth / image.naturalWidth, maxHeight / image.naturalHeight);
        var width = Math.max(1, Math.round(image.naturalWidth * scale));
        var height = Math.max(1, Math.round(image.naturalHeight * scale));
        var imageX = x + Math.round((cardWidth - width) / 2);
        var imageY = top + Math.round((cardHeight - height) / 2);
        context.drawImage(image, imageX, imageY, width, height);
      }
      drawCard(front, sideMargin);
      drawCard(back, sideMargin + cardWidth + gap);
      return canvas;
    }

    function canvasBlob(canvas, type, quality) {
      return new Promise(function (resolve, reject) {
        canvas.toBlob(function (blob) {
          if (blob) resolve(blob); else reject(new Error('RC file create nahi ho paayi.'));
        }, type, quality);
      });
    }

    async function makeCardPng(frontValue, backValue) {
      return canvasBlob(await renderCardCanvas(frontValue, backValue), 'image/png');
    }

    function textBytes(value) {
      return new TextEncoder().encode(value);
    }

    function makePdfFromCanvas(canvas, pageWidth, pageHeight) {
      var dataUrl = canvas.toDataURL('image/jpeg', .94);
      var encoded = dataUrl.slice(dataUrl.indexOf(',') + 1);
      var binary = atob(encoded);
      var imageBytes = new Uint8Array(binary.length);
      for (var i = 0; i < binary.length; i += 1) imageBytes[i] = binary.charCodeAt(i);

      pageWidth = pageWidth || (210 / 25.4 * 72);
      pageHeight = pageHeight || (297 / 25.4 * 72);
      var content = 'q\n' + pageWidth.toFixed(2) + ' 0 0 ' + pageHeight.toFixed(2) + ' 0 0 cm\n/Im0 Do\nQ\n';
      var chunks = [];
      var offsets = [0];
      var byteLength = 0;
      function push(bytes) { chunks.push(bytes); byteLength += bytes.length; }
      function object(number, parts) {
        offsets[number] = byteLength;
        push(textBytes(number + ' 0 obj\n'));
        parts.forEach(push);
        push(textBytes('\nendobj\n'));
      }

      push(new Uint8Array([37, 80, 68, 70, 45, 49, 46, 52, 10, 37, 255, 255, 255, 255, 10]));
      object(1, [textBytes('<< /Type /Catalog /Pages 2 0 R >>')]);
      object(2, [textBytes('<< /Type /Pages /Kids [3 0 R] /Count 1 >>')]);
      object(3, [textBytes('<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ' + pageWidth.toFixed(2) + ' ' + pageHeight.toFixed(2) + '] /Resources << /XObject << /Im0 5 0 R >> >> /Contents 4 0 R >>')]);
      object(4, [textBytes('<< /Length ' + textBytes(content).length + ' >>\nstream\n'), textBytes(content), textBytes('endstream')]);
      object(5, [textBytes('<< /Type /XObject /Subtype /Image /Width ' + canvas.width + ' /Height ' + canvas.height + ' /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ' + imageBytes.length + ' >>\nstream\n'), imageBytes, textBytes('\nendstream')]);

      var xrefOffset = byteLength;
      var xref = 'xref\n0 6\n0000000000 65535 f \n';
      for (var objectNumber = 1; objectNumber <= 5; objectNumber += 1) {
        xref += String(offsets[objectNumber]).padStart(10, '0') + ' 00000 n \n';
      }
      xref += 'trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n' + xrefOffset + '\n%%EOF';
      push(textBytes(xref));
      return new Blob(chunks, { type: 'application/pdf' });
    }

    async function makeCardPdf(frontValue, backValue) {
      var canvas = await renderReferenceCanvas(frontValue, backValue);
      return makePdfFromCanvas(canvas, 210 / 25.4 * 72, 297 / 25.4 * 72);
    }

    function downloadData(blob, fileName) {
      var url = URL.createObjectURL(blob);
      var link = document.createElement('a');
      link.href = url;
      link.download = fileName;
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(function () { URL.revokeObjectURL(url); }, 2000);
    }

    function prepareVehicleNumber() {
      var input = $('#vrn-input');
      var vrn = normalizeVrn(input.value);
      input.value = vrn;
      if (!validVrn(vrn)) {
        input.classList.remove('shake'); void input.offsetWidth; input.classList.add('shake');
        toast('Vehicle number check karo', 'Example format: RJ14AB1234', 'error');
        return '';
      }
      state.pendingVrn = vrn;
      return vrn;
    }

    function showDownloadOptions() {
      if (!prepareVehicleNumber()) return;
      $('#download-options-modal').hidden = false;
      document.body.style.overflow = 'hidden';
    }

    function closeDownloadOptions() {
      $('#download-options-modal').hidden = true;
      document.body.style.overflow = '';
    }

    function purchaseKeyFor(vrn, downloadType) {
      var mobile = state.user && state.user.mobile ? state.user.mobile : 'session';
      var storageKey = 'instant-rccard-purchase:' + mobile + ':' + vrn + ':' + downloadType;
      var key = '';
      try { key = window.localStorage.getItem(storageKey) || ''; } catch (error) {}
      if (!key) {
        key = 'PURCHASE-' + Date.now().toString(36).toUpperCase() + '-' + Math.random().toString(36).slice(2, 10).toUpperCase();
        try { window.localStorage.setItem(storageKey, key); } catch (error) {}
      }
      state.purchaseRequestKey = key;
      state.purchaseRequestVrn = vrn;
      state.purchaseRequestType = downloadType;
      return key;
    }

    function clearPurchaseKey(vrn, downloadType) {
      var mobile = state.user && state.user.mobile ? state.user.mobile : 'session';
      try { window.localStorage.removeItem('instant-rccard-purchase:' + mobile + ':' + vrn + ':' + downloadType); } catch (error) {}
      state.purchaseRequestKey = '';
      state.purchaseRequestVrn = '';
      state.purchaseRequestType = '';
    }

    async function purchaseAndDownload(downloadType) {
      var vrn = state.pendingVrn;
      var price = priceForDownload(downloadType);
      if (!vrn || state.busy) return;
      if (downloadType === 'mparivahan') {
        closeDownloadOptions();
        setDownloadStatus('MParivahan RC — Coming Soon!', 'Ye format jaldi available hoga. Abhi RC Card option use karein.', 'error');
        toast('Coming Soon!', 'MParivahan RC format abhi available nahi hai.', 'info');
        return;
      }

      // Format choose hone ke baad exact price check; low balance par provider call nahi hoga.
      if (state.user && Number(state.user.wallet || 0) < price) {
        closeDownloadOptions();
        showWalletAlert('Wallet balance ' + formatMoney(state.user.wallet || 0) + ' hai. Is format ke liye ' + formatMoney(price) + ' chahiye.');
        setDownloadStatus('Recharge your wallet', 'Is format ke liye minimum ' + formatMoney(price) + ' wallet balance chahiye.', 'error');
        toast('Recharge your wallet', 'RC Card download ke liye ' + formatMoney(price) + ' chahiye.', 'error');
        return;
      }

      closeDownloadOptions();
      state.busy = true;
      var button = $('#rc-button');
      setButtonLoading(button, true);
      setDownloadStatus('RC fetch ho rahi hai…', 'Front aur back image provider se aa rahi hai.', 'loading');
      setFetchingOverlay(true);
      hideWalletAlert();
      var idempotencyKey = purchaseKeyFor(vrn, downloadType);
      try {
        var response = await callServer('buyRc', [vrn, downloadType, idempotencyKey]);
        if (!response.success) {
          if (response.code === 'COMING_SOON') {
            setDownloadStatus('MParivahan RC — Coming Soon!', response.message, 'error');
            toast('Coming Soon!', response.message, 'info');
          } else if (response.code === 'LOW_BALANCE') {
            var requiredPrice = Number(response.requiredPrice || price);
            showWalletAlert('Wallet balance ' + formatMoney(response.wallet || 0) + ' hai. Is format ke liye ' + formatMoney(requiredPrice) + ' chahiye.');
            setDownloadStatus('Recharge your wallet', 'Is format ke liye minimum ' + formatMoney(requiredPrice) + ' wallet balance chahiye.', 'error');
            toast('Recharge your wallet', 'RC Card download ke liye ' + formatMoney(requiredPrice) + ' chahiye.', 'error');
          } else {
            setDownloadStatus('RC download failed', response.message, 'error');
            toast('RC fetch failed', response.message, 'error');
          }
          if (response.wallet != null) updateWallet(response.wallet);
          return;
        }
        var combined = downloadType === 'rc-card'
          ? await makeCardPdf(response.data.front, response.data.back)
          : await makeA4Png(response.data.front, response.data.back);
        updateWallet(response.wallet);
        // File download ko transaction-list refresh se block nahi karte; history background me refresh hoti rahe.
        loadTransactions();
        var label = downloadType === 'rc-card' ? 'RC-Card' : 'MParivahan-RC';
        var extension = downloadType === 'rc-card' ? 'pdf' : 'png';
        var fileName = response.data.vrn + '-' + label + '.' + extension;
        downloadData(combined, fileName);
        clearPurchaseKey(vrn, downloadType);
        setDownloadStatus((extension === 'pdf' ? 'PDF' : 'PNG') + ' download started ✓', fileName + ' save ho rahi hai.', 'success');
        toast('Instant download ready', response.data.vrn + ' ki clear RC file download ho rahi hai.', 'success');
        $('#vrn-input').value = '';
        state.pendingVrn = '';
      } catch (error) {
        setDownloadStatus('Download failed', error.message, 'error');
        toast('Something went wrong', error.message, 'error');
      } finally {
        setFetchingOverlay(false);
        state.busy = false;
        setButtonLoading(button, false, 'Download RC PDF <span>↗</span>');
      }
    }

    function fillAdminUserResult(user, defaultPrice) {
      state.selectedAdminMobile = user.mobile;
      state.selectedAdminQuery = user.mobile;
      state.defaultRcCardPrice = Number(defaultPrice || state.defaultRcCardPrice || 15);
      var personalRate = user.prices && user.prices.rcCard != null ? Number(user.prices.rcCard) : state.defaultRcCardPrice;
      var isCustom = user.customRcCardPrice != null;
      $('#admin-user-result').hidden = false;
      $('#admin-user-name').textContent = user.name;
      $('#admin-user-mobile').textContent = '+91 ' + user.mobile;
      if ($('#admin-user-email')) $('#admin-user-email').textContent = user.email || 'Email not set';
      if ($('#admin-user-rate-label')) {
        $('#admin-user-rate-label').textContent = isCustom
          ? ('Custom RC rate ' + formatMoney(personalRate))
          : ('Default RC rate ' + formatMoney(personalRate));
      }
      $('#admin-user-balance').innerHTML = formatMoney(user.wallet) + '<small>current wallet</small>';
      $('#admin-recharge-button').disabled = false;
      if ($('#admin-debit-button')) $('#admin-debit-button').disabled = false;
      if ($('#admin-user-rate-tools')) {
        $('#admin-user-rate-tools').hidden = false;
        $('#admin-user-rate-input').value = personalRate;
        if ($('#admin-user-rate-help')) {
          $('#admin-user-rate-help').textContent = isCustom
            ? ('Is user ka custom rate ' + formatMoney(personalRate) + ' hai. Default global rate ' + formatMoney(state.defaultRcCardPrice) + ' hai.')
            : ('Abhi default global rate ' + formatMoney(state.defaultRcCardPrice) + ' apply ho raha hai. Alag rate type karke set kar sakte ho.');
        }
      }
    }

    async function findAdminUser() {
      var query = String($('#admin-search-mobile').value || '').trim();
      if (!query) { toast('Search check karo', 'User ka mobile number ya email daalo.', 'error'); return; }
      var mobile = normalizeMobile(query);
      if (validMobile(mobile)) {
        query = mobile;
        $('#admin-search-mobile').value = mobile;
      } else if (query.includes('@')) {
        query = query.toLowerCase();
        $('#admin-search-mobile').value = query;
        if (!validEmail(query)) { toast('Email check karo', 'Valid email address daalo.', 'error'); return; }
      } else if (/^[A-Za-z][A-Za-z .'-]{2,}$/.test(query)) {
        // Naam se search: server sirf tab user deta hai jab naam ek hi user se match kare.
        query = query.replace(/\s+/g, ' ').trim();
        $('#admin-search-mobile').value = query;
      } else {
        toast('Search check karo', 'Valid 10-digit mobile, email ya user ka naam daalo.', 'error');
        return;
      }
      var button = $('#admin-search-button');
      setButtonLoading(button, true, 'Find user');
      try {
        var response = await callServer('adminFindUser', [query]);
        if (!response.success) {
          $('#admin-user-result').hidden = true;
          if ($('#admin-user-rate-tools')) $('#admin-user-rate-tools').hidden = true;
          state.selectedAdminMobile = '';
          state.selectedAdminQuery = '';
          toast('User nahi mila', response.message, 'error');
          return;
        }
        fillAdminUserResult(response.user, response.defaultRcCardPrice);
        toast('User found', response.user.name + ' ka account ready hai.', 'success');
      } catch (error) { toast('Admin error', error.message, 'error'); }
      finally { setButtonLoading(button, false, 'Find user'); }
    }

    async function saveAdminUserRate(clear) {
      if (!state.selectedAdminMobile && !state.selectedAdminQuery) {
        toast('Pehle user search karo', 'Mobile ya email se user find karo.', 'error');
        return;
      }
      var button = clear ? $('#admin-user-rate-clear') : $('#admin-user-rate-save');
      var price = clear ? null : Number($('#admin-user-rate-input').value);
      if (!clear && (!Number.isFinite(price) || price < 1 || price > 1000)) {
        toast('Rate error', 'User RC rate ₹1 se ₹1000 ke beech ek valid number daalo.', 'error');
        return;
      }
      setButtonLoading(button, true, clear ? 'Use default' : 'Set user rate');
      try {
        var response = await callServer('adminSetUserRate', [state.selectedAdminQuery || state.selectedAdminMobile, price, clear === true]);
        if (!response.success) { toast('Rate save failed', response.message, 'error'); return; }
        fillAdminUserResult(response.user, response.defaultRcCardPrice);
        toast(clear ? 'Default rate apply' : 'User rate set', response.message, 'success');
        loadAdminUsers(state.adminUsersQuery, { silent: true });
      } catch (error) { toast('Rate error', error.message, 'error'); }
      finally { setButtonLoading(button, false, clear ? 'Use default' : 'Set user rate'); }
    }

    // ---------- Admin: Users & rates tab ----------
    var adminUsersCache = [];

    function rowForMobile(mobile) {
      var rows = $$('#admin-users-body tr');
      for (var i = 0; i < rows.length; i += 1) {
        if (rows[i].dataset.mobile === mobile) return rows[i];
      }
      return null;
    }

    function renderAdminUsersTable() {
      var body = $('#admin-users-body');
      if (!body) return;
      if (!adminUsersCache.length) {
        body.innerHTML = '<tr><td colspan="6">Koi user nahi mila. Search clear karke "Show all" try karo.</td></tr>';
        return;
      }
      body.innerHTML = adminUsersCache.map(function (user) {
        var isCustom = user.customRcCardPrice != null;
        var mobile = escapeHtml(user.mobile);
        var statusCell = hasAdminPermission('access')
          ? (user.active === false
            ? '<button class="ghost-button small-blue" type="button" data-user-toggle="' + mobile + '" data-active="1">Unblock</button> <span class="rate-state blocked">BLOCKED</span>'
            : '<button class="ghost-button small-blue" type="button" data-user-toggle="' + mobile + '" data-active="0">Block</button>')
          : '<span class="admin-user-sub">View only</span>';
        return '<tr data-mobile="' + mobile + '">' +
          '<td><b class="admin-user-cell">' + escapeHtml(user.name || 'User') + (user.role === 'admin' ? ' (' + escapeHtml(user.adminLabel || (user.isMainAdmin ? 'Main Admin' : 'Admin Assistant')) + ')' : '') + '</b><small class="admin-user-sub">' + escapeHtml(user.email || 'Email not set') + '</small></td>' +
          '<td>+91 ' + mobile + '</td>' +
          '<td>' + escapeHtml(formatMoney(user.wallet)) + '</td>' +
          '<td><span class="admin-rate-cell"><input class="admin-row-rate" type="number" min="1" max="1000" step="1" value="' + escapeHtml(String(user.prices && user.prices.rcCard != null ? user.prices.rcCard : user.rate)) + '" data-mobile="' + mobile + '" aria-label="RC rate" /><span class="rate-state ' + (isCustom ? 'custom' : 'default') + '">' + (isCustom ? 'CUSTOM' : 'DEFAULT') + '</span></span></td>' +
          '<td><span class="admin-rate-actions"><button class="blue-button small-blue" type="button" data-rate-save="' + mobile + '">Set rate</button>' +
          (isCustom ? '<button class="ghost-button small-blue" type="button" data-rate-reset="' + mobile + '">Default</button>' : '') +
          '</span></td>' +
          '<td>' + statusCell + '</td>' +
          '</tr>';
      }).join('');
    }

    function renderAdminRateLog(log) {
      var body = $('#admin-rate-log-body');
      if (!body) return;
      if (!log || !log.length) { body.innerHTML = '<tr><td colspan="4">Abhi koi rate change nahi hua.</td></tr>'; return; }
      body.innerHTML = log.map(function (entry) {
        return '<tr><td>' + escapeHtml(formatDate(entry.time)) + '</td><td>' + escapeHtml((entry.name || 'User') + ' • +91 ' + entry.mobile) + '</td><td>' + escapeHtml(entry.from == null ? 'Default' : formatMoney(entry.from)) + '</td><td>' + escapeHtml(entry.to == null ? 'Default' : formatMoney(entry.to)) + '</td></tr>';
      }).join('');
    }

    function renderAdminUsers(response) {
      adminUsersCache = Array.isArray(response.users) ? response.users : [];
      state.adminUsersQuery = response.query || '';
      state.defaultRcCardPrice = Number(response.defaultRcCardPrice || state.defaultRcCardPrice || 15);
      if ($('#admin-rate-default')) $('#admin-rate-default').textContent = formatMoney(state.defaultRcCardPrice);
      if ($('#admin-rate-total-users')) $('#admin-rate-total-users').textContent = Number(response.total || 0).toLocaleString('en-IN');
      if ($('#admin-rate-custom-users')) $('#admin-rate-custom-users').textContent = Number(response.customRateCount || 0).toLocaleString('en-IN');
      if ($('#admin-rate-match-chip')) {
        var matched = Number(response.matched || 0);
        var shown = Number(response.shown || 0);
        var hasQuery = Boolean(String(response.query || '').trim());
        var truncated = matched > shown;
        $('#admin-rate-match-chip').hidden = !hasQuery && !truncated;
        if (hasQuery || truncated) {
          $('#admin-rate-match-count').textContent = shown.toLocaleString('en-IN') + ' / ' + matched.toLocaleString('en-IN') + ' shown' + (truncated ? ' — search se chhota karo' : '');
        }
      }
      renderAdminUsersTable();
      renderAdminRateLog(response.rateLog);
    }

    // ---------- Admin: delegated access tab ----------
    var adminAccessCache = [];
    var ADMIN_ACCESS_KEYS = ['kpi', 'recharge', 'rates', 'ads', 'transactions', 'access'];

    function renderAdminAccessUsers(response) {
      var list = $('#admin-access-list');
      if (!list) return;
      adminAccessCache = Array.isArray(response.users) ? response.users : [];
      state.adminAccessQuery = response.query || '';
      var labels = {
        kpi: 'KPI dashboard',
        recharge: 'Add payment / recharge',
        rates: 'Rate setting',
        ads: 'Advertisements',
        transactions: 'Transaction view',
        access: 'Admin access'
      };
      if (!adminAccessCache.length) {
        list.innerHTML = '<div class="empty-list">Is search ka koi existing account nahi mila.</div>';
        return;
      }
      var currentMobile = state.user && state.user.mobile;
      list.innerHTML = adminAccessCache.map(function (user) {
        var locked = user.mobile === currentMobile;
        var permissions = user.adminPermissions || {};
        var isAdmin = user.role === 'admin';
        var permissionInputs = ADMIN_ACCESS_KEYS.map(function (key) {
          return '<label><input type="checkbox" data-access-permission="' + key + '" ' + (permissions[key] === true ? 'checked' : '') + ' />' + labels[key] + '</label>';
        }).join('');
        var actionText = isAdmin ? 'Save selected access' : 'Make admin with selected access';
        var disabled = locked ? ' disabled' : '';
        return '<article class="admin-access-card ' + (locked ? 'locked' : '') + '" data-access-mobile="' + escapeHtml(user.mobile) + '">' +
          '<div class="admin-access-head"><div><b>' + escapeHtml(user.name || 'User') + '</b><small>+91 ' + escapeHtml(user.mobile || '') + ' · ' + escapeHtml(user.email || 'Email not set') + '</small></div><span class="admin-access-state ' + (isAdmin ? 'admin' : '') + '">' + (isAdmin ? escapeHtml(user.adminLabel || (user.isMainAdmin ? 'Main Admin' : 'Admin Assistant')) : 'NORMAL USER') + '</span></div>' +
          '<div class="admin-access-permissions">' + permissionInputs + '</div>' +
          '<div class="admin-access-actions"><button class="blue-button small-blue" type="button" data-access-save' + disabled + '>' + actionText + '</button>' +
          (isAdmin ? '<button class="ghost-button small-blue" type="button" data-access-remove' + disabled + '>Remove admin access</button>' : '') +
          (locked ? '<small class="admin-help">Apne current admin access ko change nahi kar sakte.</small>' : '') +
          '</div></article>';
      }).join('');
      $$('#admin-access-list [data-access-save]').forEach(function (button) {
        button.addEventListener('click', function () { updateAdminAccess(button, true); });
      });
      $$('#admin-access-list [data-access-remove]').forEach(function (button) {
        button.addEventListener('click', function () { updateAdminAccess(button, false); });
      });
    }

    async function loadAdminAccessUsers(query, options) {
      if (!state.user || state.user.role !== 'admin' || !hasAdminPermission('access')) return;
      var value = String(query == null ? '' : query).trim();
      var button = options && options.silent ? null : $('#admin-access-search-button');
      if (button) setButtonLoading(button, true, 'Find users');
      try {
        var response = await callServer('adminListAccess', [value]);
        if (!response.success) { toast('Access search failed', response.message || 'User list load nahi hui.', 'error'); return; }
        renderAdminAccessUsers(response);
      } catch (error) {
        toast('Access search failed', error.message, 'error');
      } finally {
        if (button) setButtonLoading(button, false, 'Find users');
      }
    }

    function accessPermissionsFromCard(card) {
      var permissions = {};
      ADMIN_ACCESS_KEYS.forEach(function (key) {
        var input = card.querySelector('[data-access-permission="' + key + '"]');
        permissions[key] = Boolean(input && input.checked);
      });
      return permissions;
    }

    async function updateAdminAccess(button, makeAdmin) {
      if (!hasAdminPermission('access')) { toast('Access restricted', 'Is admin account ko access management nahi diya gaya.', 'error'); return; }
      var card = button && button.closest ? button.closest('[data-access-mobile]') : null;
      if (!card) return;
      var mobile = card.dataset.accessMobile;
      if (!mobile || (state.user && mobile === state.user.mobile)) {
        toast('Access protected', 'Apne current admin access ko change nahi kar sakte.', 'error');
        return;
      }
      var original = String(button.textContent || (makeAdmin ? 'Save selected access' : 'Remove admin access')).trim();
      setButtonLoading(button, true, original);
      try {
        var response = await callServer('adminUpdateAccess', [mobile, makeAdmin, makeAdmin ? accessPermissionsFromCard(card) : {}]);
        if (!response.success) { toast('Access update failed', response.message, 'error'); return; }
        toast(makeAdmin ? 'Admin access saved' : 'Admin access removed', response.message, 'success');
        await loadAdminAccessUsers(state.adminAccessQuery, { silent: true });
        if (hasAdminPermission('kpi')) loadAdminStats();
      } catch (error) {
        toast('Access update failed', error.message, 'error');
      } finally {
        setButtonLoading(button, false, original);
      }
    }

    async function loadAdminUsers(query, options) {
      if (!state.user || state.user.role !== 'admin' || !hasAdminPermission('rates')) return;
      var settings = options || {};
      var button = settings.silent ? null : (query ? $('#admin-users-search-button') : $('#admin-users-all-button'));
      if (button) setButtonLoading(button, true, query ? 'Search users' : 'Show all');
      var response = null;
      try {
        response = await callServer('adminListUsers', [query == null ? '' : query]);
        if (!response.success) { toast('Users load failed', response.message || 'List load nahi ho paayi.', 'error'); return; }
        renderAdminUsers(response);
      } catch (error) {
        toast('Users load failed', error.message, 'error');
      } finally {
        if (button) setButtonLoading(button, false, query ? 'Search users' : 'Show all');
      }
    }

    async function searchAdminUsersList() {
      var query = String($('#admin-users-search').value || '').trim();
      await loadAdminUsers(query);
    }

    async function showAllAdminUsers() {
      $('#admin-users-search').value = '';
      await loadAdminUsers('');
    }

    async function saveAdminRowRate(mobile, clear, button) {
      var row = rowForMobile(mobile);
      var input = row ? row.querySelector('.admin-row-rate') : null;
      var price = clear ? null : Number(input ? input.value : NaN);
      if (!clear && (!Number.isFinite(price) || price < 1 || price > 1000)) {
        toast('Rate error', 'RC rate ₹1 se ₹1000 ke beech ek valid number daalo.', 'error');
        return;
      }
      if (button) setButtonLoading(button, true, clear ? 'Default' : 'Set rate');
      try {
        var response = await callServer('adminSetUserRate', [mobile, price, clear === true]);
        if (!response.success) { toast('Rate save failed', response.message, 'error'); return; }
        toast(clear ? 'Default rate apply' : 'User rate set', response.message, 'success');
        if (state.selectedAdminMobile === mobile && response.user) fillAdminUserResult(response.user, response.defaultRcCardPrice);
        await loadAdminUsers(state.adminUsersQuery, { silent: true });
      } catch (error) {
        toast('Rate error', error.message, 'error');
      } finally {
        if (button) setButtonLoading(button, false, clear ? 'Default' : 'Set rate');
      }
    }

    async function bulkAdminRate(clear, button) {
      var price = clear ? null : Number($('#admin-bulk-rate-input').value);
      if (!clear && (!Number.isFinite(price) || price < 1 || price > 1000)) {
        toast('Rate error', 'Bulk rate ₹1 se ₹1000 ke beech ek valid number daalo.', 'error');
        return;
      }
      var label = clear ? 'Sabhi custom rate hatao' : 'Sabhi users par apply karo';
      if (!state.bulkConfirm) {
        state.bulkConfirm = true;
        setButtonLoading(button, false, 'Confirm? Dobara click karo');
        setTimeout(function () {
          if (state.bulkConfirm) { state.bulkConfirm = false; setButtonLoading(button, false, label); }
        }, 7000);
        return;
      }
      state.bulkConfirm = false;
      setButtonLoading(button, true, label);
      try {
        var response = await callServer('adminBulkRate', [price, clear === true, 'all', [], true]);
        if (!response.success) { toast('Bulk rate failed', response.message, 'error'); return; }
        toast(clear ? 'Custom rates cleared' : 'Bulk rate applied', response.message, 'success');
        await loadAdminUsers(state.adminUsersQuery, { silent: true });
      } catch (error) {
        toast('Bulk rate error', error.message, 'error');
      } finally {
        setButtonLoading(button, false, label);
      }
    }

    async function toggleAdminUserStatus(mobile, nextActive, button) {
      if (!hasAdminPermission('access')) { toast('Access restricted', 'Is admin account ko user status access nahi diya gaya.', 'error'); return; }
      var label = nextActive ? 'Unblock' : 'Block';
      if (!nextActive && !state.bulkConfirm) {
        state.bulkConfirm = true;
        setButtonLoading(button, false, 'Confirm? Dobara click karo');
        setTimeout(function () {
          if (state.bulkConfirm) { state.bulkConfirm = false; setButtonLoading(button, false, label); }
        }, 7000);
        return;
      }
      state.bulkConfirm = false;
      setButtonLoading(button, true, label);
      try {
        var response = await callServer('adminSetUserStatus', [mobile, nextActive]);
        if (!response.success) { toast('Status update failed', response.message, 'error'); return; }
        toast(nextActive ? 'User unblocked' : 'User blocked', response.message, 'success');
        await loadAdminUsers(state.adminUsersQuery, { silent: true });
      } catch (error) {
        toast('Status error', error.message, 'error');
      } finally {
        setButtonLoading(button, false, label);
      }
    }

    function exportAdminUsersCsv() {
      if (!state.user || state.user.role !== 'admin') return;
      if (!adminUsersCache.length) { toast('CSV export', 'Pehle user list load karo.', 'error'); return; }
      var rows = [['Name', 'Email', 'Mobile', 'Wallet', 'RC Card Rate', 'Rate Type', 'Status', 'Created']];
      adminUsersCache.forEach(function (user) {
        rows.push([
          user.name || '',
          user.email || '',
          '+91 ' + user.mobile,
          Number(user.wallet || 0),
          Number(user.prices && user.prices.rcCard != null ? user.prices.rcCard : user.rate),
          user.customRcCardPrice != null ? 'Custom' : 'Default',
          user.active === false ? 'Blocked' : 'Active',
          user.createdAt || ''
        ]);
      });
      var csv = rows.map(function (row) {
        return row.map(function (cell) { return '"' + String(cell == null ? '' : cell).replace(/"/g, '""') + '"'; }).join(',');
      }).join('\r\n');
      var blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
      var url = URL.createObjectURL(blob);
      var link = document.createElement('a');
      link.href = url;
      link.download = 'instant-rccard-users-' + new Date().toISOString().slice(0, 10) + '.csv';
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(function () { URL.revokeObjectURL(url); }, 2000);
      toast('CSV ready', adminUsersCache.length + ' user(s) ka CSV download ho raha hai.', 'success');
    }

    async function rechargeAdminUser() {
      if (!hasAdminPermission('recharge')) { toast('Access restricted', 'Is admin account ko recharge access nahi diya gaya.', 'error'); return; }
      var amount = Number($('#admin-amount').value);
      if (!state.selectedAdminMobile) { toast('Pehle user search karo', 'Mobile number se user find karo.', 'error'); return; }
      if (!amount || amount <= 0) { toast('Amount enter karo', 'Recharge amount ₹1 se zyada hona chahiye.', 'error'); return; }
      var userName = $('#admin-user-name') ? $('#admin-user-name').textContent : 'selected user';
      if (!window.confirm(userName + ' ke wallet me ₹' + Math.round(amount) + ' recharge karna hai?')) return;
      var button = $('#admin-recharge-button');
      setButtonLoading(button, true, 'Recharge');
      try {
        var response = await callServer('adminRecharge', [state.selectedAdminMobile, amount, 'Manual admin recharge']);
        if (!response.success) { toast('Recharge failed', response.message, 'error'); return; }
        $('#admin-user-balance').innerHTML = formatMoney(response.user.wallet) + '<small>current wallet</small>';
        $('#admin-amount').value = '';
        await loadAdminTransactions();
        loadAdminStats();
        toast('Recharge successful', response.user.name + ' ke wallet me ' + formatMoney(amount) + ' add ho gaye.', 'success');
      } catch (error) { toast('Recharge error', error.message, 'error'); }
      finally { setButtonLoading(button, false, 'Recharge'); }
    }

    async function debitAdminUser() {
      if (!hasAdminPermission('recharge')) { toast('Access restricted', 'Is admin account ko wallet access nahi diya gaya.', 'error'); return; }
      var amount = Number($('#admin-amount').value);
      if (!state.selectedAdminMobile) { toast('Pehle user search karo', 'Mobile number se user find karo.', 'error'); return; }
      if (!amount || amount <= 0) { toast('Amount enter karo', 'Debit amount ₹1 se zyada hona chahiye.', 'error'); return; }
      var userName = $('#admin-user-name') ? $('#admin-user-name').textContent : 'selected user';
      if (!window.confirm(userName + ' ke wallet se ₹' + Math.round(amount) + ' debit karna hai?')) return;
      var button = $('#admin-debit-button');
      setButtonLoading(button, true, 'Debit');
      try {
        var response = await callServer('adminDebit', [state.selectedAdminMobile, amount, 'Manual admin wallet debit']);
        if (!response.success) { toast('Debit failed', response.message, 'error'); return; }
        $('#admin-user-balance').innerHTML = formatMoney(response.user.wallet) + '<small>current wallet</small>';
        if (response.admin && state.user && response.admin.mobile === state.user.mobile) {
          state.user = response.admin;
          updateWallet(response.admin.wallet);
        }
        $('#admin-amount').value = '';
        await loadAdminTransactions();
        loadAdminStats();
        toast('Debit successful', response.user.name + ' ke wallet se ' + formatMoney(amount) + ' debit ho gaye. Admin wallet me credit hua.', 'success');
      } catch (error) { toast('Debit error', error.message, 'error'); }
      finally { setButtonLoading(button, false, 'Debit'); }
    }

    async function loadAdminTopupRequests() {
      if (!state.user || state.user.role !== 'admin' || !hasAdminPermission('recharge')) return;
      try {
        var response = await callServer('adminGetTopupRequests', []);
        if (response.success) renderAdminTopupRequests(response.requests || []);
      } catch (error) {
        var list = $('#admin-topup-request-list');
        if (list) list.innerHTML = '<div class="empty-list">Payment requests load nahi ho paayi.</div>';
      }
    }

    function topupRequestMarkup(request) {
      var status = String(request.status || 'PENDING').toLowerCase();
      var requested = formatMoney(request.amountRequested);
      var amountHtml = status === 'pending'
        ? '<input data-topup-amount="' + escapeHtml(request.id) + '" type="number" min="1" max="100000" step="1" value="' + Number(request.amountRequested || 0) + '" aria-label="Approved amount">'
        : '<strong>' + escapeHtml(formatMoney(request.amountApproved == null ? request.amountRequested : request.amountApproved)) + '</strong>';
      var actions = status === 'pending'
        ? '<div class="topup-request-actions"><button class="topup-request-approve" data-topup-approve="' + escapeHtml(request.id) + '" type="button">Approve</button><button class="topup-request-reject" data-topup-reject="' + escapeHtml(request.id) + '" type="button">Reject</button></div>'
        : '';
      var decision = request.decidedAt ? ' · ' + formatDate(request.decidedAt) : '';
      return '<div class="topup-request-row"><div class="topup-request-main"><b>' + escapeHtml(request.name || 'User') + ' · +91 ' + escapeHtml(request.mobile || '—') + '</b><small>Requested ' + escapeHtml(requested) + ' · ' + escapeHtml(formatDate(request.createdAt)) + decision + '</small><span class="topup-request-status ' + escapeHtml(status) + '">' + escapeHtml(request.status || 'PENDING') + '</span><div class="topup-request-id">ID: ' + escapeHtml(request.id) + '</div>' + (request.rejectReason ? '<small>Reason: ' + escapeHtml(request.rejectReason) + '</small>' : '') + '</div><div class="topup-request-side">' + amountHtml + actions + '</div></div>';
    }

    function wireTopupRequestButtons(root) {
      if (!root) return;
      Array.prototype.slice.call(root.querySelectorAll('[data-topup-approve]')).forEach(function (button) { button.addEventListener('click', function () { resolveAdminTopup(button.dataset.topupApprove, 'APPROVED', button); }); });
      Array.prototype.slice.call(root.querySelectorAll('[data-topup-reject]')).forEach(function (button) { button.addEventListener('click', function () { resolveAdminTopup(button.dataset.topupReject, 'REJECTED', button); }); });
    }

    function renderAdminTopupRequests(requests) {
      var list = $('#admin-topup-request-list');
      if (!list) return;
      if (!requests.length) {
        list.innerHTML = '<div class="empty-list">Koi wallet payment request nahi hai.</div>';
        return;
      }
      list.innerHTML = requests.map(topupRequestMarkup).join('');
      wireTopupRequestButtons(list);
    }

    async function resolveAdminTopup(requestId, decision, sourceButton) {
      if (!hasAdminPermission('recharge')) return;
      var row = sourceButton.closest('.topup-request-row');
      var input = row ? row.querySelector('[data-topup-amount]') : null;
      var amount = input ? Number(input.value) : '';
      if (decision === 'APPROVED') {
        if (!Number.isFinite(amount) || amount < 1 || amount > 100000) {
          toast('Amount check karo', 'Approved amount ₹1 se ₹100000 ke beech hona chahiye.', 'error');
          return;
        }
        if (!window.confirm('Is request ko ' + formatMoney(amount) + ' se approve karna hai?')) return;
      } else if (!window.confirm('Is wallet payment request ko reject karna hai?')) return;
      sourceButton.disabled = true;
      try {
        // Keep rejection to one clear confirmation; the server stores a safe default reason.
        var reason = decision === 'REJECTED' ? 'Payment verify nahi ho paayi.' : '';
        var response = await callServer('adminResolveTopupRequest', [requestId, decision, decision === 'APPROVED' ? Math.round(amount) : '', reason]);
        if (!response.success) { toast('Request update failed', response.message || 'Please refresh karke dobara try karein.', 'error'); return; }
        if (response.user && state.user && response.user.mobile === state.user.mobile) {
          state.user.wallet = response.user.wallet;
          updateWallet(response.user.wallet);
        }
        await loadAdminTopupRequests();
        if (hasAdminPermission('transactions')) await loadAdminTransactions();
        if (hasAdminPermission('kpi')) {
          loadAdminStats();
          if (state.adminKpiDetail && $('#admin-kpi-detail-panel') && !$('#admin-kpi-detail-panel').hidden) loadKpiDetails(state.adminKpiDetail, true);
        }
        toast(decision === 'APPROVED' ? 'Topup approved' : 'Topup rejected', response.message || 'Request status update ho gaya.', 'success');
      } catch (error) { toast('Request update error', error.message, 'error'); }
      finally { sourceButton.disabled = false; }
    }

    function updateAdminTransactionTabs() {
      $$('[data-admin-transaction-category]').forEach(function (button) {
        button.classList.toggle('active', button.dataset.adminTransactionCategory === state.adminTransactionCategory);
      });
      if ($('#admin-transactions-title')) $('#admin-transactions-title').textContent = state.adminTransactionCategory === 'rc' ? 'RC download transactions' : state.adminTransactionCategory === 'all' ? 'All transactions' : 'Wallet transactions';
    }

    async function loadAdminTransactions(category, page) {
      if (!state.user || state.user.role !== 'admin' || !hasAdminPermission('transactions')) return;
      category = category || state.adminTransactionCategory || 'wallet';
      page = Number(page || state.adminTransactionPage || 1);
      state.adminTransactionCategory = category;
      state.adminTransactionPage = page;
      updateAdminTransactionTabs();
      try {
        var response = await callServer('adminGetTransactions', [category, page]);
        if (!response.success) return;
        var body = $('#admin-tx-body');
        if (!response.transactions || !response.transactions.length) {
          body.innerHTML = '<tr><td colspan="5">Is category me abhi koi transaction nahi hai.</td></tr>';
          renderPageButtons($('#admin-transaction-pagination'), response.page, response.pages, function (nextPage) { loadAdminTransactions(state.adminTransactionCategory, nextPage); });
          return;
        }
        body.innerHTML = response.transactions.map(function (tx) {
          var credit = Number(tx.amount) > 0;
          var label = clientTransactionLabel(tx);
          return '<tr><td>' + escapeHtml(formatDate(tx.time)) + '</td><td>' + escapeHtml(tx.mobile) + '</td><td>' + escapeHtml(label) + '</td><td class="' + (credit ? 'credit' : 'debit') + '">' + (credit ? '+' : '') + escapeHtml(formatMoney(tx.amount)) + '</td><td>' + escapeHtml(tx.vrn || '—') + '</td></tr>';
        }).join('');
        state.adminTransactionPage = Number(response.page || page);
        state.adminTransactionPages = Number(response.pages || 1);
        renderPageButtons($('#admin-transaction-pagination'), response.page, response.pages, function (nextPage) { loadAdminTransactions(state.adminTransactionCategory, nextPage); });
      } catch (error) { /* admin table is non-critical */ }
    }

    function renderAdminActivity(activity, scope) {
      var list = $('#admin-activity-list');
      if (!list) return;
      if (!Array.isArray(activity) || !activity.length) {
        list.innerHTML = '<div class="empty-list">Abhi aapne kisi user ko recharge nahi diya.</div>';
        return;
      }
      function metric(label, value) {
        var item = value || {};
        return '<div class="admin-activity-period"><small>' + escapeHtml(label) + '</small><b>' + escapeHtml(formatMoney(item.amount)) + '</b><span>' + Number(item.users || 0).toLocaleString('en-IN') + ' users · ' + Number(item.entries || 0).toLocaleString('en-IN') + ' payments</span></div>';
      }
      list.innerHTML = activity.map(function (admin) {
        var permissions = admin.permissions || {};
        var activePermissions = Object.keys(permissions).filter(function (key) { return permissions[key]; }).map(adminPermissionLabel).join(' · ') || 'No capabilities';
        var range = admin.range ? metric(admin.range.from + ' → ' + admin.range.to, admin.range).replace('admin-activity-period', 'admin-activity-period admin-activity-range') : '';
        var label = admin.label || (scope === 'self' ? 'Admin Assistant' : 'Admin');
        return '<div class="admin-activity-card"><div class="admin-activity-head"><div><b>' + escapeHtml(label) + '</b><small>' + escapeHtml(admin.name || 'Admin') + ' · +91 ' + escapeHtml(admin.mobile || '—') + '</small></div><span class="admin-activity-badge">' + escapeHtml(activePermissions) + '</span></div><div class="admin-activity-periods">' + metric('Today', admin.today) + metric('Current month', admin.month) + metric('Last month', admin.lastMonth) + metric('All time', admin.allTime) + range + '</div></div>';
      }).join('');
    }

    function setScopedKpiCard(selector, hidden) {
      var card = $(selector);
      if (card) card.hidden = Boolean(hidden);
    }

    function renderAdminStats(stats) {
      if (!stats) return;
      var selfScope = stats.scope === 'self';
      var owner = !selfScope;
      var setText = function (selector, value) { var el = $(selector); if (el) el.textContent = value; };
      setText('#kpi-total-users', Number(stats.totalUsers || 0).toLocaleString('en-IN'));
      setText('#kpi-active-users', Number(stats.activeUsers || 0).toLocaleString('en-IN'));
      setText('#kpi-today-topup', formatMoney(stats.todayTopup));
      setText('#kpi-month-topup', formatMoney(stats.monthTopup));
      setText('#kpi-last-month-topup', formatMoney(stats.lastMonthTopup));
      setText('#kpi-all-time-topup', formatMoney(stats.allTimeTopup));
      setText('#kpi-pending-wallet-requests', Number(stats.walletRequests && stats.walletRequests.pending || 0).toLocaleString('en-IN'));
      setText('#kpi-wallet-request-total', Number(stats.walletRequests && stats.walletRequests.total || 0).toLocaleString('en-IN') + ' total · ' + Number(stats.walletRequests && stats.walletRequests.approved || 0).toLocaleString('en-IN') + ' approved');
      setText('#kpi-today-rc', Number(stats.todayRcDownloads || 0).toLocaleString('en-IN'));
      setText('#kpi-month-rc', Number(stats.monthRcDownloads || 0).toLocaleString('en-IN'));
      setText('#kpi-last-month-rc', Number(stats.lastMonthRcDownloads || 0).toLocaleString('en-IN'));

      setText('#kpi-total-users-label', owner ? 'Total platform users' : 'Users you paid');
      setText('#kpi-active-users-label', owner ? 'Active users' : 'Paid users active');
      setText('#kpi-today-topup-label', owner ? 'Today topup' : 'Your payment today');
      setText('#kpi-month-topup-label', owner ? 'This month topup' : 'Your payment this month');
      setText('#kpi-last-month-topup-label', owner ? 'Last month topup' : 'Your payment last month');
      setText('#kpi-all-time-topup-label', owner ? 'All-time topup' : 'Your all-time payment');
      setScopedKpiCard('#kpi-card-today-rc', selfScope);
      setScopedKpiCard('#kpi-card-month-rc', selfScope);
      setScopedKpiCard('#kpi-card-last-rc', selfScope);
      if ($('#admin-kpi-scope-tag')) $('#admin-kpi-scope-tag').textContent = owner ? 'ALL PLATFORM' : 'YOUR ACTIVITY';
      if ($('#admin-kpi-role-label')) $('#admin-kpi-role-label').textContent = owner ? 'MAIN ADMIN · LIVE OVERVIEW' : 'ADMIN ASSISTANT · YOUR OVERVIEW';
      if ($('#admin-kpi-description')) $('#admin-kpi-description').textContent = owner ? 'All users, topup, RC download aur every admin ka complete overview.' : 'Sirf aapke assigned admin access aur aapke recharge/payment activity ka overview.';
      var rangeCard = $('#admin-kpi-range');
      if (stats.range) {
        rangeCard.hidden = false;
        setText('#kpi-range-label', owner ? stats.range.from + ' se ' + stats.range.to : 'Your range payment');
        setText('#kpi-range-topup', formatMoney(stats.range.topup));
        setText('#kpi-range-rc', owner
          ? Number(stats.range.rcDownloads || 0).toLocaleString('en-IN') + ' RC downloads • ' + Number(stats.range.newUsers || 0).toLocaleString('en-IN') + ' new users'
          : Number(stats.range.users || 0).toLocaleString('en-IN') + ' users paid • ' + Number(stats.range.entries || 0).toLocaleString('en-IN') + ' payments');
      } else {
        rangeCard.hidden = true;
      }
      renderAdminActivity(stats.adminActivity, stats.scope);
    }

    function currentAdminStatsRange() {
      var fromEl = $('#admin-stats-from');
      var toEl = $('#admin-stats-to');
      var from = fromEl ? fromEl.value : '';
      var to = toEl ? toEl.value : '';
      return from && to ? { from: from, to: to } : null;
    }

    function renderKpiDetailItems(type, items) {
      var list = $('#admin-kpi-detail-list');
      if (!list) return;
      if (!items || !items.length) {
        list.innerHTML = '<div class="empty-list">Is KPI ke liye abhi koi detail nahi hai.</div>';
        return;
      }
      if (type === 'wallet-requests') {
        list.innerHTML = items.map(topupRequestMarkup).join('');
        wireTopupRequestButtons(list);
        return;
      }
      list.innerHTML = items.map(function (item) {
        var isUser = Object.prototype.hasOwnProperty.call(item, 'wallet') && !item.time;
        if (isUser) {
          return '<div class="admin-kpi-detail-row"><div><b>' + escapeHtml(item.name || 'User') + ' · +91 ' + escapeHtml(item.mobile || '—') + '</b><small>' + escapeHtml(item.email || 'Email not set') + ' · ' + escapeHtml(item.status || '') + '</small></div><div class="admin-kpi-detail-value">' + escapeHtml(formatMoney(item.wallet)) + '</div></div>';
        }
        var type = String(item.type || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
        var walletDebit = ['WALLETDEBIT', 'DEBIT', 'ADMINDEBIT'].indexOf(type) >= 0;
        var adminWalletCredit = type === 'ADMINWALLETCREDIT';
        var isRc = Boolean(item.vrn) && !walletDebit && !adminWalletCredit && type !== 'RECHARGE' && type !== 'WALLETRECHARGE' && type !== 'WALLETTOPUP' && type !== 'TOPUP';
        var label = isRc ? 'RC download · ' + (item.vrn || '—') : (adminWalletCredit ? 'Admin wallet credit' : (walletDebit ? 'Wallet debit' : 'Wallet topup'));
        var second = isRc
          ? (item.mobile || '—') + ' · ' + (item.status || 'SUCCESS')
          : (item.mobile || '—') + ' · ' + (item.note || item.status || 'SUCCESS');
        return '<div class="admin-kpi-detail-row"><div><b>' + escapeHtml(label) + '</b><small>' + escapeHtml(formatDate(item.time)) + ' · +91 ' + escapeHtml(second) + '</small></div><div class="admin-kpi-detail-value">' + escapeHtml((Number(item.amount || 0) < 0 ? '−' : '+') + formatMoney(Math.abs(Number(item.amount || 0)))) + '</div></div>';
      }).join('');
    }

    async function loadKpiDetails(type, silent) {
      if (!state.user || state.user.role !== 'admin' || !hasAdminPermission('kpi')) return;
      var panel = $('#admin-kpi-detail-panel');
      var list = $('#admin-kpi-detail-list');
      if (!panel || !list) return;
      state.adminKpiDetail = type || 'wallet-requests';
      panel.hidden = false;
      if (!silent) list.innerHTML = '<div class="empty-list">Details load ho rahe hain…</div>';
      try {
        var response = await callServer('adminGetKpiDetails', [state.adminKpiDetail, currentAdminStatsRange()]);
        if (!response.success) throw new Error(response.message || 'Details load nahi ho paayi.');
        $('#admin-kpi-detail-title').textContent = response.title || 'KPI details';
        var range = response.from && response.to ? 'Date range: ' + response.from + ' → ' + response.to + ' · ' : '';
        $('#admin-kpi-detail-subtitle').textContent = range + Number(response.items ? response.items.length : 0).toLocaleString('en-IN') + ' record(s)';
        renderKpiDetailItems(state.adminKpiDetail, response.items || []);
      } catch (error) {
        if (!silent) list.innerHTML = '<div class="empty-list">Details load nahi ho paayi.</div>';
      }
    }

    function openKpiDetails(type) {
      loadKpiDetails(type, false);
      var panel = $('#admin-kpi-detail-panel');
      if (panel) window.setTimeout(function () { panel.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); }, 40);
    }

    function closeKpiDetails() {
      state.adminKpiDetail = '';
      var panel = $('#admin-kpi-detail-panel');
      if (panel) panel.hidden = true;
    }

    function stopAccountLiveUpdates() {
      if (accountLiveTimer) window.clearInterval(accountLiveTimer);
      accountLiveTimer = null;
      accountLiveBusy = false;
    }

    async function syncAccountLiveState() {
      if (!state.user || accountLiveBusy) return;
      accountLiveBusy = true;
      try {
        var previousWallet = Number(state.user.wallet || 0);
        var response = await callServer('getMe', []);
        if (response.success && response.user && response.user.mobile === state.user.mobile) {
          state.user = response.user;
          updateWallet(response.user.wallet);
          applyRcPrice(priceForDownload('rc-card'));
          if (Number(response.user.wallet || 0) !== previousWallet) loadTransactions();
        }
      } catch (error) {
        // A temporary poll failure must not interrupt the active session.
      } finally {
        accountLiveBusy = false;
      }
    }

    function startAccountLiveUpdates() {
      stopAccountLiveUpdates();
      if (!state.user) return;
      syncAccountLiveState();
      accountLiveTimer = window.setInterval(syncAccountLiveState, 5_000);
    }

    function stopAdminLiveUpdates() {
      if (adminLiveTimer) window.clearInterval(adminLiveTimer);
      adminLiveTimer = null;
      state.adminLiveBusy = false;
    }

    function startAdminLiveUpdates() {
      stopAdminLiveUpdates();
      if (!state.user || state.user.role !== 'admin') return;
      adminLiveTimer = window.setInterval(async function () {
        if (!state.user || state.user.role !== 'admin' || state.adminLiveBusy) return;
        state.adminLiveBusy = true;
        try {
          if (hasAdminPermission('recharge')) await loadAdminTopupRequests();
          if (hasAdminPermission('transactions')) await loadAdminTransactions(state.adminTransactionCategory, state.adminTransactionPage);
          if (hasAdminPermission('kpi')) {
            await loadAdminStats(currentAdminStatsRange(), { skipSettings: true, skipDetails: true });
            if (state.adminKpiDetail && $('#admin-kpi-detail-panel') && !$('#admin-kpi-detail-panel').hidden) await loadKpiDetails(state.adminKpiDetail, true);
          }
        } finally {
          state.adminLiveBusy = false;
        }
      }, 5000);
    }

    async function loadAdminStats(range, options) {
      if (!state.user || state.user.role !== 'admin' || !hasAdminPermission('kpi')) return;
      options = options || {};
      try {
        var response = await callServer('adminGetStats', [range || null]);
        if (response.success) {
          renderAdminStats(response.stats);
          if (response.settings && !options.skipSettings) {
            if (response.settings.rating) $('#admin-rating-input').value = response.settings.rating;
            $('#admin-users-baseline-input').value = response.settings.usersBaseline;
            $('#admin-downloads-baseline-input').value = response.settings.downloadsBaseline;
            if (response.settings.rcCardPrice) $('#admin-rc-price-input').value = response.settings.rcCardPrice;
            applySupportSettings({
              whatsapp: response.settings.supportWhatsapp || state.supportWhatsapp,
              paymentQr: Object.prototype.hasOwnProperty.call(response.settings, 'paymentQr') ? response.settings.paymentQr : state.supportPaymentQr
            });
          }
          if (state.adminKpiDetail && $('#admin-kpi-detail-panel') && !$('#admin-kpi-detail-panel').hidden && !options.skipDetails) loadKpiDetails(state.adminKpiDetail, true);
        }
      } catch (error) { /* KPI dashboard is non-critical */ }
    }

    function applyAdminStatsFilter() {
      var from = $('#admin-stats-from').value;
      var to = $('#admin-stats-to').value;
      if (!from || !to) { toast('Date filter', 'From aur To dono date choose karo.', 'error'); return; }
      if (from > to) { toast('Date filter', 'From date, To date se pehle honi chahiye.', 'error'); return; }
      loadAdminStats({ from: from, to: to });
    }

    function resetAdminStatsFilter() {
      $('#admin-stats-from').value = '';
      $('#admin-stats-to').value = '';
      loadAdminStats();
    }

    async function saveAdminRating() {
      if (!isMainAdminUser(state.user)) { toast('Main Admin only', 'Homepage settings sirf Main Admin update kar sakta hai.', 'error'); return; }
      var button = $('#admin-rating-save');
      var value = $('#admin-rating-input').value.trim();
      setButtonLoading(button, true, 'Save rating');
      try {
        var response = await callServer('adminSetRating', [value]);
        if (!response.success) throw new Error(response.message || 'Rating save nahi ho paayi.');
        toast('Rating updated', 'Homepage rating ab ' + (value || '—') + ' show hogi.', 'success');
        loadPublicStats();
      } catch (error) { toast('Rating error', error.message, 'error'); }
      finally { setButtonLoading(button, false, 'Save rating'); }
    }

    async function saveAdminBaseline() {
      if (!isMainAdminUser(state.user)) { toast('Main Admin only', 'Homepage settings sirf Main Admin update kar sakta hai.', 'error'); return; }
      var button = $('#admin-baseline-save');
      var users = Number($('#admin-users-baseline-input').value);
      var downloads = Number($('#admin-downloads-baseline-input').value);
      if (!Number.isFinite(users) || users < 0 || !Number.isFinite(downloads) || downloads < 0) {
        toast('Baseline error', 'Valid non-negative numbers daalo.', 'error');
        return;
      }
      setButtonLoading(button, true, 'Save baseline');
      try {
        var response = await callServer('adminSetBaseline', [users, downloads]);
        if (!response.success) throw new Error(response.message || 'Baseline save nahi ho paayi.');
        toast('Baseline updated', 'Homepage stats ab is baseline ke saath show honge.', 'success');
        loadPublicStats();
      } catch (error) { toast('Baseline error', error.message, 'error'); }
      finally { setButtonLoading(button, false, 'Save baseline'); }
    }

    function readPaymentQr(file) {
      return new Promise(function (resolve, reject) {
        if (!file || !file.type || file.type.indexOf('image/') !== 0) return reject(new Error('Payment QR image select karo.'));
        if (file.size > 1_500_000) return reject(new Error('Payment QR image 1.5 MB se chhoti rakho.'));
        var reader = new FileReader();
        reader.onerror = function () { reject(new Error('Payment QR read nahi ho paaya.')); };
        reader.onload = function () {
          var image = new Image();
          image.onerror = function () { reject(new Error('Payment QR image valid nahi hai.')); };
          image.onload = function () {
            // Google Sheet cells have a character limit. Keep the QR data URL
            // below that limit while preserving a crisp, scannable image.
            var maxChars = 46_000;
            var minDimension = 220;
            var sourceWidth = image.naturalWidth || image.width || 600;
            var sourceHeight = image.naturalHeight || image.height || 600;
            var scale = Math.min(1, 900 / Math.max(sourceWidth, sourceHeight));
            var width = Math.max(minDimension, Math.round(sourceWidth * scale));
            var height = Math.max(minDimension, Math.round(sourceHeight * scale));
            var canvas = document.createElement('canvas');
            var context;
            var output;

            function drawPng() {
              canvas.width = width;
              canvas.height = height;
              context = canvas.getContext('2d');
              context.imageSmoothingEnabled = false;
              context.fillStyle = '#ffffff';
              context.fillRect(0, 0, width, height);
              context.drawImage(image, 0, 0, width, height);
              return canvas.toDataURL('image/png');
            }

            output = drawPng();
            while (output.length > maxChars && width > minDimension) {
              width = Math.max(minDimension, Math.round(width * 0.84));
              height = Math.max(minDimension, Math.round(height * 0.84));
              output = drawPng();
            }

            // A PNG is preferred for QR readability. If a photographic/colour
            // QR is still large, use a compressed JPEG fallback and keep the
            // rendered image large enough for phone scanners.
            if (output.length > maxChars) {
              var quality = 0.86;
              output = canvas.toDataURL('image/jpeg', quality);
              while (output.length > maxChars && quality > 0.18) {
                quality -= 0.1;
                output = canvas.toDataURL('image/jpeg', quality);
              }
            }
            if (output.length > maxChars) {
              reject(new Error('Payment QR image bahut large hai. Chhoti ya simple QR image upload karo.'));
              return;
            }
            resolve(output);
          };
          image.src = reader.result;
        };
        reader.readAsDataURL(file);
      });
    }

    async function saveAdminSupport(clearQr) {
      if (!isMainAdminUser(state.user)) { toast('Main Admin only', 'WhatsApp aur payment QR sirf Main Admin update kar sakta hai.', 'error'); return; }
      var number = normalizeMobile($('#admin-support-whatsapp-input').value || '');
      if (!validMobile(number)) { toast('Number check karo', 'Valid 10-digit WhatsApp support number daalo.', 'error'); return; }
      var fileInput = $('#admin-payment-qr-file');
      var button = clearQr ? $('#admin-support-clear-qr') : $('#admin-support-save');
      setButtonLoading(button, true, clearQr ? 'Clear QR' : 'Save WhatsApp & QR');
      try {
        var qr = clearQr ? '' : state.supportPaymentQr;
        if (!clearQr && fileInput.files && fileInput.files[0]) qr = await readPaymentQr(fileInput.files[0]);
        var response = await callServer('adminSetSupport', [number, qr, clearQr === true]);
        if (!response.success) throw new Error(response.message || 'WhatsApp settings save nahi ho paayi.');
        applySupportSettings(response.support);
        if (fileInput) fileInput.value = '';
        toast('WhatsApp settings saved', clearQr ? 'WhatsApp number save hai, payment QR clear ho gaya.' : 'WhatsApp number aur payment QR update ho gaya.', 'success');
      } catch (error) { toast('Support settings error', error.message, 'error'); }
      finally { setButtonLoading(button, false, clearQr ? 'Clear QR' : 'Save WhatsApp & QR'); }
    }

    async function saveAdminRcPrice() {
      if (!isMainAdminUser(state.user)) { toast('Main Admin only', 'Default rate sirf Main Admin update kar sakta hai.', 'error'); return; }
      var button = $('#admin-rc-price-save');
      var price = Number($('#admin-rc-price-input').value);
      if (!Number.isFinite(price) || price < 1 || price > 1000) {
        toast('Rate error', 'RC Card rate ₹1 se ₹1000 ke beech ek valid number daalo.', 'error');
        return;
      }
      setButtonLoading(button, true, 'Save default');
      try {
        var response = await callServer('adminSetRcPrice', [price]);
        if (!response.success) throw new Error(response.message || 'Rate save nahi ho paayi.');
        state.defaultRcCardPrice = Number(response.rcCardPrice);
        toast('Default RC rate updated', 'Default rate ₹' + response.rcCardPrice + ' set ho gaya. Custom-rate users par asar nahi padega.', 'success');
        applyPublicDefaultPrice(response.rcCardPrice);
        // Admin ke apne account par custom rate na ho to unki screen bhi update ho.
        if (state.user && state.user.customRcCardPrice == null) {
          state.user.prices = state.user.prices || {};
          state.user.prices.rcCard = response.rcCardPrice;
          applyRcPrice(response.rcCardPrice);
        }
        if (state.selectedAdminMobile && $('#admin-user-rate-tools') && !$('#admin-user-rate-tools').hidden) {
          // Refresh labels for currently selected user using latest default.
          var label = $('#admin-user-rate-label');
          if (label && label.textContent.indexOf('Default RC rate') === 0) {
            label.textContent = 'Default RC rate ' + formatMoney(response.rcCardPrice);
            $('#admin-user-rate-input').value = response.rcCardPrice;
          }
          if ($('#admin-user-rate-help')) {
            var help = $('#admin-user-rate-help').textContent || '';
            if (help.indexOf('default global rate') !== -1 || help.indexOf('Default global rate') !== -1) {
              $('#admin-user-rate-help').textContent = help.replace(/₹[\d,]+(\.\d+)?/g, formatMoney(response.rcCardPrice)).replace(/Default global rate.*/, 'Default global rate ' + formatMoney(response.rcCardPrice) + ' apply ho raha hai. Alag rate type karke set kar sakte ho.');
            }
          }
        }
      } catch (error) { toast('Rate error', error.message, 'error'); }
      finally { setButtonLoading(button, false, 'Save default'); }
    }

    $$('.auth-tab').forEach(function (button) { button.addEventListener('click', function () { setAuthMode(button.dataset.authTab); }); });
    $('#open-forgot').addEventListener('click', function () { setAuthMode('forgot'); });
    $('#back-to-login').addEventListener('click', function () { setAuthMode('login'); });
    $$('[data-toggle-password]').forEach(function (button) {
      button.addEventListener('click', function () {
        var input = $('#' + button.dataset.togglePassword);
        if (!input) return;
        var visible = input.type === 'text';
        input.type = visible ? 'password' : 'text';
        button.textContent = visible ? 'Show' : 'Hide';
      });
    });
    $('#login-form').addEventListener('submit', async function (event) {
      event.preventDefault();
      var identifier = String($('#login-identifier').value || '').trim();
      var password = $('#login-password').value;
      $('#login-error').textContent = '';
      var mobileIdentifier = normalizeMobile(identifier);
      var normalizedIdentifier = validEmail(identifier) ? identifier.toLowerCase() : (validMobile(mobileIdentifier) ? mobileIdentifier : identifier.replace(/\s+/g, ' ').trim());
      if (!validLoginIdentifier(normalizedIdentifier) || !password) {
        $('#login-error').textContent = 'Valid username, email ya 10-digit mobile number, aur password enter karo.';
        return;
      }
      $('#login-identifier').value = normalizedIdentifier;
      var button = $('#login-button'); setButtonLoading(button, true, 'Login karo <span>→</span>');
      try {
        var response = await callServer('login', [normalizedIdentifier, password]);
        if (!response.success) { $('#login-error').textContent = response.message; return; }
        showApp(response.user);
        showWelcomePopup(response.user);
        toast('Welcome back', 'Aapka account login ho gaya.', 'success');
      } catch (error) { $('#login-error').textContent = error.message; }
      finally { setButtonLoading(button, false, 'Login karo <span>→</span>'); }
    });

    $('#signup-form').addEventListener('submit', async function (event) {
      event.preventDefault();
      var name = $('#signup-name').value.trim(); var email = $('#signup-email').value.trim().toLowerCase(); var mobile = normalizeMobile($('#signup-mobile').value); var password = $('#signup-password').value;
      $('#signup-error').textContent = '';
      if (name.length < 2 || !validEmail(email) || !validMobile(mobile) || password.length < 6) { $('#signup-error').textContent = 'Name, email, valid mobile aur minimum 6-character password enter karo.'; return; }
      var button = $('#signup-button'); setButtonLoading(button, true, 'Account banao <span>→</span>');
      try {
        var response = await callServer('signup', [name, email, mobile, password]);
        if (!response.success) { $('#signup-error').textContent = response.message; return; }
        showApp(response.user); showWelcomePopup(response.user); toast('Account created', 'Admin recharge ke baad RC download kar sakte ho.', 'success');
      } catch (error) { $('#signup-error').textContent = error.message; }
      finally { setButtonLoading(button, false, 'Account banao <span>→</span>'); }
    });

    $('#forgot-form').addEventListener('submit', async function (event) {
      event.preventDefault();
      var email = $('#forgot-email').value.trim().toLowerCase();
      var mobile = normalizeMobile($('#forgot-mobile').value);
      var newPassword = $('#forgot-password').value;
      var confirmPassword = $('#forgot-confirm-password').value;
      $('#forgot-error').textContent = '';
      if (!validEmail(email) || !validMobile(mobile)) { $('#forgot-error').textContent = 'Valid email aur mobile number enter karo.'; return; }
      if (newPassword.length < 6 || newPassword !== confirmPassword) { $('#forgot-error').textContent = 'New password minimum 6 characters ka ho aur dono fields match karein.'; return; }
      var button = $('#forgot-button'); setButtonLoading(button, true, 'Set new password <span>→</span>');
      try {
        var response = await callServer('forgotPassword', [email, mobile, newPassword, confirmPassword]);
        if (!response.success) { $('#forgot-error').textContent = response.message; return; }
        if ($('#login-identifier')) $('#login-identifier').value = email;
        $('#login-password').value = '';
        setAuthMode('login');
        toast('Password updated', 'Ab naye password se login karo.', 'success');
      } catch (error) { $('#forgot-error').textContent = error.message; }
      finally { setButtonLoading(button, false, 'Set new password <span>→</span>'); }
    });

    $('#rc-form').addEventListener('submit', function (event) { event.preventDefault(); showDownloadOptions(); });
    $('#close-format-modal').addEventListener('click', closeDownloadOptions);
    $('#download-options-modal').addEventListener('click', function (event) { if (event.target === $('#download-options-modal')) closeDownloadOptions(); });
    $('#wallet-top-trigger').addEventListener('click', openWalletTopup);
    $('#wallet-card-trigger').addEventListener('click', openWalletTopup);
    $('#wallet-card-trigger').addEventListener('keydown', function (event) { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); openWalletTopup(); } });
    $('#close-wallet-topup').addEventListener('click', closeWalletTopup);
    $('#wallet-topup-modal').addEventListener('click', function (event) { if (event.target === $('#wallet-topup-modal')) closeWalletTopup(); });
    $('#topup-continue-button').addEventListener('click', proceedToWalletPayment);
    $('#topup-change-amount').addEventListener('click', showTopupAmountStep);
    $('#topup-whatsapp-button').addEventListener('click', redirectToWalletTopupWhatsapp);
    document.addEventListener('keydown', function (event) {
      if (event.key !== 'Escape') return;
      if (!$('#download-options-modal').hidden) closeDownloadOptions();
      if (!$('#wallet-topup-modal').hidden) closeWalletTopup();
    });
    $$('.format-option').forEach(function (option) { option.addEventListener('click', function () { purchaseAndDownload(option.dataset.downloadFormat); }); });
    $('#close-download-status').addEventListener('click', function () { $('#download-status').hidden = true; });
    $('#close-wallet-alert').addEventListener('click', hideWalletAlert);
    $('#install-auth-button').addEventListener('click', installApp);
    $('#install-dashboard-button').addEventListener('click', installApp);
    updateInstallButtons();

    function closeUserDropdown() {
      var dropdown = $('#user-dropdown');
      var button = $('#user-menu-button');
      if (!dropdown || !button) return;
      button.setAttribute('aria-expanded', 'false');
      button.classList.remove('open');
      dropdown.classList.remove('open');
      window.setTimeout(function () { if (!dropdown.classList.contains('open')) dropdown.hidden = true; }, 120);
    }

    function toggleUserDropdown() {
      var dropdown = $('#user-dropdown');
      var button = $('#user-menu-button');
      if (!dropdown || !button) return;
      var isOpen = dropdown.classList.contains('open');
      if (isOpen) { closeUserDropdown(); return; }
      dropdown.hidden = false;
      window.requestAnimationFrame(function () {
        dropdown.classList.add('open');
        button.classList.add('open');
        button.setAttribute('aria-expanded', 'true');
      });
    }

    $('#user-menu-button').addEventListener('click', function (event) { event.stopPropagation(); toggleUserDropdown(); });
    if ($('#open-notifications')) $('#open-notifications').addEventListener('click', function (event) {
      event.stopPropagation();
      toggleNotificationPanel();
    });
    if ($('#mark-notifications-read')) $('#mark-notifications-read').addEventListener('click', function (event) {
      event.stopPropagation();
      markNotificationsRead(state.notifications.filter(function (item) { return !item.read; }).map(function (item) { return item.id; }));
    });
    document.addEventListener('click', function (event) {
      var wrap = $('#user-menu-wrap');
      if (wrap && !wrap.contains(event.target)) {
        closeUserDropdown();
        if ($('#notifications-panel')) $('#notifications-panel').hidden = true;
      }
    });
    document.addEventListener('keydown', function (event) {
      if (event.key === 'Escape') {
        closeUserDropdown();
        if ($('#notifications-panel')) $('#notifications-panel').hidden = true;
      }
    });
    if ($('#enable-notifications')) $('#enable-notifications').addEventListener('click', function () {
      enableNotifications();
    });
    $('#logout-button').addEventListener('click', async function () {
      closeUserDropdown();
      try { await callServer('logout', []); } catch (error) {}
      clearSession();
      toast('Logged out', 'Aapka session close ho gaya.', 'success');
    });
    $('#close-welcome-back').addEventListener('click', closeWelcomePopup);
    $('#welcome-back-continue').addEventListener('click', function () {
      closeWelcomePopup();
      var target = $('#app');
      if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
    $('#welcome-back-modal').addEventListener('click', function (event) { if (event.target === $('#welcome-back-modal')) closeWelcomePopup(); });
    $('#robo-button').addEventListener('click', function () {
      if (!state.user) return;
      var panel = $('#robo-help-panel');
      if (panel && !panel.hidden) closeRoboHelp(true); else openRoboHelp();
    });
    $('#close-robo-help').addEventListener('click', function () { closeRoboHelp(true); });
    $('#robo-whatsapp-help').addEventListener('click', function () { releaseRoboGreeting(); });
    $('#robo-email-help').addEventListener('click', function () { releaseRoboGreeting(); });
    $$('[data-whatsapp-support]').forEach(function (link) {
      link.addEventListener('click', function (event) {
        if (link.dataset.configured !== '1') {
          event.preventDefault();
          toast('WhatsApp number not set', 'Main Admin pehle WhatsApp support number configure karein.', 'error');
        }
      });
    });
    $('#refresh-transactions').addEventListener('click', function () { loadTransactions(state.transactionCategory, state.transactionPage); });
    $$('[data-user-transaction-category]').forEach(function (button) {
      button.addEventListener('click', function () { state.transactionPage = 1; loadTransactions(button.dataset.userTransactionCategory, 1); });
    });
    if ($('#refresh-admin-transactions')) $('#refresh-admin-transactions').addEventListener('click', function () { loadAdminTransactions(state.adminTransactionCategory, state.adminTransactionPage); });
    $$('[data-admin-transaction-category]').forEach(function (button) {
      button.addEventListener('click', function () { state.adminTransactionPage = 1; loadAdminTransactions(button.dataset.adminTransactionCategory, 1); });
    });
    $('#admin-search-button').addEventListener('click', findAdminUser);
    $('#admin-search-mobile').addEventListener('keydown', function (event) {
      if (event.key === 'Enter') { event.preventDefault(); findAdminUser(); }
    });
    $('#admin-recharge-button').addEventListener('click', rechargeAdminUser);
    if ($('#admin-debit-button')) $('#admin-debit-button').addEventListener('click', debitAdminUser);
    if ($('#refresh-topup-requests')) $('#refresh-topup-requests').addEventListener('click', loadAdminTopupRequests);
    if ($('#close-admin-kpi-details')) $('#close-admin-kpi-details').addEventListener('click', closeKpiDetails);
    $$('[data-kpi-detail]').forEach(function (card) {
      card.addEventListener('click', function () { openKpiDetails(card.dataset.kpiDetail); });
      card.addEventListener('keydown', function (event) {
        if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); openKpiDetails(card.dataset.kpiDetail); }
      });
    });
    if ($('#admin-user-rate-save')) $('#admin-user-rate-save').addEventListener('click', function () { saveAdminUserRate(false); });
    if ($('#admin-user-rate-clear')) $('#admin-user-rate-clear').addEventListener('click', function () { saveAdminUserRate(true); });
    if ($('#admin-users-search-button')) $('#admin-users-search-button').addEventListener('click', searchAdminUsersList);
    if ($('#admin-users-search')) $('#admin-users-search').addEventListener('keydown', function (event) {
      if (event.key === 'Enter') { event.preventDefault(); searchAdminUsersList(); }
    });
    if ($('#admin-users-all-button')) $('#admin-users-all-button').addEventListener('click', showAllAdminUsers);
    if ($('#admin-users-csv-button')) $('#admin-users-csv-button').addEventListener('click', exportAdminUsersCsv);
    if ($('#admin-access-search-button')) $('#admin-access-search-button').addEventListener('click', function () {
      var query = String($('#admin-access-search').value || '').trim();
      if (!query) { toast('Search check karo', 'Existing user ka mobile, email ya naam daalo.', 'error'); return; }
      loadAdminAccessUsers(query);
    });
    if ($('#admin-access-search')) $('#admin-access-search').addEventListener('keydown', function (event) {
      if (event.key === 'Enter') { event.preventDefault(); $('#admin-access-search-button').click(); }
    });
    if ($('#admin-bulk-rate-apply')) $('#admin-bulk-rate-apply').addEventListener('click', function () { bulkAdminRate(false, $('#admin-bulk-rate-apply')); });
    if ($('#admin-bulk-rate-clear')) $('#admin-bulk-rate-clear').addEventListener('click', function () { bulkAdminRate(true, $('#admin-bulk-rate-clear')); });
    if ($('#admin-users-body')) {
      $('#admin-users-body').addEventListener('click', function (event) {
        var button = event.target && event.target.closest ? event.target.closest('button[data-rate-save], button[data-rate-reset], button[data-user-toggle]') : null;
        if (!button) return;
        if (button.dataset.rateSave) saveAdminRowRate(button.dataset.rateSave, false, button);
        else if (button.dataset.rateReset) saveAdminRowRate(button.dataset.rateReset, true, button);
        else if (button.dataset.userToggle) toggleAdminUserStatus(button.dataset.userToggle, button.dataset.active === '1', button);
      });
      $('#admin-users-body').addEventListener('keydown', function (event) {
        if (event.key !== 'Enter' || !event.target.classList.contains('admin-row-rate')) return;
        event.preventDefault();
        var row = event.target.closest ? event.target.closest('tr[data-mobile]') : null;
        if (row) saveAdminRowRate(row.dataset.mobile, false, row.querySelector('[data-rate-save]'));
      });
    }
    $$('[data-goto-admin-section]').forEach(function (button) {
      button.addEventListener('click', function () { setAdminSection(button.dataset.gotoAdminSection); });
    });
    if ($('#admin-rates-nav')) $('#admin-rates-nav').addEventListener('click', function () { setAdminSection('users'); });
    if ($('#admin-access-nav')) $('#admin-access-nav').addEventListener('click', function () { setAdminSection('access'); });
    $('#admin-stats-apply').addEventListener('click', applyAdminStatsFilter);
    $('#admin-stats-reset').addEventListener('click', resetAdminStatsFilter);
    $('#admin-rating-save').addEventListener('click', saveAdminRating);
    $('#admin-baseline-save').addEventListener('click', saveAdminBaseline);
    $('#admin-rc-price-save').addEventListener('click', saveAdminRcPrice);
    $('#admin-support-save').addEventListener('click', function () { saveAdminSupport(false); });
    $('#admin-support-clear-qr').addEventListener('click', function () { saveAdminSupport(true); });
    $('#admin-ad-upload').addEventListener('click', uploadAdvertisement);
    $$('[data-admin-section]').forEach(function (button) { button.addEventListener('click', function () { setAdminSection(button.dataset.adminSection); }); });
    $$('.topbar-nav button').forEach(function (button) { button.addEventListener('click', function () { var target = $('#' + button.dataset.scroll); if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' }); $$('.topbar-nav button').forEach(function (item) { item.classList.remove('active'); }); button.classList.add('active'); }); });

    async function boot() {
      loadPublicPricing();
      // WhatsApp/QR configuration is optional; it must never block session restore.
      loadSupportSettings();
      try {
        var response = await callServer('getMe', []);
        if (response.success) showApp(response.user); else clearSession();
      } catch (error) { clearSession(); }
    }
    boot();
