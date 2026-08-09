export {};

// NexBucket i18n — Bilingual support (English / Vietnamese)
(function() {
  const translations = {
    en: {
      // Topbar
      nav_add_bot: 'Add Bot',
      nav_status: 'Status',
      nav_login: 'Login',
      nav_signin: 'Sign in',
      nav_logout: 'Logout',
      // Landing Hero
      hero_badge: 'Source-available Discord management',
      hero_title: 'Your Discord Server,\nPowered by NexBucket',
      hero_subtitle: 'An all-in-one Discord bot with tickets, payments, moderation, Minecraft status, auto-roles and much more — fully configurable from a beautiful web dashboard.',
      hero_highlight_dashboard: 'Secure Discord OAuth2 dashboard',
      hero_highlight_modules: 'Production-ready server modules',
      hero_highlight_control: 'Per-server permissions and controls',
      hero_btn_add: 'Add to Discord',
      hero_btn_login: 'Open Dashboard',
      // Landing Features
      feat_title: 'Everything You Need',
      feat_subtitle: 'Built-in powerful modules to supercharge your Discord server.',
      feat_ticket_title: 'Ticket System',
      feat_ticket_desc: 'Advanced support ticket management with categories, auto-close, transcripts, and staff claims.',
      feat_economy_title: 'Payments & Banking',
      feat_economy_desc: 'VietQR, PayOS, and Card2K payment integration. Generate QR codes for real-money donations.',
      feat_mod_title: 'Moderation',
      feat_mod_desc: 'Anti-spam, anti-raid, anti-link, rogue bot kicker, banned words filter, and full audit logs.',
      feat_voice_title: 'Voice Channels',
      feat_voice_desc: 'Join-to-Create dynamic voice channels. Users get their own temporary room automatically.',
      feat_welcome_title: 'Welcome System',
      feat_welcome_desc: 'Beautiful custom welcome cards with backgrounds, goodbye messages, and auto-role on join.',
      feat_mc_title: 'Minecraft Status',
      feat_mc_desc: 'Track multiple Minecraft servers with live status banners auto-posted in your Discord channels.',
      // Landing Creator
      creator_title: 'Crafted with Care',
      creator_desc: 'NexBucket is developed and maintained by',
      creator_name: 'Elaina',
      creator_detail: 'Built with Node.js, Discord.js, and Supabase. Designed to be fast, reliable, and beautiful.',
      // Server picker
      your_servers: 'Your Servers',
      back_to_servers: 'Back to Servers',
      save_config: 'Save Configuration',
      // Footer
      footer_tos: 'Terms of Service',
      footer_privacy: 'Privacy Policy',
      // Dashboard sections
      sec_general: 'General Settings',
      sec_welcome: 'Welcome & Goodbye',
      sec_ticket: 'Ticket System',
      sec_jtc: 'Join to Create',
      sec_mod: 'Security & Moderation',
      sec_bank: 'VietQR & PayOS Banking',
      sec_status: 'Minecraft & Server Status',
      sec_transcripts: 'Ticket Transcripts',
      // Dashboard labels
      auto_role: 'Auto-Role on Join',
      auto_role_hint: 'Automatically assign this role when a member joins the server.',
      // Status messages
      saving: 'Saving to Supabase...',
      save_success: 'Configuration saved successfully!',
      load_config: 'Loading configuration...',
      // Guide Modal
      guide_title_payos: 'PayOS Integration Guide',
      guide_title_card2k: 'Card2K Integration Guide',
      guide_btn: 'Setup Guide',
      guide_payos_steps: [
        'Go to <a href="https://payos.vn" target="_blank">payos.vn</a> and create an account.',
        'Create a new Payment Channel in your PayOS dashboard.',
        'Copy the <strong>Client ID</strong>, <strong>API Key</strong>, and <strong>Checksum Key</strong> from your channel settings.',
        'Paste them into the corresponding fields below.',
        'Set the <strong>Webhook URL</strong> in PayOS to:',
        'Select a <strong>Payment Notification Channel</strong> in Discord to receive payment alerts.',
        'Save your configuration. You\'re all set!'
      ],
      guide_card2k_steps: [
        'Go to <a href="https://card2k.com" target="_blank">card2k.com</a> and register a merchant account.',
        'Navigate to <strong>API Settings</strong> in your Card2K merchant panel.',
        'Copy your <strong>Partner ID</strong> and <strong>Partner Key</strong>.',
        'Paste them into the fields below.',
        'Set the <strong>Callback URL</strong> in Card2K to:',
        'Save your configuration. Card top-ups will now be processed automatically!'
      ],
      guide_copy: 'Click to copy',
      guide_copied: 'Copied!',
      // Misc
      no_servers_tracked: 'No servers tracked yet.',
      add_tracked_server: 'Add Tracked Server',
      refresh_interval: 'Refresh Interval (seconds)',
      tracked_servers: 'Tracked Servers',
      server_ip: 'Server IP',
      server_port: 'Server Port',
      update_channel: 'Update Channel',
      add: 'Add',
      cancel: 'Cancel',
      ip_channel_required: 'IP and Channel are required!',
      // Auth
      auth_required: 'Authentication Required',
      auth_desc: 'Sign in with your Discord account to manage your servers.',
    },
    vi: {
      // Topbar
      nav_add_bot: 'Thêm Bot',
      nav_status: 'Trạng thái',
      nav_login: 'Đăng nhập',
      nav_signin: 'Đăng nhập',
      nav_logout: 'Đăng xuất',
      // Landing Hero
      hero_badge: 'Quản lý Discord công khai mã nguồn',
      hero_title: 'Máy chủ Discord của bạn,\nĐược hỗ trợ bởi NexBucket',
      hero_subtitle: 'Bot Discord tất-cả-trong-một với ticket, thanh toán, kiểm duyệt, trạng thái Minecraft, auto-role và nhiều hơn nữa — cấu hình toàn bộ qua trang quản trị web.',
      hero_highlight_dashboard: 'Dashboard Discord OAuth2 bảo mật',
      hero_highlight_modules: 'Module máy chủ sẵn sàng vận hành',
      hero_highlight_control: 'Phân quyền và điều khiển theo máy chủ',
      hero_btn_add: 'Thêm vào Discord',
      hero_btn_login: 'Mở bảng điều khiển',
      // Landing Features
      feat_title: 'Mọi thứ bạn cần',
      feat_subtitle: 'Các module mạnh mẽ tích hợp sẵn giúp nâng cấp máy chủ Discord của bạn.',
      feat_ticket_title: 'Hệ thống Ticket',
      feat_ticket_desc: 'Quản lý ticket hỗ trợ nâng cao với danh mục, tự đóng, bản ghi, và nhận việc cho staff.',
      feat_economy_title: 'Thanh toán & Ngân hàng',
      feat_economy_desc: 'Tích hợp thanh toán VietQR, PayOS và Card2K. Tạo mã QR để nhận donate bằng tiền thật.',
      feat_mod_title: 'Kiểm duyệt',
      feat_mod_desc: 'Chống spam, chống raid, chống link, auto-kick bot lạ, lọc từ cấm, và nhật ký kiểm toán.',
      feat_voice_title: 'Kênh thoại',
      feat_voice_desc: 'Kênh thoại Join-to-Create tự động. Người dùng có phòng riêng khi tham gia.',
      feat_welcome_title: 'Hệ thống Chào mừng',
      feat_welcome_desc: 'Thẻ chào mừng tùy chỉnh đẹp mắt với ảnh nền, tin nhắn tạm biệt, và tự động gán role.',
      feat_mc_title: 'Trạng thái Minecraft',
      feat_mc_desc: 'Theo dõi nhiều máy chủ Minecraft với banner trạng thái trực tiếp đăng tự động trong kênh Discord.',
      // Landing Creator
      creator_title: 'Được tạo ra với tâm huyết',
      creator_desc: 'NexBucket được phát triển và duy trì bởi',
      creator_name: 'Elaina',
      creator_detail: 'Xây dựng bằng Node.js, Discord.js và Supabase. Được thiết kế nhanh, đáng tin cậy và đẹp mắt.',
      // Server picker
      your_servers: 'Máy chủ của bạn',
      back_to_servers: 'Quay lại Máy chủ',
      save_config: 'Lưu cấu hình',
      // Footer
      footer_tos: 'Điều khoản dịch vụ',
      footer_privacy: 'Chính sách bảo mật',
      // Dashboard sections
      sec_general: 'Cài đặt Chung',
      sec_welcome: 'Chào mừng & Tạm biệt',
      sec_ticket: 'Hệ thống Ticket',
      sec_jtc: 'Join to Create',
      sec_mod: 'Bảo mật & Kiểm duyệt',
      sec_bank: 'VietQR & PayOS Ngân hàng',
      sec_status: 'Minecraft & Trạng thái Máy chủ',
      sec_transcripts: 'Bản ghi Ticket',
      // Dashboard labels
      auto_role: 'Tự động gán Role khi tham gia',
      auto_role_hint: 'Tự động gán role này khi thành viên mới tham gia máy chủ.',
      // Status messages
      saving: 'Đang lưu vào Supabase...',
      save_success: 'Cấu hình đã lưu thành công!',
      load_config: 'Đang tải cấu hình...',
      // Guide Modal
      guide_title_payos: 'Hướng dẫn tích hợp PayOS',
      guide_title_card2k: 'Hướng dẫn tích hợp Card2K',
      guide_btn: 'Hướng dẫn',
      guide_payos_steps: [
        'Truy cập <a href="https://payos.vn" target="_blank">payos.vn</a> và tạo tài khoản.',
        'Tạo một Kênh thanh toán mới trong bảng điều khiển PayOS.',
        'Sao chép <strong>Client ID</strong>, <strong>API Key</strong> và <strong>Checksum Key</strong> từ phần cài đặt kênh.',
        'Dán chúng vào các ô tương ứng bên dưới.',
        'Đặt <strong>Webhook URL</strong> trong PayOS thành:',
        'Chọn một <strong>Kênh thông báo thanh toán</strong> trên Discord để nhận thông báo.',
        'Lưu cấu hình. Bạn đã hoàn tất!'
      ],
      guide_card2k_steps: [
        'Truy cập <a href="https://card2k.com" target="_blank">card2k.com</a> và đăng ký tài khoản đối tác.',
        'Vào phần <strong>Cài đặt API</strong> trong bảng quản lý Card2K.',
        'Sao chép <strong>Partner ID</strong> và <strong>Partner Key</strong>.',
        'Dán chúng vào các ô bên dưới.',
        'Đặt <strong>Callback URL</strong> trong Card2K thành:',
        'Lưu cấu hình. Nạp thẻ sẽ được xử lý tự động!'
      ],
      guide_copy: 'Nhấn để sao chép',
      guide_copied: 'Đã sao chép!',
      // Misc
      no_servers_tracked: 'Chưa có máy chủ nào được theo dõi.',
      add_tracked_server: 'Thêm Máy chủ',
      refresh_interval: 'Tần suất làm mới (giây)',
      tracked_servers: 'Máy chủ đang theo dõi',
      server_ip: 'IP Máy chủ',
      server_port: 'Cổng Máy chủ',
      update_channel: 'Kênh cập nhật',
      add: 'Thêm',
      cancel: 'Hủy',
      ip_channel_required: 'IP và Kênh là bắt buộc!',
      // Auth
      auth_required: 'Yêu cầu xác thực',
      auth_desc: 'Đăng nhập bằng tài khoản Discord để quản lý máy chủ.',
    }
  };

  function getLang() {
    const saved = localStorage.getItem('nex-lang');
    if (saved && translations[saved]) return saved;
    const browserLang = (navigator.language || '').toLowerCase();
    if (browserLang.startsWith('vi')) return 'vi';
    return 'en';
  }

  let currentLang = getLang();

  const flagMarkup = {
    en: '<svg class="language-flag" viewBox="0 0 60 30" aria-hidden="true"><path fill="#012169" d="M0 0h60v30H0z"/><path stroke="#fff" stroke-width="6" d="m0 0 60 30m0-30L0 30"/><path stroke="#c8102e" stroke-width="3.5" d="m0 0 60 30m0-30L0 30"/><path stroke="#fff" stroke-width="10" d="M30 0v30M0 15h60"/><path stroke="#c8102e" stroke-width="6" d="M30 0v30M0 15h60"/></svg><span class="language-code">EN</span>',
    vi: '<svg class="language-flag" viewBox="0 0 900 600" aria-hidden="true"><path fill="#da251d" d="M0 0h900v600H0z"/><path fill="#ff0" d="m450 115 44 135h142l-115 83 44 135-115-83-115 83 44-135-115-83h142z"/></svg><span class="language-code">VI</span>',
  };

  function t(key) {
    return translations[currentLang]?.[key] ?? translations['en']?.[key] ?? key;
  }

  function setLang(lang) {
    if (!translations[lang]) return;
    currentLang = lang;
    localStorage.setItem('nex-lang', lang);
    applyTranslations();
    document.dispatchEvent(new CustomEvent('langChanged', { detail: { lang } }));
  }

  function applyTranslations() {
    document.querySelectorAll('[data-i18n]').forEach(el => {
      const key = el.getAttribute('data-i18n');
      const val = t(key);
      if (val) el.textContent = val;
    });
    document.querySelectorAll('[data-i18n-html]').forEach(el => {
      const key = el.getAttribute('data-i18n-html');
      const val = t(key);
      if (val) el.innerHTML = val;
    });
    document.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
      const key = el.getAttribute('data-i18n-placeholder');
      const val = t(key);
      if (val) el.placeholder = val;
    });
    document.documentElement.lang = currentLang;
    const langBtn = document.getElementById('langToggle');
    if (langBtn) {
      langBtn.innerHTML = flagMarkup[currentLang];
      langBtn.setAttribute('aria-label', currentLang === 'vi' ? 'Switch to English' : 'Chuyển sang tiếng Việt');
      langBtn.title = currentLang === 'vi' ? 'English' : 'Tiếng Việt';
    }
  }

  // Expose globally
  window.NexI18n = { t, setLang, getLang: () => currentLang, applyTranslations };

  // Auto-apply on DOM ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', applyTranslations);
  } else {
    applyTranslations();
  }
})();
