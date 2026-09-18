
    var state = { token: '', user: null, selectedAdminMobile: '', pendingVrn: '', busy: false };
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
        navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch(function () {
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
      else if (name === 'login') { url = '/api/auth/login'; options.method = 'POST'; options.headers['Content-Type'] = 'application/json'; options.body = JSON.stringify({ email: args[0], mobile: args[1], password: args[2] }); }
      else if (name === 'forgotPassword') { url = '/api/auth/forgot-password'; options.method = 'POST'; options.headers['Content-Type'] = 'application/json'; options.body = JSON.stringify({ email: args[0], mobile: args[1], newPassword: args[2], confirmPassword: args[3] }); }
      else if (name === 'logout') { url = '/api/auth/logout'; options.method = 'POST'; }
      else if (name === 'getMe') { url = '/api/auth/session'; }
      else if (name === 'buyRc') { url = '/api/rc/purchase'; options.method = 'POST'; options.headers['Content-Type'] = 'application/json'; options.body = JSON.stringify({ vrn: args[0], downloadType: args[1] || 'mparivahan' }); }
      else if (name === 'getMyTransactions') { url = '/api/account/transactions'; }
      else if (name === 'getAds') { url = '/api/ads'; }
      else if (name === 'adminFindUser') { url = '/api/admin/users/search'; options.method = 'POST'; options.headers['Content-Type'] = 'application/json'; options.body = JSON.stringify({ mobile: args[0] }); }
      else if (name === 'adminRecharge') { url = '/api/admin/recharge'; options.method = 'POST'; options.headers['Content-Type'] = 'application/json'; options.body = JSON.stringify({ mobile: args[0], amount: args[1], note: args[2] }); }
      else if (name === 'adminGetTransactions') { url = '/api/admin/transactions'; }
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
      $('#wallet-alert-text').textContent = text || 'Format ke hisaab se ₹10 ya ₹15 wallet balance chahiye. Admin se recharge karwao.';
      $('#wallet-alert').hidden = false;
    }

    function hideWalletAlert() {
      $('#wallet-alert').hidden = true;
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

    function showApp(user) {
      state.user = user;
      $('#session-loading').hidden = true;
      $('#auth-view').hidden = true;
      $('#topbar').hidden = false;
      $('#dashboard').hidden = false;
      var initials = String(user.name || 'U').trim().charAt(0).toUpperCase();
      $('#avatar').textContent = initials;
      $('#user-name').textContent = user.name;
      $('#welcome-title').textContent = 'Hello, ' + user.name.split(' ')[0] + '.';
      $('#account-name').textContent = user.name;
      $('#account-mobile').textContent = '+91 ' + user.mobile;
      if ($('#account-email')) $('#account-email').textContent = user.email || 'Email not set';
      $('#admin-nav').hidden = user.role !== 'admin';
      $('#admin-card').hidden = user.role !== 'admin';
      updateWallet(user.wallet);
      loadAds();
      loadTransactions();
      if (user.role === 'admin') {
        loadAdminTransactions();
        loadAdminAds();
      }
    }

    function updateWallet(amount) {
      var value = Number(amount || 0);
      $('#wallet-amount').textContent = formatMoney(value);
      $('#balance-large').textContent = formatMoney(value);
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
      $('#admin-ads-section').hidden = section !== 'ads';
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
      // Format select hone se pehle minimum price MParivahan ka ₹10 hai.
      // RC Card ke ₹15 check ko purchaseAndDownload me dobara kiya jaata hai.
      if (state.user && Number(state.user.wallet || 0) < priceForDownload('mparivahan')) {
        var minimum = priceForDownload('mparivahan');
        showWalletAlert('Wallet balance ' + formatMoney(state.user.wallet || 0) + ' hai. Minimum ' + formatMoney(minimum) + ' chahiye.');
        setDownloadStatus('Recharge your wallet', 'Download ke liye minimum ' + formatMoney(minimum) + ' wallet balance chahiye.', 'error');
        toast('Recharge your wallet', 'Wallet balance kam hai. Admin se recharge karwao.', 'error');
        return;
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

      // Format choose hone ke baad exact price check; low balance par provider call nahi hoga.
      if (state.user && Number(state.user.wallet || 0) < price) {
        closeDownloadOptions();
        showWalletAlert('Wallet balance ' + formatMoney(state.user.wallet || 0) + ' hai. Is format ke liye ' + formatMoney(price) + ' chahiye.');
        setDownloadStatus('Recharge your wallet', 'Is format ke liye minimum ' + formatMoney(price) + ' wallet balance chahiye.', 'error');
        toast('Recharge your wallet', 'RC Card ke liye ₹15 aur MParivahan ke liye ₹10 chahiye.', 'error');
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
          if (response.code === 'LOW_BALANCE') {
            var requiredPrice = Number(response.requiredPrice || price);
            showWalletAlert('Wallet balance ' + formatMoney(response.wallet || 0) + ' hai. Is format ke liye ' + formatMoney(requiredPrice) + ' chahiye.');
            setDownloadStatus('Recharge your wallet', 'Is format ke liye minimum ' + formatMoney(requiredPrice) + ' wallet balance chahiye.', 'error');
            toast('Recharge your wallet', 'RC Card ke liye ₹15 aur MParivahan ke liye ₹10 chahiye.', 'error');
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

    async function findAdminUser() {
      var mobile = normalizeMobile($('#admin-search-mobile').value);
      $('#admin-search-mobile').value = mobile;
      if (!validMobile(mobile)) { toast('Mobile check karo', 'Valid 10-digit user mobile number daalo.', 'error'); return; }
      var button = $('#admin-search-button');
      setButtonLoading(button, true, 'Find user');
      try {
        var response = await callServer('adminFindUser', [mobile]);
        if (!response.success) { $('#admin-user-result').hidden = true; toast('User nahi mila', response.message, 'error'); return; }
        state.selectedAdminMobile = response.user.mobile;
        $('#admin-user-result').hidden = false;
        $('#admin-user-name').textContent = response.user.name;
        $('#admin-user-mobile').textContent = '+91 ' + response.user.mobile;
        $('#admin-user-balance').innerHTML = formatMoney(response.user.wallet) + '<small>current wallet</small>';
        $('#admin-recharge-button').disabled = false;
        toast('User found', response.user.name + ' ka wallet ready hai.', 'success');
      } catch (error) { toast('Admin error', error.message, 'error'); }
      finally { setButtonLoading(button, false, 'Find user'); }
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
      var email = $('#login-email').value.trim().toLowerCase();
      var mobile = normalizeMobile($('#login-mobile').value);
      var password = $('#login-password').value;
      $('#login-error').textContent = '';
      if (!validEmail(email) || !validMobile(mobile) || !password) { $('#login-error').textContent = 'Email, mobile number aur password sahi se enter karo.'; return; }
      var button = $('#login-button'); setButtonLoading(button, true, 'Login karo <span>→</span>');
      try {
        var response = await callServer('login', [email, mobile, password]);
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
        $('#login-email').value = email;
        $('#login-mobile').value = mobile;
        $('#login-password').value = '';
        setAuthMode('login');
        toast('Password updated', 'Ab naye password se login karo.', 'success');
      } catch (error) { $('#forgot-error').textContent = error.message; }
      finally { setButtonLoading(button, false, 'Set new password <span>→</span>'); }
    });

    $('#rc-form').addEventListener('submit', function (event) { event.preventDefault(); showDownloadOptions(); });
    $('#close-format-modal').addEventListener('click', closeDownloadOptions);
    $('#download-options-modal').addEventListener('click', function (event) { if (event.target === $('#download-options-modal')) closeDownloadOptions(); });
    document.addEventListener('keydown', function (event) { if (event.key === 'Escape' && !$('#download-options-modal').hidden) closeDownloadOptions(); });
    $$('.format-option').forEach(function (option) { option.addEventListener('click', function () { purchaseAndDownload(option.dataset.downloadFormat); }); });
    $('#close-download-status').addEventListener('click', function () { $('#download-status').hidden = true; });
    $('#close-wallet-alert').addEventListener('click', hideWalletAlert);
    $('#install-auth-button').addEventListener('click', installApp);
    $('#install-dashboard-button').addEventListener('click', installApp);
    updateInstallButtons();
    $('#logout-button').addEventListener('click', async function () { try { await callServer('logout', []); } catch (error) {} clearSession(); toast('Logged out', 'Aapka session close ho gaya.', 'success'); });
    $('#refresh-transactions').addEventListener('click', loadTransactions);
    $('#admin-search-button').addEventListener('click', findAdminUser);
    $('#admin-recharge-button').addEventListener('click', rechargeAdminUser);
    $('#admin-ad-upload').addEventListener('click', uploadAdvertisement);
    $$('[data-admin-section]').forEach(function (button) { button.addEventListener('click', function () { setAdminSection(button.dataset.adminSection); }); });
    $$('.topbar-nav button').forEach(function (button) { button.addEventListener('click', function () { var target = $('#' + button.dataset.scroll); if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' }); $$('.topbar-nav button').forEach(function (item) { item.classList.remove('active'); }); button.classList.add('active'); }); });

    async function boot() {
      try {
        var response = await callServer('getMe', []);
        if (response.success) showApp(response.user); else clearSession();
      } catch (error) { clearSession(); }
    }
    boot();
