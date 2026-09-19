
    var state = { token: '', user: null, selectedAdminMobile: '', selectedAdminQuery: '', defaultRcCardPrice: 15, pendingVrn: '', busy: false, adminUsersQuery: '', bulkConfirm: false };
    var DOWNLOAD_PRICES = { mparivahan: 10, 'rc-card': 15 };
    var $ = function (selector) { return document.querySelector(selector); };
    var $$ = function (selector) { return Array.prototype.slice.call(document.querySelectorAll(selector)); };
    var installPrompt = null;

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
        navigator.serviceWorker.register('/sw.js', { scope: '/' }).then(function (registration) {
          // Naya deploy hone par purana cached app chal raha ho to admin ko batao.
          function watchWorker(worker) {
            if (!worker) return;
            worker.addEventListener('statechange', function () {
              if (worker.state === 'installed' && navigator.serviceWorker.controller) {
                toast('Naya version ready', 'Naye update ke liye page ek baar refresh karo.', 'info');
              }
            });
          }
          if (registration.waiting && navigator.serviceWorker.controller) {
            toast('Naya version ready', 'Naye update ke liye page ek baar refresh karo.', 'info');
          }
          watchWorker(registration.installing);
          registration.addEventListener('updatefound', function () { watchWorker(registration.installing); });
        }).catch(function () {
          // The website remains fully usable if a browser blocks offline installation.
        });
      });
    }

    // Refresh par pehle cookie session verify hota hai, isliye login flash nahi dikhega.
    $('#auth-view').hidden = true;
    $('#session-loading').hidden = false;

    async function callServer(name, args) {
      var url = '';
      var options = { credentials: 'same-origin', headers: { 'Accept': 'application/json' } };
      if (name === 'signup') { url = '/api/auth/signup'; options.method = 'POST'; options.headers['Content-Type'] = 'application/json'; options.body = JSON.stringify({ name: args[0], email: args[1], mobile: args[2], password: args[3] }); }
      else if (name === 'login') { url = '/api/auth/login'; options.method = 'POST'; options.headers['Content-Type'] = 'application/json'; options.body = JSON.stringify({ username: args[0], password: args[1] }); }
      else if (name === 'forgotPassword') { url = '/api/auth/forgot-password'; options.method = 'POST'; options.headers['Content-Type'] = 'application/json'; options.body = JSON.stringify({ email: args[0], mobile: args[1], newPassword: args[2], confirmPassword: args[3] }); }
      else if (name === 'logout') { url = '/api/auth/logout'; options.method = 'POST'; }
      else if (name === 'getMe') { url = '/api/auth/session'; }
      else if (name === 'buyRc') { url = '/api/rc/purchase'; options.method = 'POST'; options.headers['Content-Type'] = 'application/json'; options.body = JSON.stringify({ vrn: args[0], downloadType: args[1] || 'mparivahan' }); }
      else if (name === 'getMyTransactions') { url = '/api/account/transactions'; }
      else if (name === 'getAds') { url = '/api/ads'; }
      else if (name === 'getStats') { url = '/api/public/stats'; }
      else if (name === 'adminFindUser') { url = '/api/admin/users/search'; options.method = 'POST'; options.headers['Content-Type'] = 'application/json'; options.body = JSON.stringify({ query: args[0] }); }
      else if (name === 'adminSetUserRate') { url = '/api/admin/users/set-rate'; options.method = 'POST'; options.headers['Content-Type'] = 'application/json'; options.body = JSON.stringify({ query: args[0], price: args[1], clear: args[2] === true }); }
      else if (name === 'adminListUsers') { url = '/api/admin/users' + (args[0] ? '?q=' + encodeURIComponent(args[0]) : ''); }
      else if (name === 'adminBulkRate') { url = '/api/admin/users/bulk-rate'; options.method = 'POST'; options.headers['Content-Type'] = 'application/json'; options.body = JSON.stringify({ price: args[0], clear: args[1] === true, scope: args[2] || 'all', mobiles: args[3] || [], confirm: args[4] === true }); }
      else if (name === 'adminSetUserStatus') { url = '/api/admin/users/status'; options.method = 'POST'; options.headers['Content-Type'] = 'application/json'; options.body = JSON.stringify({ mobile: args[0], active: args[1] !== false }); }
      else if (name === 'adminRecharge') { url = '/api/admin/recharge'; options.method = 'POST'; options.headers['Content-Type'] = 'application/json'; options.body = JSON.stringify({ mobile: args[0], amount: args[1], note: args[2] }); }
      else if (name === 'adminGetTransactions') { url = '/api/admin/transactions'; }
      else if (name === 'adminGetStats') {
        var qs = new URLSearchParams();
        if (args[0] && args[0].from) qs.set('from', args[0].from);
        if (args[0] && args[0].to) qs.set('to', args[0].to);
        url = '/api/admin/stats' + (qs.toString() ? '?' + qs.toString() : '');
      }
      else if (name === 'adminSetRating') { url = '/api/admin/settings/rating'; options.method = 'POST'; options.headers['Content-Type'] = 'application/json'; options.body = JSON.stringify({ rating: args[0] }); }
      else if (name === 'adminSetBaseline') { url = '/api/admin/settings/baseline'; options.method = 'POST'; options.headers['Content-Type'] = 'application/json'; options.body = JSON.stringify({ usersBaseline: args[0], downloadsBaseline: args[1] }); }
      else if (name === 'adminSetRcPrice') { url = '/api/admin/settings/rc-price'; options.method = 'POST'; options.headers['Content-Type'] = 'application/json'; options.body = JSON.stringify({ price: args[0] }); }
      else if (name === 'adminGetAds') { url = '/api/admin/ads'; }
      else if (name === 'adminAddAd') { url = '/api/admin/ads'; options.method = 'POST'; options.headers['Content-Type'] = 'application/json'; options.body = JSON.stringify({ title: args[0], imageData: args[1] }); }
      else if (name === 'adminDeleteAd') { url = '/api/admin/ads/' + encodeURIComponent(args[0]); options.method = 'DELETE'; }
      else if (name === 'adminToggleAd') { url = '/api/admin/ads/' + encodeURIComponent(args[0]); options.method = 'POST'; }
      else throw new Error('Unknown request');
      var response = await fetch(url, options);
      var payload;
      try { payload = await response.json(); } catch (error) { throw new Error('Server se invalid response aaya.'); }
      return payload;
    }

    function normalizeMobile(value) { return String(value || '').replace(/\D/g, '').replace(/^91(?=\d{10}$)/, ''); }
    function normalizeVrn(value) { return String(value || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, ''); }
    function validEmail(value) { return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(String(value || '').trim()); }
    function validMobile(value) { return /^[6-9]\d{9}$/.test(value); }
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

    function toast(title, message, type) {
      var item = document.createElement('div');
      item.className = 'toast ' + (type || 'info');
      item.innerHTML = '<span class="toast-icon">' + (type === 'success' ? '✓' : type === 'error' ? '!' : '✦') + '</span><span><strong>' + escapeHtml(title) + '</strong><p>' + escapeHtml(message) + '</p></span>';
      $('#toast-stack').appendChild(item);
      setTimeout(function () { item.classList.add('hide'); setTimeout(function () { item.remove(); }, 260); }, 4200);
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
      overlay.hidden = !visible;
      document.body.style.overflow = visible ? 'hidden' : '';
    }

    function showWalletAlert(text) {
      $('#wallet-alert-text').textContent = text || 'RC Card download ke liye ' + formatMoney(priceForDownload('rc-card')) + ' wallet balance chahiye. Admin se recharge karwao.';
      $('#wallet-alert').hidden = false;
    }

    function hideWalletAlert() {
      $('#wallet-alert').hidden = true;
    }

    function openWalletTopup() {
      var current = state.user ? Number(state.user.wallet || 0) : 0;
      $('#topup-current-balance').textContent = formatMoney(current);
      $('#topup-amount').value = '';
      $('#wallet-topup-modal').hidden = false;
      document.body.style.overflow = 'hidden';
      setTimeout(function () { $('#topup-amount').focus(); }, 30);
    }

    function closeWalletTopup() {
      $('#wallet-topup-modal').hidden = true;
      if ($('#fetching-overlay').hidden && $('#download-options-modal').hidden) document.body.style.overflow = '';
    }

    function redirectToWalletTopupWhatsapp() {
      var amount = Number($('#topup-amount').value);
      if (!Number.isFinite(amount) || amount < 1) {
        toast('Amount enter karo', 'Jitna wallet topup chahiye, woh amount daalo.', 'error');
        return;
      }
      var message = 'Hello InstantRCcard support. Mujhe wallet topup karna hai. Amount: ₹' + amount + '. Kripya payment QR bhej dijiye.';
      var whatsappUrl = 'https://wa.me/919057838589?text=' + encodeURIComponent(message);
      closeWalletTopup();
      toast('WhatsApp open ho raha hai', 'Wallet topup ke liye WhatsApp par redirect kiya ja raha hai.', 'success');
      window.location.href = whatsappUrl;
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

    function showApp(user) {
      state.user = user;
      $('#session-loading').hidden = true;
      $('#auth-view').hidden = true;
      $('#topbar').hidden = false;
      $('#dashboard').hidden = false;
      var initials = String(user.name || 'U').trim().charAt(0).toUpperCase();
      $('#avatar').textContent = initials;
      $('#user-name').textContent = user.name;
      $('#dropdown-avatar').textContent = initials;
      $('#dropdown-name').textContent = user.name;
      $('#dropdown-mobile').textContent = '+91 ' + user.mobile;
      $('#dropdown-email').textContent = user.email || 'Email not set';
      $('#welcome-title').textContent = 'Hello, ' + user.name.split(' ')[0] + '.';
      $('#account-name').textContent = user.name;
      $('#account-mobile').textContent = '+91 ' + user.mobile;
      if ($('#account-email')) $('#account-email').textContent = user.email || 'Email not set';
      $('#admin-nav').hidden = user.role !== 'admin';
      if ($('#admin-rates-nav')) $('#admin-rates-nav').hidden = user.role !== 'admin';
      $('#admin-card').hidden = user.role !== 'admin';
      $('#admin-kpi-section').hidden = user.role !== 'admin';
      applyRcPrice(priceForDownload('rc-card'));
      updateWallet(user.wallet);
      loadAds();
      loadPublicStats();
      loadTransactions();
      if (user.role === 'admin') {
        loadAdminTransactions();
        loadAdminAds();
        loadAdminStats();
        loadAdminUsers('', { silent: true });
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
      state.token = '';
      state.user = null;
      $('#auth-view').hidden = false;
      $('#topbar').hidden = true;
      $('#dashboard').hidden = true;
      $('#admin-card').hidden = true;
      $('#admin-kpi-section').hidden = true;
      setAuthMode('login');
    }

    function renderTransactions(transactions) {
      var list = $('#transaction-list');
      if (!transactions || !transactions.length) { list.innerHTML = '<div class="empty-list">Abhi koi transaction nahi hai.</div>'; return; }
      list.innerHTML = transactions.map(function (tx) {
        var credit = Number(tx.amount) > 0;
        var label = tx.type === 'RECHARGE' ? 'Wallet recharge' : 'RC download';
        var icon = credit ? '+' : '↓';
        return '<div class="transaction"><span class="transaction-icon ' + (credit ? 'recharge' : '') + '">' + icon + '</span><span class="transaction-copy"><b>' + escapeHtml(label) + (tx.vrn ? ' · ' + escapeHtml(tx.vrn) : '') + '</b><small>' + formatDate(tx.time) + ' • Balance ' + formatMoney(tx.balanceAfter) + '</small></span><span class="transaction-amount ' + (credit ? 'credit' : 'debit') + '">' + (credit ? '+' : '') + formatMoney(tx.amount) + '</span></div>';
      }).join('');
    }

    async function loadTransactions() {
      try { var result = await callServer('getMyTransactions', []); if (result.success) renderTransactions(result.transactions); } catch (error) { /* keep the dashboard usable */ }
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

    async function loadAdminAds() {
      if (!state.user || state.user.role !== 'admin') return;
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
      try {
        var result = await callServer('adminToggleAd', [id]);
        if (!result.success) { toast('Update failed', result.message, 'error'); return; }
        await loadAdminAds();
        await loadAds();
      } catch (error) { toast('Update error', error.message, 'error'); }
    }

    function setAdminSection(section) {
      $$('[data-admin-section]').forEach(function (button) { button.classList.toggle('active', button.dataset.adminSection === section); });
      $('#admin-wallet-section').hidden = section !== 'wallet';
      if ($('#admin-users-section')) $('#admin-users-section').hidden = section !== 'users';
      $('#admin-ads-section').hidden = section !== 'ads';
      if (section === 'users') loadAdminUsers(state.adminUsersQuery || '', { silent: true });
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
        if (/^https?:\/\//i.test(source)) image.crossOrigin = 'anonymous';
        image.onload = function () { resolve(image); };
        image.onerror = reject;
        image.src = source;
      });
    }

    async function makeA4Png(frontValue, backValue) {
      var frontSource = safeImage(frontValue);
      var backSource = safeImage(backValue);
      if (!frontSource || !backSource) throw new Error('Front/back RC image valid nahi hai.');
      var front = await loadImage(frontSource);
      var back = await loadImage(backSource);
      var dpi = 300;
      var mm = function (value) { return Math.round(value * dpi / 25.4); };
      var pageWidth = 2480; // A4 at 300 DPI
      var pageHeight = 3508;
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

    async function makeCardPng(frontValue, backValue) {
      var frontSource = safeImage(frontValue);
      var backSource = safeImage(backValue);
      if (!frontSource || !backSource) throw new Error('Front/back RC image valid nahi hai.');
      var front = await loadImage(frontSource);
      var back = await loadImage(backSource);
      var dpi = 300;
      var mm = function (value) { return Math.round(value * dpi / 25.4); };
      // RC Card output is exactly two standard card faces, stacked without an A4-sized canvas.
      var pageWidth = mm(85.6);
      var cardHeight = mm(54);
      var gap = 0;
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
      drawCard(back, cardHeight + gap);
      return await new Promise(function (resolve, reject) {
        canvas.toBlob(function (blob) {
          if (blob) resolve(blob); else reject(new Error('PNG create nahi ho paayi.'));
        }, 'image/png');
      });
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

    function showDownloadOptions() {
      var input = $('#vrn-input');
      var vrn = normalizeVrn(input.value);
      input.value = vrn;
      if (!validVrn(vrn)) {
        input.classList.remove('shake'); void input.offsetWidth; input.classList.add('shake');
        toast('Vehicle number check karo', 'Example format: RJ14AB1234', 'error'); return;
      }
      state.pendingVrn = vrn;
      $('#download-options-modal').hidden = false;
      document.body.style.overflow = 'hidden';
    }

    function closeDownloadOptions() {
      $('#download-options-modal').hidden = true;
      document.body.style.overflow = '';
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
      try {
        var response = await callServer('buyRc', [vrn, downloadType]);
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
          ? await makeCardPng(response.data.front, response.data.back)
          : await makeA4Png(response.data.front, response.data.back);
        updateWallet(response.wallet);
        await loadTransactions();
        var label = downloadType === 'rc-card' ? 'RC-Card' : 'MParivahan-RC';
        downloadData(combined, response.data.vrn + '-' + label + '.png');
        setDownloadStatus('PNG download started ✓', response.data.vrn + '-' + label + '.png save ho rahi hai.', 'success');
        toast('Instant download ready', response.data.vrn + ' ki selected RC PNG download ho rahi hai.', 'success');
        $('#vrn-input').value = '';
        state.pendingVrn = '';
      } catch (error) {
        setDownloadStatus('Download failed', error.message, 'error');
        toast('Something went wrong', error.message, 'error');
      } finally {
        setFetchingOverlay(false);
        state.busy = false;
        setButtonLoading(button, false, 'Download RC <span>↗</span>');
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
        return '<tr data-mobile="' + mobile + '">' +
          '<td><b class="admin-user-cell">' + escapeHtml(user.name || 'User') + (user.role === 'admin' ? ' (admin)' : '') + '</b><small class="admin-user-sub">' + escapeHtml(user.email || 'Email not set') + '</small></td>' +
          '<td>+91 ' + mobile + '</td>' +
          '<td>' + escapeHtml(formatMoney(user.wallet)) + '</td>' +
          '<td><span class="admin-rate-cell"><input class="admin-row-rate" type="number" min="1" max="1000" step="1" value="' + escapeHtml(String(user.prices && user.prices.rcCard != null ? user.prices.rcCard : user.rate)) + '" data-mobile="' + mobile + '" aria-label="RC rate" /><span class="rate-state ' + (isCustom ? 'custom' : 'default') + '">' + (isCustom ? 'CUSTOM' : 'DEFAULT') + '</span></span></td>' +
          '<td><span class="admin-rate-actions"><button class="blue-button small-blue" type="button" data-rate-save="' + mobile + '">Set rate</button>' +
          (isCustom ? '<button class="ghost-button small-blue" type="button" data-rate-reset="' + mobile + '">Default</button>' : '') +
          '</span></td>' +
          '<td>' + (user.active === false
            ? '<button class="ghost-button small-blue" type="button" data-user-toggle="' + mobile + '" data-active="1">Unblock</button> <span class="rate-state blocked">BLOCKED</span>'
            : '<button class="ghost-button small-blue" type="button" data-user-toggle="' + mobile + '" data-active="0">Block</button>') + '</td>' +
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

    async function loadAdminUsers(query, options) {
      if (!state.user || state.user.role !== 'admin') return;
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
      var amount = Number($('#admin-amount').value);
      if (!state.selectedAdminMobile) { toast('Pehle user search karo', 'Mobile number se user find karo.', 'error'); return; }
      if (!amount || amount <= 0) { toast('Amount enter karo', 'Recharge amount ₹1 se zyada hona chahiye.', 'error'); return; }
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

    async function loadAdminTransactions() {
      if (!state.user || state.user.role !== 'admin') return;
      try {
        var response = await callServer('adminGetTransactions', []);
        if (!response.success) return;
        var body = $('#admin-tx-body');
        if (!response.transactions.length) { body.innerHTML = '<tr><td colspan="5">No transactions yet.</td></tr>'; return; }
        body.innerHTML = response.transactions.map(function (tx) {
          var credit = Number(tx.amount) > 0;
          return '<tr><td>' + escapeHtml(formatDate(tx.time)) + '</td><td>' + escapeHtml(tx.mobile) + '</td><td>' + escapeHtml(tx.type) + '</td><td class="' + (credit ? 'credit' : 'debit') + '">' + (credit ? '+' : '') + escapeHtml(formatMoney(tx.amount)) + '</td><td>' + escapeHtml(tx.vrn || '—') + '</td></tr>';
        }).join('');
      } catch (error) { /* admin table is non-critical */ }
    }

    function renderAdminStats(stats) {
      if (!stats) return;
      $('#kpi-total-users').textContent = Number(stats.totalUsers || 0).toLocaleString('en-IN');
      $('#kpi-active-users').textContent = Number(stats.activeUsers || 0).toLocaleString('en-IN');
      $('#kpi-today-topup').textContent = formatMoney(stats.todayTopup);
      $('#kpi-month-topup').textContent = formatMoney(stats.monthTopup);
      $('#kpi-last-month-topup').textContent = formatMoney(stats.lastMonthTopup);
      $('#kpi-today-rc').textContent = Number(stats.todayRcDownloads || 0).toLocaleString('en-IN');
      $('#kpi-month-rc').textContent = Number(stats.monthRcDownloads || 0).toLocaleString('en-IN');
      $('#kpi-last-month-rc').textContent = Number(stats.lastMonthRcDownloads || 0).toLocaleString('en-IN');
      var rangeCard = $('#admin-kpi-range');
      if (stats.range) {
        rangeCard.hidden = false;
        $('#kpi-range-label').textContent = stats.range.from + ' se ' + stats.range.to;
        $('#kpi-range-topup').textContent = formatMoney(stats.range.topup);
        $('#kpi-range-rc').textContent = Number(stats.range.rcDownloads || 0).toLocaleString('en-IN') + ' RC downloads • ' + Number(stats.range.newUsers || 0).toLocaleString('en-IN') + ' new users';
      } else {
        rangeCard.hidden = true;
      }
    }

    async function loadAdminStats(range) {
      if (!state.user || state.user.role !== 'admin') return;
      try {
        var response = await callServer('adminGetStats', [range || null]);
        if (response.success) {
          renderAdminStats(response.stats);
          if (response.settings) {
            if (response.settings.rating) $('#admin-rating-input').value = response.settings.rating;
            $('#admin-users-baseline-input').value = response.settings.usersBaseline;
            $('#admin-downloads-baseline-input').value = response.settings.downloadsBaseline;
            if (response.settings.rcCardPrice) $('#admin-rc-price-input').value = response.settings.rcCardPrice;
          }
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

    async function saveAdminRcPrice() {
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
      var username = String($('#login-username').value || '').trim();
      var password = $('#login-password').value;
      $('#login-error').textContent = '';
      if (!username || !password) { $('#login-error').textContent = 'Mobile number ya email, aur password enter karo.'; return; }
      var mobile = normalizeMobile(username);
      if (validMobile(mobile)) username = mobile;
      else if (username.includes('@')) {
        username = username.toLowerCase();
        if (!validEmail(username)) { $('#login-error').textContent = 'Valid email address daalo.'; return; }
      } else {
        $('#login-error').textContent = 'Valid 10-digit mobile number ya email daalo.';
        return;
      }
      $('#login-username').value = username;
      var button = $('#login-button'); setButtonLoading(button, true, 'Login karo <span>→</span>');
      try {
        var response = await callServer('login', [username, password]);
        if (!response.success) { $('#login-error').textContent = response.message; return; }
        showApp(response.user); toast('Welcome back', 'Aapka account login ho gaya.', 'success');
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
        showApp(response.user); toast('Account created', 'Admin recharge ke baad RC download kar sakte ho.', 'success');
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
        if ($('#login-username')) $('#login-username').value = mobile || email;
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
      $('#user-menu-button').setAttribute('aria-expanded', 'false');
      $('#user-menu-button').classList.remove('open');
      $('#user-dropdown').classList.remove('open');
      setTimeout(function () { if (!$('#user-dropdown').classList.contains('open')) $('#user-dropdown').hidden = true; }, 120);
    }

    function toggleUserDropdown() {
      var dropdown = $('#user-dropdown');
      var isOpen = dropdown.classList.contains('open');
      if (isOpen) { closeUserDropdown(); return; }
      dropdown.hidden = false;
      requestAnimationFrame(function () {
        dropdown.classList.add('open');
        $('#user-menu-button').classList.add('open');
        $('#user-menu-button').setAttribute('aria-expanded', 'true');
      });
    }

    $('#user-menu-button').addEventListener('click', function (event) { event.stopPropagation(); toggleUserDropdown(); });
    document.addEventListener('click', function (event) { if (!$('#user-menu-wrap').contains(event.target)) closeUserDropdown(); });
    document.addEventListener('keydown', function (event) { if (event.key === 'Escape') closeUserDropdown(); });
    $('#logout-button').addEventListener('click', async function () { closeUserDropdown(); try { await callServer('logout', []); } catch (error) {} clearSession(); toast('Logged out', 'Aapka session close ho gaya.', 'success'); });
    $('#refresh-transactions').addEventListener('click', loadTransactions);
    $('#admin-search-button').addEventListener('click', findAdminUser);
    $('#admin-search-mobile').addEventListener('keydown', function (event) {
      if (event.key === 'Enter') { event.preventDefault(); findAdminUser(); }
    });
    $('#admin-recharge-button').addEventListener('click', rechargeAdminUser);
    if ($('#admin-user-rate-save')) $('#admin-user-rate-save').addEventListener('click', function () { saveAdminUserRate(false); });
    if ($('#admin-user-rate-clear')) $('#admin-user-rate-clear').addEventListener('click', function () { saveAdminUserRate(true); });
    if ($('#admin-users-search-button')) $('#admin-users-search-button').addEventListener('click', searchAdminUsersList);
    if ($('#admin-users-search')) $('#admin-users-search').addEventListener('keydown', function (event) {
      if (event.key === 'Enter') { event.preventDefault(); searchAdminUsersList(); }
    });
    if ($('#admin-users-all-button')) $('#admin-users-all-button').addEventListener('click', showAllAdminUsers);
    if ($('#admin-users-csv-button')) $('#admin-users-csv-button').addEventListener('click', exportAdminUsersCsv);
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
    $('#admin-stats-apply').addEventListener('click', applyAdminStatsFilter);
    $('#admin-stats-reset').addEventListener('click', resetAdminStatsFilter);
    $('#admin-rating-save').addEventListener('click', saveAdminRating);
    $('#admin-baseline-save').addEventListener('click', saveAdminBaseline);
    $('#admin-rc-price-save').addEventListener('click', saveAdminRcPrice);
    $('#admin-ad-upload').addEventListener('click', uploadAdvertisement);
    $$('[data-admin-section]').forEach(function (button) { button.addEventListener('click', function () { setAdminSection(button.dataset.adminSection); }); });
    $$('.topbar-nav button').forEach(function (button) { button.addEventListener('click', function () { var target = $('#' + button.dataset.scroll); if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' }); $$('.topbar-nav button').forEach(function (item) { item.classList.remove('active'); }); button.classList.add('active'); }); });

    async function boot() {
      loadPublicPricing();
      try {
        var response = await callServer('getMe', []);
        if (response.success) showApp(response.user); else clearSession();
      } catch (error) { clearSession(); }
    }
    boot();
