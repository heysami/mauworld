const revealables = document.querySelectorAll("[data-reveal]");

if (revealables.length > 0) {
  const revealObserver = new IntersectionObserver(
    (entries, observer) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) {
          continue;
        }
        entry.target.classList.add("is-visible");
        observer.unobserve(entry.target);
      }
    },
    {
      threshold: 0.2,
      rootMargin: "0px 0px -8% 0px",
    },
  );

  revealables.forEach((element) => revealObserver.observe(element));
}

const footerYears = document.querySelectorAll("[data-current-year]");
const currentYear = new Date().getFullYear();
footerYears.forEach((node) => {
  node.textContent = String(currentYear);
});

const guideLinks = Array.from(document.querySelectorAll(".guide-index a[href^='#']"));
const guideTargets = guideLinks
  .map((link) => {
    const id = link.getAttribute("href")?.slice(1) ?? "";
    const target = id ? document.getElementById(id) : null;
    return target ? { link, target } : null;
  })
  .filter(Boolean);

if (guideTargets.length > 0) {
  const setCurrentLink = (id) => {
    guideLinks.forEach((link) => {
      const matches = link.getAttribute("href") === `#${id}`;
      link.classList.toggle("is-current", matches);
      if (matches) {
        link.setAttribute("aria-current", "true");
      } else {
        link.removeAttribute("aria-current");
      }
    });
  };

  const hashId = window.location.hash.replace(/^#/, "");
  if (hashId) {
    setCurrentLink(hashId);
  }

  const sectionObserver = new IntersectionObserver(
    (entries) => {
      const visible = entries
        .filter((entry) => entry.isIntersecting)
        .sort((left, right) => right.intersectionRatio - left.intersectionRatio)[0];

      if (visible?.target?.id) {
        setCurrentLink(visible.target.id);
      }
    },
    {
      threshold: [0.2, 0.45, 0.7],
      rootMargin: "-12% 0px -50% 0px",
    },
  );

  guideTargets.forEach(({ target }) => sectionObserver.observe(target));
}

const languageSelector = document.querySelector("[data-language-selector]");

if (languageSelector) {
  const featureCards = Array.from(document.querySelectorAll("[data-feature-grid] .feature-card")).map(
    (card) => ({
      title: card.querySelector("h3"),
      description: card.querySelector(".feature-card__head p"),
      points: Array.from(card.querySelectorAll(".point-item")).map((point) => ({
        title: point.querySelector(".point-copy strong"),
        description: point.querySelector(".point-copy span"),
      })),
    }),
  );

  const startSteps = Array.from(document.querySelectorAll("[data-start-grid] .start-step")).map(
    (step) => ({
      title: step.querySelector("h3"),
      description: step.querySelector("p"),
      cta: step.querySelector("[data-start-cta-label]"),
    }),
  );

  const slotNodes = Object.fromEntries(
    Array.from(document.querySelectorAll("[data-slot]")).map((node) => [node.dataset.slot, node]),
  );
  const metaDescription = document.querySelector("[data-slot-attr='meta_description']");

  const landingTranslations = {
    en: {
      title: "Maumau | Download and setup",
      metaDescription:
        "A polished landing page for Maumau's guided setup, multilingual operation, telephony-ready automation, specialist teams, and downloadable macOS app.",
      text: {
        brand_eyebrow: "Maumau app",
        brand_sub: "Download, setup, and control.",
        nav_landing: "Landing",
        nav_guide: "Dashboard guide",
        nav_download: "Download macOS app",
        hero_kicker: "Guided from install to first real run",
        hero_lede: "Personal AI team",
        hero_download: "Download Maumau for macOS",
        hero_guide: "Open operations dashboard guide",
        hero_panel_topline: "Latest macOS installer ready",
        hero_pocket_setup_title: "Guided setup",
        hero_pocket_setup_desc: "Install, connect, onboard.",
        hero_pocket_voice_title: "Voice ready",
        hero_pocket_voice_desc: "Telephony, speech, voice defaults.",
        hero_pocket_teams_title: "Specialist teams",
        hero_pocket_teams_desc: "Build, design, business, life.",
        why_kicker: "Why Maumau",
        why_title: "Get to a real run without setup fatigue.",
        why_desc:
          "Guided onboarding first. Defaults stay filled in. Teams, memory, and dashboards are already part of the system.",
        start_kicker: "How to start",
        start_title: "Five steps to your first run.",
        start_desc:
          "Set up the accounts and connections once, then download Maumau and follow the guide inside the app.",
        story_kicker: "Life already happens in chat",
        story_title: "Stay where people already talk.",
        story_desc: "WhatsApp, Telegram, Slack, Discord, Matrix, Teams, iMessage, and more.",
        story_point1_title: "Inbox light",
        story_point1_desc: "Fast touch. Familiar surfaces.",
        story_point2_title: "Dashboard deep",
        story_point2_desc: "Full context when you need the operating picture.",
        mock_label: "Maumau chat mock",
        mock_badge: "Brand-safe mock",
        mock_status: "online",
        mock_chat_1: "Need the short version before the call.",
        mock_chat_2: "Done. Notes, priorities, and next step are ready.",
        mock_chat_3: "Also remind me tonight.",
        mock_chat_4: "Added to your routine.",
        footer_note: "Landing page for the current Maumau local build.",
        footer_landing: "Landing",
        footer_guide: "Dashboard guide",
        footer_download: "Download macOS app",
      },
      featureCards: [
        {
          title: "Guided onboarding",
          description: "The setup stays out of the terminal.",
          points: [
            {
              title: "Only the needed steps",
              description: "It asks for what matters and leaves the rest quiet.",
            },
            {
              title: "Channels, calls, VPN",
              description: "Telegram, Vapi, and Tailscale are guided into place.",
            },
            {
              title: "Defaults already filled",
              description: "Less blank config, less guesswork, faster first run.",
            },
          ],
        },
        {
          title: "Teams already included",
          description: "No extra setup before the work starts.",
          points: [
            {
              title: "Vibe coder team",
              description: "Build, code, and shipping help are already bundled.",
            },
            {
              title: "Design studio",
              description: "Creative work, assets, and interface polish are included.",
            },
            {
              title: "Life and business teams",
              description: "Personal improvement and business development are ready too.",
            },
          ],
        },
        {
          title: "Readable operator dashboards",
          description: "Agent actions and monitoring stay understandable.",
          points: [
            {
              title: "MauOffice included",
              description: "A friendlier operating view is already there.",
            },
            {
              title: "Actions stay visible",
              description: "See what ran, what changed, and what needs attention.",
            },
            {
              title: "Less log hunting",
              description: "The dashboard helps explain the system in plain view.",
            },
          ],
        },
        {
          title: "Shared memory and users",
          description: "Multiple users and groups can keep context together.",
          points: [
            {
              title: "Separate users",
              description: "Different people can keep their own context clean.",
            },
            {
              title: "Shared groups",
              description: "Memories can be shared when a group should remember together.",
            },
            {
              title: "Memory layer underneath",
              description: "Backed by QMD and Lossless Claw.",
            },
          ],
        },
        {
          title: "Personal use first",
          description: "It assumes real life, not just desk-bound demos.",
          points: [
            {
              title: "Call-based access",
              description: "Telephony helps when you are away from the keyboard.",
            },
            {
              title: "Non-digital follow-through",
              description: "It can reach actions that do not happen only on a screen.",
            },
            {
              title: "Personal use posture",
              description: "Daily life is treated as a first-class use case.",
            },
          ],
        },
        {
          title: "Structured agent teams",
          description: "One main agent coordinates mini teams and subagents.",
          points: [
            {
              title: "Main agent orchestration",
              description: "Coordination stays centered instead of scattered.",
            },
            {
              title: "Mini teams and subagents",
              description: "Specialists are grouped by job instead of left loose.",
            },
            {
              title: "OpenProse workflow",
              description: "The working flow is already defined under the hood.",
            },
          ],
        },
      ],
      startSteps: [
        {
          title: "Get your model account ready",
          description:
            "Sign up for an LLM account or get an API key. The recommended path is OpenAI with ChatGPT.",
        },
        {
          title: "Set up a channel bot",
          description:
            "Connect a messaging channel so Maumau can meet you somewhere familiar. Telegram is the recommended first channel.",
        },
        {
          title: "Install Tailscale on your devices",
          description:
            "Download Tailscale and sign in on your Mac and phone. It makes links generated by the system much easier to open from mobile.",
        },
        {
          title: "Set up Vapi for calling",
          description:
            "Add Vapi so Maumau can handle actions that work better over a call, not only in chat.",
        },
        {
          title: "Download the app and follow along",
          description:
            "Download the macOS app, run it, and keep going inside the guided setup. Maumau walks you through the remaining steps in order.",
        },
      ],
    },
    zh: {
      title: "Maumau | 下载与设置",
      metaDescription:
        "Maumau 的精致落地页，涵盖引导式设置、多语言运行、电话自动化、专业团队以及可下载的 macOS 应用。",
      text: {
        brand_eyebrow: "Maumau 应用",
        brand_sub: "下载、设置并管理。",
        nav_landing: "首页",
        nav_guide: "控制面板指南",
        nav_download: "下载 macOS 应用",
        hero_kicker: "从安装到第一次真实运行的引导",
        hero_lede: "个人 AI 团队",
        hero_download: "下载适用于 macOS 的 Maumau",
        hero_guide: "打开运营控制面板指南",
        hero_panel_topline: "最新 macOS 安装包已就绪",
        hero_pocket_setup_title: "引导式设置",
        hero_pocket_setup_desc: "安装、连接、完成入门。",
        hero_pocket_voice_title: "语音就绪",
        hero_pocket_voice_desc: "电话、语音与默认设置已准备好。",
        hero_pocket_teams_title: "专业团队",
        hero_pocket_teams_desc: "构建、设计、业务与生活支持。",
        why_kicker: "为什么选 Maumau",
        why_title: "不被配置疲劳拖住，直接跑起来。",
        why_desc: "先做引导式入门。默认值先帮你填好。团队、记忆和仪表板一开始就在系统里。",
        start_kicker: "如何开始",
        start_title: "五步开始第一次运行。",
        start_desc: "先把账户和连接准备好，再下载 Maumau，并在应用里跟着引导继续。",
        story_kicker: "生活本来就发生在聊天里",
        story_title: "留在大家本来就在说话的地方。",
        story_desc: "WhatsApp、Telegram、Slack、Discord、Matrix、Teams、iMessage 等等。",
        story_point1_title: "轻量收件箱",
        story_point1_desc: "上手快，界面也熟悉。",
        story_point2_title: "深入仪表板",
        story_point2_desc: "需要全局视图时，也能看到完整上下文。",
        mock_label: "Maumau 聊天示意",
        mock_badge: "品牌安全示意",
        mock_status: "在线",
        mock_chat_1: "通话前先给我短版总结。",
        mock_chat_2: "好了，重点、优先级和下一步都准备好了。",
        mock_chat_3: "今晚也提醒我一下。",
        mock_chat_4: "已加入你的日程。",
        footer_note: "当前 Maumau 本地构建的落地页。",
        footer_landing: "首页",
        footer_guide: "控制面板指南",
        footer_download: "下载 macOS 应用",
      },
      featureCards: [
        {
          title: "引导式入门",
          description: "设置过程不需要你盯着终端。",
          points: [
            {
              title: "只问必要步骤",
              description: "它只问真正重要的内容，把其余部分保持安静。",
            },
            {
              title: "频道、通话、VPN",
              description: "Telegram、Vapi 和 Tailscale 都会被一步步带着接好。",
            },
            {
              title: "默认值先填好",
              description: "更少空白配置，更少猜测，更快到第一次运行。",
            },
          ],
        },
        {
          title: "团队已包含",
          description: "工作开始前不用再额外搭建。",
          points: [
            {
              title: "Vibe coder 团队",
              description: "构建、编码和交付支持已经打包好。",
            },
            {
              title: "设计工作室",
              description: "创意工作、素材和界面打磨都已包含。",
            },
            {
              title: "生活与业务团队",
              description: "个人成长和业务开发团队也已就位。",
            },
          ],
        },
        {
          title: "可读的运营仪表板",
          description: "代理动作和监控信息都更容易看懂。",
          points: [
            {
              title: "已包含 MauOffice",
              description: "更友好的运营视图已经在里面。",
            },
            {
              title: "动作清晰可见",
              description: "能看到跑了什么、改了什么、还需要注意什么。",
            },
            {
              title: "更少翻日志",
              description: "仪表板会用更直观的方式解释系统正在做什么。",
            },
          ],
        },
        {
          title: "共享记忆与用户",
          description: "多个用户和用户组可以一起保持上下文。",
          points: [
            {
              title: "独立用户",
              description: "不同的人可以保持各自清晰的上下文。",
            },
            {
              title: "共享群组",
              description: "当一个群组需要共同记住事情时，记忆可以共享。",
            },
            {
              title: "底层记忆层",
              description: "由 QMD 和 Lossless Claw 提供支持。",
            },
          ],
        },
        {
          title: "先面向个人使用",
          description: "它默认你是在真实生活里使用，而不只是桌面演示。",
          points: [
            {
              title: "可通过通话访问",
              description: "离开键盘时，电话能力仍然能帮你继续做事。",
            },
            {
              title: "延伸到非数字动作",
              description: "它也能触达到不只发生在屏幕里的行动。",
            },
            {
              title: "个人使用姿态",
              description: "日常生活被当作一等使用场景来设计。",
            },
          ],
        },
        {
          title: "结构化代理团队",
          description: "一个主代理统筹小团队和子代理。",
          points: [
            {
              title: "主代理编排",
              description: "协调集中在一起，而不是四散分裂。",
            },
            {
              title: "小团队与子代理",
              description: "专家按工作分组，而不是随意散放。",
            },
            {
              title: "OpenProse 工作流",
              description: "底层工作流程已经预先定义好。",
            },
          ],
        },
      ],
      startSteps: [
        {
          title: "先准备模型账户",
          description: "注册一个 LLM 账户或拿到 API key。推荐路径是 OpenAI 和 ChatGPT。",
        },
        {
          title: "设置频道机器人",
          description: "先接上一个消息频道，让 Maumau 在你熟悉的地方出现。推荐先从 Telegram 开始。",
        },
        {
          title: "在设备上安装 Tailscale",
          description: "在你的 Mac 和手机上下载并登录 Tailscale。这样系统生成的链接会更容易在手机上打开。",
        },
        {
          title: "为通话设置 Vapi",
          description: "接上 Vapi，让 Maumau 也能处理那些更适合通过电话完成的动作。",
        },
        {
          title: "下载应用并跟着走",
          description: "下载 macOS 应用，运行它，然后继续跟着应用里的引导走。Maumau 会按顺序带你完成剩下的步骤。",
        },
      ],
    },
    id: {
      title: "Maumau | Unduh dan siapkan",
      metaDescription:
        "Halaman landing Maumau dengan setup terpandu, operasi multibahasa, otomatisasi telepon, tim spesialis, dan aplikasi macOS yang bisa diunduh.",
      text: {
        brand_eyebrow: "Aplikasi Maumau",
        brand_sub: "Unduh, siapkan, dan kendalikan.",
        nav_landing: "Landing",
        nav_guide: "Panduan dashboard",
        nav_download: "Unduh aplikasi macOS",
        hero_kicker: "Dipandu dari instalasi sampai run pertama yang nyata",
        hero_lede: "Tim AI pribadi",
        hero_download: "Unduh Maumau untuk macOS",
        hero_guide: "Buka panduan operations dashboard",
        hero_panel_topline: "Installer macOS terbaru siap",
        hero_pocket_setup_title: "Setup terpandu",
        hero_pocket_setup_desc: "Instal, hubungkan, mulai.",
        hero_pocket_voice_title: "Siap suara",
        hero_pocket_voice_desc: "Telepon, speech, dan default suara siap.",
        hero_pocket_teams_title: "Tim spesialis",
        hero_pocket_teams_desc: "Build, design, bisnis, dan hidup.",
        why_kicker: "Kenapa Maumau",
        why_title: "Sampai ke run nyata tanpa lelah di setup.",
        why_desc:
          "Onboarding terpandu lebih dulu. Default sudah diisi. Tim, memory, dan dashboard sudah menjadi bagian dari sistem.",
        start_kicker: "Cara memulai",
        start_title: "Lima langkah ke run pertamamu.",
        start_desc:
          "Siapkan akun dan koneksinya sekali, lalu unduh Maumau dan ikuti panduan di dalam aplikasi.",
        story_kicker: "Hidup memang sudah terjadi di chat",
        story_title: "Tinggal di tempat orang memang sudah bicara.",
        story_desc: "WhatsApp, Telegram, Slack, Discord, Matrix, Teams, iMessage, dan lainnya.",
        story_point1_title: "Inbox ringan",
        story_point1_desc: "Sentuhan cepat. Permukaan yang familiar.",
        story_point2_title: "Dashboard yang dalam",
        story_point2_desc: "Konteks penuh saat kamu butuh gambaran operasionalnya.",
        mock_label: "Mock chat Maumau",
        mock_badge: "Mock aman untuk brand",
        mock_status: "online",
        mock_chat_1: "Aku butuh versi singkat sebelum telepon.",
        mock_chat_2: "Siap. Catatan, prioritas, dan langkah berikutnya sudah ada.",
        mock_chat_3: "Sekalian ingatkan aku malam ini.",
        mock_chat_4: "Sudah masuk ke routine kamu.",
        footer_note: "Landing page untuk build lokal Maumau saat ini.",
        footer_landing: "Landing",
        footer_guide: "Panduan dashboard",
        footer_download: "Unduh aplikasi macOS",
      },
      featureCards: [
        {
          title: "Onboarding terpandu",
          description: "Setup tidak hidup di terminal.",
          points: [
            {
              title: "Hanya langkah yang perlu",
              description: "Ia hanya menanyakan yang penting dan membiarkan sisanya tenang.",
            },
            {
              title: "Channel, panggilan, VPN",
              description: "Telegram, Vapi, dan Tailscale dipandu sampai terpasang.",
            },
            {
              title: "Default sudah terisi",
              description: "Lebih sedikit config kosong, lebih sedikit tebak-tebakan, lebih cepat ke run pertama.",
            },
          ],
        },
        {
          title: "Tim sudah termasuk",
          description: "Tidak perlu setup tambahan sebelum kerja dimulai.",
          points: [
            {
              title: "Tim vibe coder",
              description: "Bantuan build, coding, dan shipping sudah dibundel.",
            },
            {
              title: "Design studio",
              description: "Kerja kreatif, aset, dan polesan antarmuka sudah tersedia.",
            },
            {
              title: "Tim life dan business",
              description: "Peningkatan hidup dan pengembangan bisnis juga sudah siap.",
            },
          ],
        },
        {
          title: "Dashboard operator yang mudah dibaca",
          description: "Aksi agen dan monitoring tetap mudah dipahami.",
          points: [
            {
              title: "MauOffice sudah ada",
              description: "Tampilan operasional yang lebih ramah sudah tersedia.",
            },
            {
              title: "Aksi tetap terlihat",
              description: "Lihat apa yang jalan, apa yang berubah, dan apa yang butuh perhatian.",
            },
            {
              title: "Lebih sedikit berburu log",
              description: "Dashboard membantu menjelaskan sistem dalam tampilan yang jelas.",
            },
          ],
        },
        {
          title: "Memory dan pengguna bersama",
          description: "Banyak pengguna dan grup bisa menjaga konteks bersama.",
          points: [
            {
              title: "Pengguna terpisah",
              description: "Orang yang berbeda bisa menjaga konteks masing-masing tetap rapi.",
            },
            {
              title: "Grup bersama",
              description: "Memory bisa dibagikan saat sebuah grup perlu mengingat bersama.",
            },
            {
              title: "Lapisan memory di bawah",
              description: "Didukung oleh QMD dan Lossless Claw.",
            },
          ],
        },
        {
          title: "Personal use lebih dulu",
          description: "Ia mengasumsikan hidup nyata, bukan hanya demo di meja kerja.",
          points: [
            {
              title: "Akses berbasis panggilan",
              description: "Telephony membantu saat kamu sedang jauh dari keyboard.",
            },
            {
              title: "Tindak lanjut non-digital",
              description: "Ia bisa menjangkau tindakan yang tidak hanya terjadi di layar.",
            },
            {
              title: "Sikap personal use",
              description: "Kehidupan sehari-hari diperlakukan sebagai use case utama.",
            },
          ],
        },
        {
          title: "Tim agen yang terstruktur",
          description: "Satu agen utama mengoordinasikan mini team dan subagent.",
          points: [
            {
              title: "Orkestrasi agen utama",
              description: "Koordinasi tetap terpusat, tidak tercecer.",
            },
            {
              title: "Mini team dan subagent",
              description: "Spesialis dikelompokkan berdasarkan pekerjaan, bukan dibiarkan lepas.",
            },
            {
              title: "Workflow OpenProse",
              description: "Alur kerja dasarnya sudah didefinisikan di bawah.",
            },
          ],
        },
      ],
      startSteps: [
        {
          title: "Siapkan akun model dulu",
          description:
            "Daftar akun LLM atau ambil API key. Jalur yang direkomendasikan adalah OpenAI dengan ChatGPT.",
        },
        {
          title: "Setel bot channel",
          description:
            "Hubungkan channel pesan supaya Maumau bisa menemuimu di tempat yang familiar. Telegram adalah channel pertama yang direkomendasikan.",
        },
        {
          title: "Pasang Tailscale di perangkatmu",
          description:
            "Unduh Tailscale dan masuk di Mac dan ponselmu. Ini membuat tautan yang dibuat sistem jauh lebih mudah dibuka dari ponsel.",
        },
        {
          title: "Siapkan Vapi untuk panggilan",
          description:
            "Tambahkan Vapi supaya Maumau juga bisa menangani tindakan yang lebih cocok dilakukan lewat panggilan, bukan hanya chat.",
        },
        {
          title: "Unduh aplikasinya lalu ikuti",
          description:
            "Unduh aplikasi macOS, jalankan, lalu lanjutkan setup terpandu di dalamnya. Maumau akan membawamu melewati langkah sisanya dengan urut.",
        },
      ],
    },
    ms: {
      title: "Maumau | Muat turun dan sediakan",
      metaDescription:
        "Halaman landing Maumau dengan persediaan berpandu, operasi berbilang bahasa, automasi telefon, pasukan pakar, dan aplikasi macOS yang boleh dimuat turun.",
      text: {
        brand_eyebrow: "Aplikasi Maumau",
        brand_sub: "Muat turun, sediakan, dan kawal.",
        nav_landing: "Landing",
        nav_guide: "Panduan dashboard",
        nav_download: "Muat turun aplikasi macOS",
        hero_kicker: "Dipandu dari pemasangan ke run pertama yang sebenar",
        hero_lede: "Pasukan AI peribadi",
        hero_download: "Muat turun Maumau untuk macOS",
        hero_guide: "Buka panduan operations dashboard",
        hero_panel_topline: "Pemasang macOS terbaru sedia",
        hero_pocket_setup_title: "Persediaan berpandu",
        hero_pocket_setup_desc: "Pasang, sambung, mula.",
        hero_pocket_voice_title: "Sedia suara",
        hero_pocket_voice_desc: "Telefon, speech, dan default suara sudah sedia.",
        hero_pocket_teams_title: "Pasukan pakar",
        hero_pocket_teams_desc: "Build, design, bisnes, dan hidup.",
        why_kicker: "Kenapa Maumau",
        why_title: "Sampai ke run sebenar tanpa penat dengan setup.",
        why_desc:
          "Onboarding berpandu dahulu. Default sudah diisi. Pasukan, memory, dan dashboard sudah menjadi sebahagian daripada sistem.",
        start_kicker: "Cara bermula",
        start_title: "Lima langkah ke run pertama anda.",
        start_desc:
          "Sediakan akaun dan sambungan sekali, kemudian muat turun Maumau dan ikut panduan di dalam aplikasi.",
        story_kicker: "Hidup memang sudah berlaku dalam chat",
        story_title: "Kekal di tempat orang memang sudah bercakap.",
        story_desc: "WhatsApp, Telegram, Slack, Discord, Matrix, Teams, iMessage, dan lain-lain.",
        story_point1_title: "Inbox ringan",
        story_point1_desc: "Sentuhan cepat. Permukaan yang biasa.",
        story_point2_title: "Dashboard mendalam",
        story_point2_desc: "Konteks penuh bila anda perlukan gambaran operasi.",
        mock_label: "Mock chat Maumau",
        mock_badge: "Mock selamat untuk jenama",
        mock_status: "online",
        mock_chat_1: "Saya perlukan versi ringkas sebelum panggilan.",
        mock_chat_2: "Siap. Nota, keutamaan, dan langkah seterusnya sudah tersedia.",
        mock_chat_3: "Sekali, ingatkan saya malam ini.",
        mock_chat_4: "Sudah ditambah ke routine anda.",
        footer_note: "Landing page untuk build tempatan Maumau semasa.",
        footer_landing: "Landing",
        footer_guide: "Panduan dashboard",
        footer_download: "Muat turun aplikasi macOS",
      },
      featureCards: [
        {
          title: "Onboarding berpandu",
          description: "Setup tidak perlu hidup dalam terminal.",
          points: [
            {
              title: "Hanya langkah yang perlu",
              description: "Ia hanya bertanya perkara penting dan membiarkan yang lain tenang.",
            },
            {
              title: "Saluran, panggilan, VPN",
              description: "Telegram, Vapi, dan Tailscale dipandu hingga siap.",
            },
            {
              title: "Default sudah diisi",
              description: "Kurang config kosong, kurang meneka, lebih cepat ke run pertama.",
            },
          ],
        },
        {
          title: "Pasukan sudah termasuk",
          description: "Tiada setup tambahan sebelum kerja bermula.",
          points: [
            {
              title: "Pasukan vibe coder",
              description: "Bantuan build, coding, dan shipping sudah dibundel.",
            },
            {
              title: "Design studio",
              description: "Kerja kreatif, aset, dan kemasan antara muka sudah tersedia.",
            },
            {
              title: "Pasukan life dan business",
              description: "Peningkatan hidup dan pembangunan bisnes juga sudah siap.",
            },
          ],
        },
        {
          title: "Dashboard operator yang mudah dibaca",
          description: "Tindakan agen dan pemantauan kekal mudah difahami.",
          points: [
            {
              title: "MauOffice sudah ada",
              description: "Paparan operasi yang lebih mesra sudah tersedia.",
            },
            {
              title: "Tindakan kekal kelihatan",
              description: "Lihat apa yang berjalan, apa yang berubah, dan apa yang perlukan perhatian.",
            },
            {
              title: "Kurang memburu log",
              description: "Dashboard membantu menerangkan sistem dalam paparan yang jelas.",
            },
          ],
        },
        {
          title: "Memory dan pengguna bersama",
          description: "Ramai pengguna dan kumpulan boleh berkongsi konteks bersama.",
          points: [
            {
              title: "Pengguna berasingan",
              description: "Orang yang berbeza boleh menjaga konteks masing-masing dengan kemas.",
            },
            {
              title: "Kumpulan bersama",
              description: "Memory boleh dikongsi apabila satu kumpulan perlu mengingati bersama.",
            },
            {
              title: "Lapisan memory di bawah",
              description: "Disokong oleh QMD dan Lossless Claw.",
            },
          ],
        },
        {
          title: "Personal use didahulukan",
          description: "Ia menganggap kehidupan sebenar, bukan sekadar demo di meja.",
          points: [
            {
              title: "Akses berasaskan panggilan",
              description: "Telephony membantu apabila anda jauh dari papan kekunci.",
            },
            {
              title: "Susulan bukan digital",
              description: "Ia boleh menjangkau tindakan yang tidak berlaku hanya di skrin.",
            },
            {
              title: "Pendekatan personal use",
              description: "Kehidupan harian dianggap sebagai use case utama.",
            },
          ],
        },
        {
          title: "Pasukan agen berstruktur",
          description: "Satu agen utama menyelaras mini team dan subagent.",
          points: [
            {
              title: "Orkestrasi agen utama",
              description: "Penyelarasan kekal berpusat, bukan bertaburan.",
            },
            {
              title: "Mini team dan subagent",
              description: "Pakar dikumpulkan ikut kerja, bukan dibiarkan berselerak.",
            },
            {
              title: "Workflow OpenProse",
              description: "Aliran kerja asasnya sudah ditentukan di bawah.",
            },
          ],
        },
      ],
      startSteps: [
        {
          title: "Sediakan akaun model dahulu",
          description:
            "Daftar akaun LLM atau dapatkan API key. Laluan yang disyorkan ialah OpenAI dengan ChatGPT.",
        },
        {
          title: "Sediakan bot saluran",
          description:
            "Sambungkan saluran mesej supaya Maumau boleh menemui anda di tempat yang biasa. Telegram ialah saluran pertama yang disyorkan.",
        },
        {
          title: "Pasang Tailscale pada peranti anda",
          description:
            "Muat turun Tailscale dan log masuk pada Mac dan telefon anda. Ini menjadikan pautan yang dijana sistem lebih mudah dibuka dari telefon.",
        },
        {
          title: "Sediakan Vapi untuk panggilan",
          description:
            "Tambahkan Vapi supaya Maumau juga boleh mengendalikan tindakan yang lebih sesuai dibuat melalui panggilan, bukan chat sahaja.",
        },
        {
          title: "Muat turun aplikasi dan ikut panduan",
          description:
            "Muat turun aplikasi macOS, jalankan, dan teruskan di dalam setup berpandu. Maumau akan membawa anda melalui langkah selebihnya mengikut turutan.",
        },
      ],
    },
    th: {
      title: "Maumau | ดาวน์โหลดและตั้งค่า",
      metaDescription:
        "หน้าแลนดิ้งของ Maumau พร้อมการตั้งค่าแบบมีไกด์ การทำงานหลายภาษา ระบบโทรศัพท์อัตโนมัติ ทีมเฉพาะทาง และแอป macOS ที่ดาวน์โหลดได้",
      text: {
        brand_eyebrow: "แอป Maumau",
        brand_sub: "ดาวน์โหลด ตั้งค่า และควบคุมได้ง่าย",
        nav_landing: "หน้าแรก",
        nav_guide: "คู่มือแดชบอร์ด",
        nav_download: "ดาวน์โหลดแอป macOS",
        hero_kicker: "มีไกด์ตั้งแต่ติดตั้งจนถึงการรันจริงครั้งแรก",
        hero_lede: "ทีม AI ส่วนตัว",
        hero_download: "ดาวน์โหลด Maumau สำหรับ macOS",
        hero_guide: "เปิดคู่มือ operations dashboard",
        hero_panel_topline: "ตัวติดตั้ง macOS ล่าสุดพร้อมแล้ว",
        hero_pocket_setup_title: "ตั้งค่าแบบมีไกด์",
        hero_pocket_setup_desc: "ติดตั้ง เชื่อมต่อ แล้วเริ่มได้เลย",
        hero_pocket_voice_title: "พร้อมใช้เสียง",
        hero_pocket_voice_desc: "โทรศัพท์ speech และค่าพื้นฐานด้านเสียงพร้อมแล้ว",
        hero_pocket_teams_title: "ทีมเฉพาะทาง",
        hero_pocket_teams_desc: "งานสร้างสรรค์ ออกแบบ ธุรกิจ และชีวิตประจำวัน",
        why_kicker: "ทำไมต้อง Maumau",
        why_title: "ไปถึงการรันจริงได้โดยไม่หมดแรงกับการตั้งค่า",
        why_desc:
          "เริ่มจาก onboarding แบบมีไกด์ ค่าเริ่มต้นถูกกรอกไว้แล้ว ทีม memory และแดชบอร์ดอยู่ในระบบตั้งแต่ต้น",
        start_kicker: "เริ่มอย่างไร",
        start_title: "ห้าขั้นสู่การรันครั้งแรกของคุณ",
        start_desc: "ตั้งค่าบัญชีและการเชื่อมต่อครั้งเดียว จากนั้นดาวน์โหลด Maumau แล้วทำตามไกด์ในแอป",
        story_kicker: "ชีวิตจริงเกิดขึ้นในแชตอยู่แล้ว",
        story_title: "อยู่ในที่ที่คนคุยกันอยู่แล้ว",
        story_desc: "WhatsApp, Telegram, Slack, Discord, Matrix, Teams, iMessage และอีกมากมาย",
        story_point1_title: "กล่องข้อความเบา",
        story_point1_desc: "แตะเร็ว ใช้งานบนพื้นผิวที่คุ้นเคย",
        story_point2_title: "แดชบอร์ดลึกพอ",
        story_point2_desc: "เห็นบริบทครบเมื่อคุณต้องการภาพการทำงานทั้งหมด",
        mock_label: "ตัวอย่างแชต Maumau",
        mock_badge: "ตัวอย่างที่ปลอดภัยต่อแบรนด์",
        mock_status: "ออนไลน์",
        mock_chat_1: "ขอเวอร์ชันสั้นก่อนโทรได้ไหม",
        mock_chat_2: "ได้แล้ว ทั้งโน้ต ลำดับความสำคัญ และขั้นตอนถัดไปพร้อมแล้ว",
        mock_chat_3: "คืนนี้ช่วยเตือนฉันด้วย",
        mock_chat_4: "เพิ่มเข้า routine ให้แล้ว",
        footer_note: "หน้าแลนดิ้งสำหรับบิลด์โลคัลของ Maumau ในตอนนี้",
        footer_landing: "หน้าแรก",
        footer_guide: "คู่มือแดชบอร์ด",
        footer_download: "ดาวน์โหลดแอป macOS",
      },
      featureCards: [
        {
          title: "Onboarding แบบมีไกด์",
          description: "การตั้งค่าไม่ต้องไปอยู่ในเทอร์มินัล",
          points: [
            {
              title: "ถามเฉพาะขั้นที่จำเป็น",
              description: "ระบบจะถามเฉพาะสิ่งที่สำคัญ และปล่อยส่วนที่เหลือให้เงียบไว้",
            },
            {
              title: "ช่องทาง โทร และ VPN",
              description: "Telegram, Vapi และ Tailscale ถูกพาเชื่อมต่อให้ทีละขั้น",
            },
            {
              title: "ค่าเริ่มต้นกรอกไว้แล้ว",
              description: "ช่อง config ว่างน้อยลง เดาน้อยลง ไปถึงการรันแรกได้เร็วขึ้น",
            },
          ],
        },
        {
          title: "มีทีมให้แล้ว",
          description: "ไม่ต้องตั้งค่าเพิ่มก่อนเริ่มงาน",
          points: [
            {
              title: "ทีม vibe coder",
              description: "มีตัวช่วยด้าน build การเขียนโค้ด และการส่งงานมาให้แล้ว",
            },
            {
              title: "สตูดิโอออกแบบ",
              description: "งานสร้างสรรค์ แอสเซ็ต และความเนี้ยบของหน้าจอมีพร้อม",
            },
            {
              title: "ทีมชีวิตและธุรกิจ",
              description: "ทีมพัฒนาชีวิตและพัฒนาธุรกิจก็พร้อมใช้งานเช่นกัน",
            },
          ],
        },
        {
          title: "แดชบอร์ดผู้ดูแลที่อ่านง่าย",
          description: "การกระทำของเอเจนต์และการมอนิเตอร์ยังเข้าใจได้ง่าย",
          points: [
            {
              title: "มี MauOffice อยู่แล้ว",
              description: "มีมุมมองการทำงานที่เป็นมิตรกว่าอยู่ในระบบแล้ว",
            },
            {
              title: "เห็นการกระทำได้ชัด",
              description: "รู้ว่าอะไรถูกรัน อะไรเปลี่ยน และอะไรต้องจับตา",
            },
            {
              title: "ตาม log น้อยลง",
              description: "แดชบอร์ดช่วยอธิบายระบบในมุมมองที่อ่านเข้าใจได้ทันที",
            },
          ],
        },
        {
          title: "memory และผู้ใช้ที่แชร์กันได้",
          description: "มีผู้ใช้หลายคนและหลายกลุ่มที่เก็บบริบทร่วมกันได้",
          points: [
            {
              title: "ผู้ใช้แยกกันได้",
              description: "แต่ละคนสามารถรักษาบริบทของตัวเองให้เป็นระเบียบได้",
            },
            {
              title: "กลุ่มแชร์ร่วมกัน",
              description: "memory สามารถแชร์กันได้เมื่อทั้งกลุ่มต้องจำเรื่องเดียวกัน",
            },
            {
              title: "ชั้น memory ด้านล่าง",
              description: "ทำงานอยู่บน QMD และ Lossless Claw",
            },
          ],
        },
        {
          title: "ออกแบบมาสำหรับใช้ส่วนตัวก่อน",
          description: "สมมติฐานคือการใช้ในชีวิตจริง ไม่ใช่แค่เดโมบนโต๊ะ",
          points: [
            {
              title: "เข้าถึงผ่านการโทร",
              description: "ระบบโทรช่วยได้เมื่อคุณไม่ได้อยู่หน้าแป้นพิมพ์",
            },
            {
              title: "ต่อไปถึงงานนอกจอ",
              description: "มันช่วยแตะงานที่ไม่ได้เกิดขึ้นบนหน้าจออย่างเดียวได้",
            },
            {
              title: "มุมมองแบบใช้ส่วนตัว",
              description: "ชีวิตประจำวันถูกมองเป็น use case หลักตั้งแต่ต้น",
            },
          ],
        },
        {
          title: "ทีมเอเจนต์ที่มีโครงสร้าง",
          description: "เอเจนต์หลักหนึ่งตัวประสาน mini team และ subagent",
          points: [
            {
              title: "การออร์เคสตราโดยเอเจนต์หลัก",
              description: "การประสานงานอยู่รวมศูนย์ ไม่กระจัดกระจาย",
            },
            {
              title: "mini team และ subagent",
              description: "ผู้เชี่ยวชาญถูกจัดเป็นทีมตามงาน ไม่ปล่อยลอยๆ",
            },
            {
              title: "workflow ของ OpenProse",
              description: "ลำดับการทำงานด้านล่างถูกกำหนดไว้แล้ว",
            },
          ],
        },
      ],
      startSteps: [
        {
          title: "เตรียมบัญชีโมเดลของคุณ",
          description:
            "สมัครบัญชี LLM หรือรับ API key มาก่อน เส้นทางที่แนะนำคือ OpenAI กับ ChatGPT",
        },
        {
          title: "ตั้งค่าบอตช่องทาง",
          description:
            "เชื่อมช่องทางส่งข้อความเพื่อให้ Maumau ไปอยู่ในที่ที่คุณคุ้นเคย โดยแนะนำให้เริ่มจาก Telegram",
        },
        {
          title: "ติดตั้ง Tailscale บนอุปกรณ์ของคุณ",
          description:
            "ดาวน์โหลด Tailscale และล็อกอินทั้งบน Mac และโทรศัพท์ของคุณ เพื่อให้ลิงก์ที่ระบบสร้างเปิดจากมือถือได้ง่ายขึ้นมาก",
        },
        {
          title: "ตั้งค่า Vapi สำหรับการโทร",
          description:
            "เพิ่ม Vapi เพื่อให้ Maumau ทำงานที่เหมาะกับการโทรได้ ไม่ได้จำกัดอยู่แค่ในแชต",
        },
        {
          title: "ดาวน์โหลดแอปแล้วทำตามไกด์",
          description:
            "ดาวน์โหลดแอป macOS เปิดใช้งาน แล้วเดินต่อในขั้นตอนแบบมีไกด์ภายในแอป Maumau จะพาคุณผ่านขั้นที่เหลือตามลำดับ",
        },
      ],
    },
    vi: {
      title: "Maumau | Tai ve va thiet lap",
      metaDescription:
        "Trang landing cua Maumau voi cai dat co huong dan, van hanh da ngon ngu, tu dong hoa dien thoai, cac doi chuyen biet, va ung dung macOS co the tai xuong.",
      text: {
        brand_eyebrow: "Ung dung Maumau",
        brand_sub: "Tai ve, thiet lap, va dieu khien.",
        nav_landing: "Trang chu",
        nav_guide: "Huong dan dashboard",
        nav_download: "Tai ung dung macOS",
        hero_kicker: "Duoc huong dan tu luc cai dat den lan chay that dau tien",
        hero_lede: "Doi AI ca nhan",
        hero_download: "Tai Maumau cho macOS",
        hero_guide: "Mo huong dan operations dashboard",
        hero_panel_topline: "Bo cai macOS moi nhat da san sang",
        hero_pocket_setup_title: "Thiet lap co huong dan",
        hero_pocket_setup_desc: "Cai dat, ket noi, bat dau.",
        hero_pocket_voice_title: "San sang cho giong noi",
        hero_pocket_voice_desc: "Dien thoai, speech, va mac dinh giong noi da san sang.",
        hero_pocket_teams_title: "Cac doi chuyen biet",
        hero_pocket_teams_desc: "Build, design, kinh doanh, va doi song.",
        why_kicker: "Vi sao la Maumau",
        why_title: "Di den lan chay that ma khong met vi setup.",
        why_desc:
          "Onboarding co huong dan truoc. Mac dinh da duoc dien san. Doi, memory, va dashboard da nam trong he thong ngay tu dau.",
        start_kicker: "Bat dau nhu the nao",
        start_title: "Nam buoc den lan chay dau tien cua ban.",
        start_desc:
          "Chuan bi tai khoan va cac ket noi mot lan, sau do tai Maumau va lam theo huong dan ben trong ung dung.",
        story_kicker: "Cuoc song da dien ra trong chat",
        story_title: "O lai noi moi nguoi da noi chuyen.",
        story_desc: "WhatsApp, Telegram, Slack, Discord, Matrix, Teams, iMessage, va hon the nua.",
        story_point1_title: "Hop thu nhe",
        story_point1_desc: "Cham nhanh. Giao dien quen thuoc.",
        story_point2_title: "Dashboard sau hon",
        story_point2_desc: "Day du boi canh khi ban can buc tranh van hanh.",
        mock_label: "Mau chat Maumau",
        mock_badge: "Mau an toan cho thuong hieu",
        mock_status: "truc tuyen",
        mock_chat_1: "Toi can ban tom tat ngan truoc cuoc goi.",
        mock_chat_2: "Xong roi. Ghi chu, uu tien, va buoc tiep theo da san sang.",
        mock_chat_3: "Nho nhac toi toi nay nua nhe.",
        mock_chat_4: "Da them vao routine cua ban.",
        footer_note: "Trang landing cho ban build Maumau cuc bo hien tai.",
        footer_landing: "Trang chu",
        footer_guide: "Huong dan dashboard",
        footer_download: "Tai ung dung macOS",
      },
      featureCards: [
        {
          title: "Onboarding co huong dan",
          description: "Qua trinh setup khong nam trong terminal.",
          points: [
            {
              title: "Chi hoi cac buoc can thiet",
              description: "He thong chi hoi dieu quan trong va de phan con lai yen tinh.",
            },
            {
              title: "Kenh, cuoc goi, VPN",
              description: "Telegram, Vapi, va Tailscale duoc huong dan tung buoc de ket noi.",
            },
            {
              title: "Mac dinh da duoc dien san",
              description: "It config trong hon, it phai doan hon, den lan chay dau tien nhanh hon.",
            },
          ],
        },
        {
          title: "Da co san cac doi",
          description: "Khong can setup them truoc khi cong viec bat dau.",
          points: [
            {
              title: "Doi vibe coder",
              description: "Ho tro build, code, va shipping da duoc dong goi san.",
            },
            {
              title: "Design studio",
              description: "Cong viec sang tao, tai san, va do chau chuot giao dien da co san.",
            },
            {
              title: "Doi doi song va kinh doanh",
              description: "Ca cai thien doi song va phat trien kinh doanh deu da san sang.",
            },
          ],
        },
        {
          title: "Dashboard van hanh de doc",
          description: "Hanh dong cua agent va monitoring van de hieu.",
          points: [
            {
              title: "Da co MauOffice",
              description: "Mot goc nhin van hanh than thien hon da nam san trong he thong.",
            },
            {
              title: "Hanh dong hien ro",
              description: "Thay duoc dieu gi da chay, dieu gi da doi, va dieu gi can chu y.",
            },
            {
              title: "Bam log it hon",
              description: "Dashboard giup giai thich he thong bang mot cach de nhin hon.",
            },
          ],
        },
        {
          title: "Memory va nguoi dung chia se",
          description: "Nhieu nguoi dung va nhieu nhom co the giu boi canh chung.",
          points: [
            {
              title: "Nguoi dung tach rieng",
              description: "Moi nguoi co the giu boi canh cua minh gon gang.",
            },
            {
              title: "Nhom chia se chung",
              description: "Memory co the duoc chia se khi mot nhom can nho cung nhau.",
            },
            {
              title: "Lop memory ben duoi",
              description: "Duoc ho tro boi QMD va Lossless Claw.",
            },
          ],
        },
        {
          title: "Uu tien dung ca nhan truoc",
          description: "He thong gia dinh ban dang dung cho doi song that, khong chi demo tren ban lam viec.",
          points: [
            {
              title: "Truy cap qua cuoc goi",
              description: "Telephony giup ban lam viec tiep khi dang khong ngoi truoc ban phim.",
            },
            {
              title: "Theo den hanh dong ngoai man hinh",
              description: "No co the cham den nhung viec khong chi xay ra tren man hinh.",
            },
            {
              title: "Tu the dung ca nhan",
              description: "Doi song hang ngay duoc xem la use case hang dau.",
            },
          ],
        },
        {
          title: "Doi agent co cau truc",
          description: "Mot agent chinh dieu phoi mini team va subagent.",
          points: [
            {
              title: "Dieu phoi boi agent chinh",
              description: "Su phoi hop duoc giu tap trung thay vi bi phan tan.",
            },
            {
              title: "Mini team va subagent",
              description: "Chuyen gia duoc nhom theo cong viec thay vi de roi rac.",
            },
            {
              title: "Workflow OpenProse",
              description: "Luong cong viec ben duoi da duoc dinh nghia san.",
            },
          ],
        },
      ],
      startSteps: [
        {
          title: "Chuan bi tai khoan model",
          description:
            "Dang ky mot tai khoan LLM hoac lay API key. Lo trinh duoc khuyen nghi la OpenAI voi ChatGPT.",
        },
        {
          title: "Thiet lap bot kenh",
          description:
            "Ket noi mot kenh nhan tin de Maumau co the gap ban o noi ban quen thuoc. Telegram la kenh dau tien duoc khuyen nghi.",
        },
        {
          title: "Cai Tailscale tren cac thiet bi cua ban",
          description:
            "Tai Tailscale va dang nhap tren Mac va dien thoai cua ban. Dieu nay giup cac lien ket do he thong tao ra mo tren di dong de dang hon nhieu.",
        },
        {
          title: "Thiet lap Vapi cho cuoc goi",
          description:
            "Them Vapi de Maumau co the xu ly nhung viec phu hop hon voi cuoc goi, khong chi chat.",
        },
        {
          title: "Tai ung dung va lam theo",
          description:
            "Tai ung dung macOS, chay no, roi tiep tuc voi setup co huong dan ben trong. Maumau se dua ban qua cac buoc con lai theo dung thu tu.",
        },
      ],
    },
    my: {
      title: "Maumau | Download and setup",
      metaDescription:
        "Maumau အတွက် လမ်းညွှန်ပါဝင်တဲ့ setup, ဘာသာစကားစုံ အသုံးပြုမှု, ဖုန်းခေါ်မှု အလိုအလျောက်လုပ်ဆောင်ချက်, specialist team တွေ, နှင့် download လုပ်နိုင်တဲ့ macOS app ပါဝင်တဲ့ landing page ဖြစ်ပါတယ်။",
      text: {
        brand_eyebrow: "Maumau app",
        brand_sub: "Download, setup, နဲ့ control လုပ်နိုင်ပါတယ်။",
        nav_landing: "ပင်မစာမျက်နှာ",
        nav_guide: "Dashboard guide",
        nav_download: "macOS app ကို download လုပ်မယ်",
        hero_kicker: "Install လုပ်တာကနေ ပထမဆုံး run တကယ်ဖြစ်လာတဲ့အထိ လမ်းညွှန်ထားတယ်",
        hero_lede: "ကိုယ်ပိုင် AI team",
        hero_download: "Maumau ကို macOS အတွက် download လုပ်မယ်",
        hero_guide: "Operations dashboard guide ကိုဖွင့်မယ်",
        hero_panel_topline: "နောက်ဆုံး macOS installer အဆင်သင့်",
        hero_pocket_setup_title: "Guided setup",
        hero_pocket_setup_desc: "Install, connect, onboard.",
        hero_pocket_voice_title: "Voice ready",
        hero_pocket_voice_desc: "ဖုန်း, speech, နဲ့ voice default တွေအဆင်သင့်။",
        hero_pocket_teams_title: "Specialist teams",
        hero_pocket_teams_desc: "Build, design, business, life.",
        why_kicker: "Maumau ကိုရွေးသင့်တဲ့အကြောင်း",
        why_title: "Setup နဲ့မပင်ပန်းဘဲ တကယ် run အထိရောက်နိုင်တယ်။",
        why_desc:
          "Guided onboarding ကအရင်လာတယ်။ Default တွေဖြည့်ပြီးသား။ Team, memory, နဲ့ dashboard တွေက system ထဲမှာ အစကတည်းက ရှိပြီးသား။",
        start_kicker: "ဘယ်လိုစမလဲ",
        start_title: "ပထမဆုံး run အတွက် အဆင့် ၅ ဆင့်",
        start_desc:
          "Account နဲ့ connection တွေကို တစ်ခါတည်းပြင်ပြီး Maumau ကို download လုပ်ပါ။ App ထဲက guide ကိုလိုက်ရင် ရပါပြီ။",
        story_kicker: "ဘဝက chat ထဲမှာပဲဖြစ်နေပြီးသား",
        story_title: "လူတွေပြောနေပြီးသားနေရာမှာပဲ နေလိုက်ပါ။",
        story_desc: "WhatsApp, Telegram, Slack, Discord, Matrix, Teams, iMessage နဲ့ အခြားနေရာတွေ။",
        story_point1_title: "Inbox light",
        story_point1_desc: "ထိရောက်မြန်ပြီး မျက်နှာပြင်လည်း ရင်းနှီးတယ်။",
        story_point2_title: "Dashboard deep",
        story_point2_desc: "လုပ်ဆောင်ပုံတစ်ခုလုံးကိုကြည့်ချင်တဲ့အချိန် အပြည့်အစုံ context ရတယ်။",
        mock_label: "Maumau chat mock",
        mock_badge: "Brand-safe mock",
        mock_status: "online",
        mock_chat_1: "ဖုန်းမခေါ်ခင် short version လိုတယ်။",
        mock_chat_2: "ရပြီ။ မှတ်စု၊ ဦးစားပေးချက်၊ နောက်တစ်ဆင့် အားလုံးအဆင်သင့်။",
        mock_chat_3: "ညကျရင်လည်း ကျွန်တော့်ကိုသတိပေးပေး။",
        mock_chat_4: "Routine ထဲထည့်ပြီးပြီ။",
        footer_note: "လက်ရှိ Maumau local build အတွက် landing page ဖြစ်ပါတယ်။",
        footer_landing: "ပင်မစာမျက်နှာ",
        footer_guide: "Dashboard guide",
        footer_download: "macOS app ကို download လုပ်မယ်",
      },
      featureCards: [
        {
          title: "Guided onboarding",
          description: "Setup ကို terminal ထဲမှာပဲ မထားဘူး။",
          points: [
            {
              title: "လိုအပ်တဲ့အဆင့်ပဲ မေးတယ်",
              description: "အရေးကြီးတာကိုပဲ မေးပြီး ကျန်တာတွေကို ငြိမ်ငြိမ်ထားတယ်။",
            },
            {
              title: "Channel, calls, VPN",
              description: "Telegram, Vapi, နဲ့ Tailscale ကို တစ်ဆင့်ချင်း guide လုပ်ပေးတယ်။",
            },
            {
              title: "Default တွေဖြည့်ပြီးသား",
              description: "Blank config နည်းလာတယ်၊ ခန့်မှန်းရတာနည်းလာတယ်၊ ပထမ run ပိုမြန်တယ်။",
            },
          ],
        },
        {
          title: "Team တွေပါပြီးသား",
          description: "အလုပ်စမယ့်အချိန်မှာ setup ထပ်မလုပ်ရတော့ဘူး။",
          points: [
            {
              title: "Vibe coder team",
              description: "Build, code, နဲ့ shipping အကူအညီတွေပါပြီးသား။",
            },
            {
              title: "Design studio",
              description: "Creative work, asset, နဲ့ interface polish တွေပါပြီးသား။",
            },
            {
              title: "Life and business teams",
              description: "ဘဝတိုးတက်ရေးနဲ့ business development team တွေလည်း အဆင်သင့်။",
            },
          ],
        },
        {
          title: "ဖတ်ရလွယ်တဲ့ operator dashboard",
          description: "Agent action နဲ့ monitoring ကို နားလည်လွယ်အောင်ထားတယ်။",
          points: [
            {
              title: "MauOffice ပါပြီးသား",
              description: "ပိုဖော်ရွေတဲ့ operation view ကို အစကတည်းကရပါတယ်။",
            },
            {
              title: "Action ကိုမြင်နေရတယ်",
              description: "ဘာ run သွားလဲ၊ ဘာပြောင်းလဲလဲ၊ ဘာကိုဂရုစိုက်ရမလဲ မြင်ရတယ်။",
            },
            {
              title: "Log လိုက်ရှာတာနည်းတယ်",
              description: "Dashboard က system ကို ပိုပြီးရှင်းလင်းမြင်သာအောင်ရှင်းပြတယ်။",
            },
          ],
        },
        {
          title: "Shared memory and users",
          description: "User အများအပြားနဲ့ group တွေက context ကိုမျှဝေနိုင်တယ်။",
          points: [
            {
              title: "User ခွဲထားနိုင်တယ်",
              description: "လူတစ်ယောက်ချင်းစီ context ကို သီးသန့်သေသပ်စွာထားနိုင်တယ်။",
            },
            {
              title: "Group နဲ့မျှဝေနိုင်တယ်",
              description: "Group တစ်ခုတည်းအတူမှတ်ထားဖို့လိုရင် memory ကိုမျှဝေနိုင်တယ်။",
            },
            {
              title: "အောက်ခံ memory layer",
              description: "QMD နဲ့ Lossless Claw က support ပေးထားတယ်။",
            },
          ],
        },
        {
          title: "Personal use ကိုအရင်ယူဆတယ်",
          description: "Desk demo မဟုတ်ဘဲ ဘဝတကယ်ထဲမှာသုံးမယ်လို့ယူဆထားတယ်။",
          points: [
            {
              title: "Call-based access",
              description: "Keyboard ကနေဝေးနေချိန်မှာလည်း telephony ကကူညီပေးတယ်။",
            },
            {
              title: "Non-digital follow-through",
              description: "Screen ထဲမှာပဲမပြီးတဲ့အလုပ်တွေဆီပါ ဆက်လုပ်နိုင်တယ်။",
            },
            {
              title: "Personal use posture",
              description: "နေ့စဉ်ဘဝကို အဓိက use case အဖြစ် ဆက်ဆံထားတယ်။",
            },
          ],
        },
        {
          title: "ဖွဲ့စည်းထားတဲ့ agent team",
          description: "Main agent တစ်ယောက်က mini team နဲ့ subagent တွေကို ညှိနှိုင်းတယ်။",
          points: [
            {
              title: "Main agent orchestration",
              description: "ညှိနှိုင်းမှုကို တစ်နေရာတည်းမှာ ထိန်းထားပြီး မပြန့်ကြဲဘူး။",
            },
            {
              title: "Mini teams and subagents",
              description: "Specialist တွေကို အလုပ်လိုက်စုထားပြီး လွှတ်မထားဘူး။",
            },
            {
              title: "OpenProse workflow",
              description: "အောက်ခံ workflow ကို ကြိုတင်သတ်မှတ်ထားပြီးသား။",
            },
          ],
        },
      ],
      startSteps: [
        {
          title: "Model account ကိုအရင်ပြင်ပါ",
          description:
            "LLM account တစ်ခုဖွင့်ပါ၊ ဒါမှမဟုတ် API key ယူပါ။ Recommended path က OpenAI နဲ့ ChatGPT ဖြစ်ပါတယ်။",
        },
        {
          title: "Channel bot ကို setup လုပ်ပါ",
          description:
            "Maumau က သင်ရင်းနှီးတဲ့နေရာမှာလာတွေ့နိုင်အောင် messaging channel တစ်ခုကို ချိတ်ပါ။ Recommended first channel က Telegram ဖြစ်ပါတယ်။",
        },
        {
          title: "Tailscale ကို device တွေမှာ install လုပ်ပါ",
          description:
            "Tailscale ကို download လုပ်ပြီး Mac နဲ့ phone မှာ sign in လုပ်ပါ။ System ကထုတ်ပေးတဲ့ link တွေကို ဖုန်းကနေဖွင့်ရတာ ပိုလွယ်စေပါတယ်။",
        },
        {
          title: "Calling အတွက် Vapi ကို setup လုပ်ပါ",
          description:
            "Vapi ကိုထည့်ပြီး Maumau က chat ပဲမဟုတ်ဘဲ call နဲ့ပိုသင့်တော်တဲ့ action တွေကိုလည်း ကိုင်တွယ်နိုင်အောင်လုပ်ပါ။",
        },
        {
          title: "App ကို download လုပ်ပြီး လိုက်လုပ်ပါ",
          description:
            "macOS app ကို download လုပ်၊ run လုပ်ပြီး guided setup ကိုဆက်လိုက်ပါ။ Maumau က ကျန်တဲ့အဆင့်တွေကို အစဉ်လိုက်လမ်းညွှန်ပေးပါလိမ့်မယ်။",
        },
      ],
    },
    fil: {
      title: "Maumau | I-download at i-set up",
      metaDescription:
        "Landing page ng Maumau na may guided setup, multilingual na paggamit, telephony automation, specialist teams, at macOS app na puwedeng i-download.",
      text: {
        brand_eyebrow: "Maumau app",
        brand_sub: "I-download, i-set up, at kontrolin.",
        nav_landing: "Landing",
        nav_guide: "Dashboard guide",
        nav_download: "I-download ang macOS app",
        hero_kicker: "May gabay mula install hanggang sa unang totoong run",
        hero_lede: "Personal na AI team",
        hero_download: "I-download ang Maumau para sa macOS",
        hero_guide: "Buksan ang operations dashboard guide",
        hero_panel_topline: "Handa na ang pinakabagong macOS installer",
        hero_pocket_setup_title: "Guided setup",
        hero_pocket_setup_desc: "Install, connect, onboarding.",
        hero_pocket_voice_title: "Handa sa voice",
        hero_pocket_voice_desc: "Telephony, speech, at voice defaults ay handa na.",
        hero_pocket_teams_title: "Specialist teams",
        hero_pocket_teams_desc: "Build, design, business, at life.",
        why_kicker: "Bakit Maumau",
        why_title: "Makakarating sa totoong run nang hindi nauubos sa setup.",
        why_desc:
          "Guided onboarding muna. Naka-fill na ang mga default. Kasama na agad sa system ang teams, memory, at dashboards.",
        start_kicker: "Paano magsimula",
        start_title: "Limang hakbang papunta sa unang run mo.",
        start_desc:
          "I-set up ang mga account at connection nang isang beses, tapos i-download ang Maumau at sundan ang gabay sa loob ng app.",
        story_kicker: "Nasa chat na talaga ang buhay",
        story_title: "Manatili kung saan nag-uusap na ang mga tao.",
        story_desc: "WhatsApp, Telegram, Slack, Discord, Matrix, Teams, iMessage, at iba pa.",
        story_point1_title: "Magaan na inbox",
        story_point1_desc: "Mabilis na galaw. Pamilyar na ibabaw.",
        story_point2_title: "Malalim na dashboard",
        story_point2_desc: "Buong konteksto kapag kailangan mo ang operating picture.",
        mock_label: "Mock chat ng Maumau",
        mock_badge: "Mock na ligtas sa brand",
        mock_status: "online",
        mock_chat_1: "Kailangan ko ang maikling bersyon bago ang tawag.",
        mock_chat_2: "Tapos na. Handa na ang notes, priorities, at susunod na hakbang.",
        mock_chat_3: "Paalalahanan mo rin ako mamayang gabi.",
        mock_chat_4: "Naidagdag na sa routine mo.",
        footer_note: "Landing page para sa kasalukuyang lokal na build ng Maumau.",
        footer_landing: "Landing",
        footer_guide: "Dashboard guide",
        footer_download: "I-download ang macOS app",
      },
      featureCards: [
        {
          title: "Guided onboarding",
          description: "Hindi nakatira ang setup sa terminal.",
          points: [
            {
              title: "Mga kailangang hakbang lang",
              description: "Ang tinatanong lang nito ay ang mahalaga at tahimik ang natitira.",
            },
            {
              title: "Channels, tawag, VPN",
              description: "Telegram, Vapi, at Tailscale ay ginagabayan hanggang maikabit.",
            },
            {
              title: "Nakapuno na ang defaults",
              description: "Mas kaunting blank config, mas kaunting hula, mas mabilis sa unang run.",
            },
          ],
        },
        {
          title: "Kasama na ang teams",
          description: "Wala nang dagdag na setup bago magsimula ang trabaho.",
          points: [
            {
              title: "Vibe coder team",
              description: "Kasama na ang tulong sa build, code, at shipping.",
            },
            {
              title: "Design studio",
              description: "Kasama na ang creative work, assets, at interface polish.",
            },
            {
              title: "Life at business teams",
              description: "Handa na rin ang personal improvement at business development.",
            },
          ],
        },
        {
          title: "Mga dashboard na madaling basahin",
          description: "Nananatiling malinaw ang actions ng agent at monitoring.",
          points: [
            {
              title: "Kasama na ang MauOffice",
              description: "Nandoon na ang mas madaling operasyong view.",
            },
            {
              title: "Nakikita ang actions",
              description: "Makikita mo kung ano ang tumakbo, ano ang nagbago, at ano ang dapat bantayan.",
            },
            {
              title: "Mas kaunting log hunting",
              description: "Tinutulungan ng dashboard na ipaliwanag ang system sa malinaw na tanaw.",
            },
          ],
        },
        {
          title: "Shared memory at users",
          description: "Maraming users at groups ang puwedeng magtago ng konteksto nang magkasama.",
          points: [
            {
              title: "Hiwalay na users",
              description: "Puwedeng panatilihing malinis ng bawat tao ang sarili nilang konteksto.",
            },
            {
              title: "Shared groups",
              description: "Puwedeng i-share ang memories kapag kailangang sabay na makaalala ang isang grupo.",
            },
            {
              title: "Underlying memory layer",
              description: "Sinusuportahan ng QMD at Lossless Claw.",
            },
          ],
        },
        {
          title: "Personal use muna",
          description: "Inaakalang gamit mo ito sa totoong buhay, hindi lang sa desk demo.",
          points: [
            {
              title: "Call-based access",
              description: "Tumutulong ang telephony kapag malayo ka sa keyboard.",
            },
            {
              title: "Non-digital follow-through",
              description: "Kaya rin nitong abutin ang mga aksyong hindi lang nangyayari sa screen.",
            },
            {
              title: "Personal-use posture",
              description: "Itinuturing ang araw-araw na buhay bilang pangunahing use case.",
            },
          ],
        },
        {
          title: "Structured agent teams",
          description: "Isang main agent ang nag-oorganisa ng mini teams at subagents.",
          points: [
            {
              title: "Main agent orchestration",
              description: "Nananatiling sentro ang koordinasyon sa halip na magkawatak-watak.",
            },
            {
              title: "Mini teams at subagents",
              description: "Nakagrupo ang specialists ayon sa trabaho at hindi nakakalat.",
            },
            {
              title: "OpenProse workflow",
              description: "Naka-define na ang daloy ng trabaho sa ilalim.",
            },
          ],
        },
      ],
      startSteps: [
        {
          title: "Ihanda ang iyong model account",
          description:
            "Mag-sign up para sa LLM account o kumuha ng API key. Ang inirerekomendang landas ay OpenAI gamit ang ChatGPT.",
        },
        {
          title: "Mag-set up ng channel bot",
          description:
            "Ikonekta ang messaging channel para makasalubong ka ni Maumau sa lugar na pamilyar ka. Telegram ang inirerekomendang unang channel.",
        },
        {
          title: "I-install ang Tailscale sa mga device mo",
          description:
            "I-download ang Tailscale at mag-sign in sa Mac at phone mo. Pinapadali nito ang pagbukas ng mga link na ginagawa ng system mula sa mobile.",
        },
        {
          title: "I-set up ang Vapi para sa tawag",
          description:
            "Idagdag ang Vapi para kayanin ni Maumau ang mga aksyong mas angkop sa tawag, hindi lang sa chat.",
        },
        {
          title: "I-download ang app at sumunod lang",
          description:
            "I-download ang macOS app, patakbuhin ito, at ituloy ang guided setup sa loob. Dadalhin ka ni Maumau sa natitirang mga hakbang ayon sa tamang ayos.",
        },
      ],
    },
  };

  const cloneLocale = (base, overrides) => ({
    ...landingTranslations[base],
    title: overrides.title ?? landingTranslations[base].title,
    metaDescription: overrides.metaDescription ?? landingTranslations[base].metaDescription,
    text: {
      ...landingTranslations[base].text,
      ...(overrides.text ?? {}),
    },
    featureCards: overrides.featureCards ?? landingTranslations[base].featureCards,
    startSteps: overrides.startSteps ?? landingTranslations[base].startSteps,
  });

  landingTranslations.jv = cloneLocale("id", {
    title: "Maumau | Undhuh lan setel",
    text: {
      brand_eyebrow: "Aplikasi Maumau",
      brand_sub: "Undhuh, setel, lan kendhalekna.",
      nav_landing: "Ngarep",
      nav_guide: "Pandhuan dashboard",
      nav_download: "Undhuh aplikasi macOS",
      hero_kicker: "Dipandu saka instalasi tekan run pisanan sing tenan",
      why_kicker: "Napa Maumau",
      why_title: "Tekan run nyata tanpa kesel merga setup.",
      start_kicker: "Carane miwiti",
      start_title: "Lima langkah menyang run pisananmu.",
      story_kicker: "Urip wis kelakon ing chat",
      story_title: "Tetep ana ing panggonan wong wis padha ngomong.",
      footer_note: "Landing page kanggo build lokal Maumau sing saiki.",
      footer_guide: "Pandhuan dashboard",
      footer_download: "Undhuh aplikasi macOS",
    },
  });

  landingTranslations.su = cloneLocale("id", {
    title: "Maumau | Undeur jeung setel",
    text: {
      brand_eyebrow: "Aplikasi Maumau",
      brand_sub: "Undeur, setel, jeung kendalikeun.",
      nav_landing: "Mimiti",
      nav_guide: "Pituduh dashboard",
      nav_download: "Undeur aplikasi macOS",
      hero_kicker: "Dipandu ti instalasi nepi ka run munggaran anu nyata",
      why_kicker: "Naha Maumau",
      why_title: "Nepi ka run nyata tanpa cape ku setup.",
      start_kicker: "Kumaha ngamimitian",
      start_title: "Lima léngkah ka run munggaran anjeun.",
      story_kicker: "Hirup memang geus kajadian dina chat",
      story_title: "Cicing di tempat jalma-jalma geus ngobrol.",
      footer_note: "Landing page pikeun build lokal Maumau ayeuna.",
      footer_guide: "Pituduh dashboard",
      footer_download: "Undeur aplikasi macOS",
    },
  });

  landingTranslations.btk = cloneLocale("id", {
    title: "Maumau | Unduh dohot setel",
    text: {
      brand_eyebrow: "Aplikasi Maumau",
      brand_sub: "Unduh, setel, jala kendalikan.",
      nav_landing: "Landing",
      nav_guide: "Panduan dashboard",
      nav_download: "Unduh aplikasi macOS",
      hero_kicker: "Dipandu sian instalasi tu run parjolo na nyata",
      why_kicker: "Boasa Maumau",
      why_title: "Tu run nyata tanpa ale setup na mangela.",
      start_kicker: "Songon dia mamulai",
      start_title: "Lima langkah tu run parjolo mu.",
      story_kicker: "Ngolu memang adong di chat",
      story_title: "Tetap di inganan halak mandok.",
      footer_note: "Landing page tu build lokal Maumau saonari.",
    },
  });

  landingTranslations.min = cloneLocale("id", {
    title: "Maumau | Unduah jo setel",
    text: {
      brand_eyebrow: "Aplikasi Maumau",
      brand_sub: "Unduah, setel, jo kendalikan.",
      nav_landing: "Utamo",
      nav_guide: "Panduan dashboard",
      nav_download: "Unduah aplikasi macOS",
      hero_kicker: "Dipandu dari instalasi sampai run patamo nan bana",
      why_kicker: "Apo sabab Maumau",
      why_title: "Sampai ka run bana tanpa capek dek setup.",
      start_kicker: "Caro mamulai",
      start_title: "Limo langkah ka run partamo ang.",
      story_kicker: "Hidup memang lah jadi di chat",
      story_title: "Tingga di tampek urang alah babicaro.",
      footer_note: "Landing page untuak build lokal Maumau kini.",
    },
  });

  landingTranslations.ban = cloneLocale("id", {
    title: "Maumau | Unduh tur setel",
    text: {
      brand_eyebrow: "Aplikasi Maumau",
      brand_sub: "Unduh, setel, tur kendaliang.",
      nav_landing: "Utama",
      nav_guide: "Panduan dashboard",
      nav_download: "Unduh aplikasi macOS",
      hero_kicker: "Dipandu saking instalasi ngantos run kapertama sane nyata",
      why_kicker: "Napi Maumau",
      why_title: "Ngantos ring run nyata tanpa kesel antuk setup.",
      start_kicker: "Kengken ngawitin",
      start_title: "Lima langkah ring run kapertama ragane.",
      story_kicker: "Urip sampun wenten ring chat",
      story_title: "Tetep ring genah iraga sampun mabecik-becik.",
      footer_note: "Landing page antuk build lokal Maumau sane mangkin.",
    },
  });

  const conciseWhyContent = {
    en: {
      title: "Less setup. More first run.",
      description: "Maumau keeps the hard parts guided, visible, and already wired.",
    },
    zh: {
      title: "更少折腾设置，更快跑起来。",
      description: "Maumau 把最难的部分变成引导步骤、现成团队、清晰仪表板和有边界的记忆系统。",
    },
    id: {
      title: "Lebih sedikit setup. Lebih cepat run pertama.",
      description: "Maumau membuat bagian yang berat jadi terpandu, terlihat, dan sudah terhubung.",
    },
    ms: {
      title: "Kurang setup. Lebih cepat run pertama.",
      description: "Maumau menjadikan bahagian yang sukar lebih berpandu, jelas, dan sudah disambung.",
    },
    th: {
      title: "ตั้งค่าน้อยลง ไปถึงรันจริงได้เร็วขึ้น",
      description: "Maumau ทำส่วนที่ยากให้เป็นขั้นตอนนำทาง เห็นภาพชัด และเชื่อมไว้ให้แล้ว",
    },
    vi: {
      title: "Bot setup hon. Den run dau nhanh hon.",
      description: "Maumau bien phan kho thanh tung buoc co huong dan, de nhin, va da duoc noi san.",
    },
    my: {
      title: "Setup နည်းနည်း၊ first run မြန်မြန်",
      description: "Maumau က ခက်တဲ့အပိုင်းတွေကို guide လုပ်ထားပြီး မြင်လွယ်အောင် ပြထားတယ်၊ connection တွေလည်း ချိတ်ပြီးသား။",
    },
    fil: {
      title: "Mas kaunting setup. Mas mabilis sa unang run.",
      description: "Ginagawang guided, malinaw, at naka-wire na ni Maumau ang mahihirap na bahagi.",
    },
  };

  const conciseFeatureCards = {
    en: [
      {
        title: "Setup without terminal stress",
        description: "The app walks people through the first run.",
        points: [
          {
            title: "Benefit",
            description: "Only the necessary steps, with defaults already filled.",
          },
          {
            title: "Key tech",
            description: "Telegram, Vapi, Tailscale.",
          },
        ],
      },
      {
        title: "Teams already included",
        description: "Useful specialists arrive ready to work.",
        points: [
          {
            title: "Benefit",
            description: "Coding, design, life, and business support are bundled.",
          },
          {
            title: "Key tech",
            description: "Main agent, mini teams, subagents, OpenProse.",
          },
        ],
      },
      {
        title: "Memory that stays organized",
        description: "People can keep context separate or shared.",
        points: [
          {
            title: "Benefit",
            description: "Multiple users and groups remember at the right boundary.",
          },
          {
            title: "Key tech",
            description: "QMD, Lossless Claw.",
          },
        ],
      },
      {
        title: "Dashboards you can read",
        description: "You can tell what the system is doing.",
        points: [
          {
            title: "Benefit",
            description: "Actions, monitoring, and handoffs stay visible.",
          },
          {
            title: "Key tech",
            description: "MauOffice, operations dashboard.",
          },
        ],
      },
    ],
    zh: [
      {
        title: "不被终端劝退的设置",
        description: "应用会带你走完第一次运行。",
        points: [
          {
            title: "价值",
            description: "只做必要步骤，默认值也先帮你填好。",
          },
          {
            title: "关键技术",
            description: "Telegram、Vapi、Tailscale。",
          },
        ],
      },
      {
        title: "团队已经在里面",
        description: "有用的专家一开始就能工作。",
        points: [
          {
            title: "价值",
            description: "编码、设计、生活和业务支持都已打包好。",
          },
          {
            title: "关键技术",
            description: "主代理、小团队、子代理、OpenProse。",
          },
        ],
      },
      {
        title: "记忆保持有边界",
        description: "个人上下文和共享上下文都能放对位置。",
        points: [
          {
            title: "价值",
            description: "多个用户和用户组可以按需要分开或共享记忆。",
          },
          {
            title: "关键技术",
            description: "QMD、Lossless Claw。",
          },
        ],
      },
      {
        title: "看得懂的仪表板",
        description: "你能知道系统现在在做什么。",
        points: [
          {
            title: "价值",
            description: "动作、监控和交接状态都保持可见。",
          },
          {
            title: "关键技术",
            description: "MauOffice、运营仪表板。",
          },
        ],
      },
    ],
    id: [
      {
        title: "Setup tanpa stres terminal",
        description: "Aplikasi memandu run pertamamu.",
        points: [
          {
            title: "Benefit",
            description: "Hanya langkah yang perlu, dengan default yang sudah terisi.",
          },
          {
            title: "Teknologi kunci",
            description: "Telegram, Vapi, Tailscale.",
          },
        ],
      },
      {
        title: "Tim sudah termasuk",
        description: "Spesialis yang berguna langsung siap kerja.",
        points: [
          {
            title: "Benefit",
            description: "Dukungan coding, design, life, dan business sudah dibundel.",
          },
          {
            title: "Teknologi kunci",
            description: "Main agent, mini teams, subagents, OpenProse.",
          },
        ],
      },
      {
        title: "Memory tetap rapi",
        description: "Konteks bisa dipisah atau dibagi dengan jelas.",
        points: [
          {
            title: "Benefit",
            description: "Banyak user dan grup bisa mengingat di batas yang tepat.",
          },
          {
            title: "Teknologi kunci",
            description: "QMD, Lossless Claw.",
          },
        ],
      },
      {
        title: "Dashboard yang mudah dibaca",
        description: "Kamu bisa tahu sistem sedang melakukan apa.",
        points: [
          {
            title: "Benefit",
            description: "Aksi, monitoring, dan handoff tetap terlihat.",
          },
          {
            title: "Teknologi kunci",
            description: "MauOffice, operations dashboard.",
          },
        ],
      },
    ],
    ms: [
      {
        title: "Setup tanpa stres terminal",
        description: "Aplikasi membimbing hingga run pertama.",
        points: [
          {
            title: "Manfaat",
            description: "Hanya langkah yang perlu, dengan default yang sudah diisi.",
          },
          {
            title: "Teknologi utama",
            description: "Telegram, Vapi, Tailscale.",
          },
        ],
      },
      {
        title: "Pasukan sudah termasuk",
        description: "Pakar yang berguna terus sedia bekerja.",
        points: [
          {
            title: "Manfaat",
            description: "Sokongan coding, design, life, dan business sudah dibundel.",
          },
          {
            title: "Teknologi utama",
            description: "Main agent, mini teams, subagents, OpenProse.",
          },
        ],
      },
      {
        title: "Memory kekal tersusun",
        description: "Konteks boleh diasingkan atau dikongsi dengan jelas.",
        points: [
          {
            title: "Manfaat",
            description: "Ramai pengguna dan kumpulan boleh mengingati pada sempadan yang betul.",
          },
          {
            title: "Teknologi utama",
            description: "QMD, Lossless Claw.",
          },
        ],
      },
      {
        title: "Dashboard yang mudah dibaca",
        description: "Anda tahu sistem sedang melakukan apa.",
        points: [
          {
            title: "Manfaat",
            description: "Tindakan, pemantauan, dan handoff kekal kelihatan.",
          },
          {
            title: "Teknologi utama",
            description: "MauOffice, operations dashboard.",
          },
        ],
      },
    ],
    th: [
      {
        title: "ตั้งค่าโดยไม่ต้องกลัวเทอร์มินัล",
        description: "แอปพาไปจนถึงการรันครั้งแรก",
        points: [
          {
            title: "ประโยชน์",
            description: "มีเฉพาะขั้นตอนที่จำเป็น และค่าเริ่มต้นถูกใส่ไว้แล้ว",
          },
          {
            title: "เทคโนโลยีหลัก",
            description: "Telegram, Vapi, Tailscale",
          },
        ],
      },
      {
        title: "มีทีมมาให้แล้ว",
        description: "ทีมที่ใช้ได้จริงพร้อมเริ่มงาน",
        points: [
          {
            title: "ประโยชน์",
            description: "มีทีมโค้ด ดีไซน์ ชีวิต และธุรกิจมาให้ในตัว",
          },
          {
            title: "เทคโนโลยีหลัก",
            description: "main agent, mini teams, subagents, OpenProse",
          },
        ],
      },
      {
        title: "หน่วยความจำเป็นระเบียบ",
        description: "จะแยกบริบทหรือแชร์ร่วมกันก็ได้",
        points: [
          {
            title: "ประโยชน์",
            description: "หลายผู้ใช้และหลายกลุ่มเก็บความทรงจำในขอบเขตที่ถูกต้อง",
          },
          {
            title: "เทคโนโลยีหลัก",
            description: "QMD, Lossless Claw",
          },
        ],
      },
      {
        title: "แดชบอร์ดที่อ่านรู้เรื่อง",
        description: "คุณเห็นได้ว่าระบบกำลังทำอะไร",
        points: [
          {
            title: "ประโยชน์",
            description: "การทำงาน การมอนิเตอร์ และการส่งต่องานยังมองเห็นได้",
          },
          {
            title: "เทคโนโลยีหลัก",
            description: "MauOffice, operations dashboard",
          },
        ],
      },
    ],
    vi: [
      {
        title: "Setup khong gay ngai terminal",
        description: "Ung dung dan ban den run dau tien.",
        points: [
          {
            title: "Loi ich",
            description: "Chi co nhung buoc can thiet, va default da duoc dien san.",
          },
          {
            title: "Cong nghe chinh",
            description: "Telegram, Vapi, Tailscale.",
          },
        ],
      },
      {
        title: "Da co san cac team",
        description: "Nhung specialist huu ich da san sang lam viec.",
        points: [
          {
            title: "Loi ich",
            description: "Coding, design, doi song, va kinh doanh deu da duoc dong goi.",
          },
          {
            title: "Cong nghe chinh",
            description: "main agent, mini teams, subagents, OpenProse.",
          },
        ],
      },
      {
        title: "Memory van gon gang",
        description: "Boi canh co the tach rieng hoac chia se ro rang.",
        points: [
          {
            title: "Loi ich",
            description: "Nhieu user va nhieu nhom co the nho dung ranh gioi.",
          },
          {
            title: "Cong nghe chinh",
            description: "QMD, Lossless Claw.",
          },
        ],
      },
      {
        title: "Dashboard de doc",
        description: "Ban biet he thong dang lam gi.",
        points: [
          {
            title: "Loi ich",
            description: "Action, monitoring, va handoff van hien ro.",
          },
          {
            title: "Cong nghe chinh",
            description: "MauOffice, operations dashboard.",
          },
        ],
      },
    ],
    my: [
      {
        title: "Terminal မကြောက်ရတဲ့ setup",
        description: "App က first run အထိ လမ်းညွှန်ပေးတယ်။",
        points: [
          {
            title: "Benefit",
            description: "လိုအပ်တဲ့အဆင့်ပဲ ရှိပြီး default တွေလည်း ဖြည့်ပြီးသား။",
          },
          {
            title: "Key tech",
            description: "Telegram, Vapi, Tailscale.",
          },
        ],
      },
      {
        title: "Team တွေပါပြီးသား",
        description: "အသုံးဝင်တဲ့ specialist တွေက အလုပ်စလို့ရပြီ။",
        points: [
          {
            title: "Benefit",
            description: "Coding, design, life, နဲ့ business support တွေ bundled ဖြစ်ပြီးသား။",
          },
          {
            title: "Key tech",
            description: "main agent, mini teams, subagents, OpenProse.",
          },
        ],
      },
      {
        title: "Memory ကိုစနစ်တကျထားတယ်",
        description: "Context ကို သီးသန့်ထားလို့ရသလို မျှဝေလို့လည်းရတယ်။",
        points: [
          {
            title: "Benefit",
            description: "User အများအပြားနဲ့ group တွေက မှတ်ဉာဏ်ကို နေရာမှန်မှာထားနိုင်တယ်။",
          },
          {
            title: "Key tech",
            description: "QMD, Lossless Claw.",
          },
        ],
      },
      {
        title: "ဖတ်ရလွယ်တဲ့ dashboard",
        description: "System ဘာလုပ်နေတယ်ဆိုတာ မြင်ရတယ်။",
        points: [
          {
            title: "Benefit",
            description: "Action, monitoring, နဲ့ handoff တွေကို မြင်သာနေစေတယ်။",
          },
          {
            title: "Key tech",
            description: "MauOffice, operations dashboard.",
          },
        ],
      },
    ],
    fil: [
      {
        title: "Setup na hindi nakaka-stress",
        description: "Inaakay ka ng app hanggang unang run.",
        points: [
          {
            title: "Benepisyo",
            description: "Mga kailangang hakbang lang, at naka-fill na ang defaults.",
          },
          {
            title: "Pangunahing tech",
            description: "Telegram, Vapi, Tailscale.",
          },
        ],
      },
      {
        title: "Kasama na ang teams",
        description: "Handa nang magtrabaho ang mga specialist.",
        points: [
          {
            title: "Benepisyo",
            description: "Bundled na ang coding, design, life, at business support.",
          },
          {
            title: "Pangunahing tech",
            description: "main agent, mini teams, subagents, OpenProse.",
          },
        ],
      },
      {
        title: "Memory na maayos",
        description: "Puwedeng hiwalay o shared ang context.",
        points: [
          {
            title: "Benepisyo",
            description: "Maaaring magtanda ang maraming users at groups sa tamang hangganan.",
          },
          {
            title: "Pangunahing tech",
            description: "QMD, Lossless Claw.",
          },
        ],
      },
      {
        title: "Dashboard na madaling basahin",
        description: "Alam mo kung ano ang ginagawa ng system.",
        points: [
          {
            title: "Benepisyo",
            description: "Nananatiling kita ang actions, monitoring, at handoffs.",
          },
          {
            title: "Pangunahing tech",
            description: "MauOffice, operations dashboard.",
          },
        ],
      },
    ],
  };

  const guidedStartContent = {
    en: {
      title: "Start here, in order.",
      description: "Open each page, finish that setup, then come back for the next step.",
    },
    zh: {
      title: "按顺序从这里开始。",
      description: "打开当前这一步需要的页面，完成后再回来继续下一步。",
    },
    id: {
      title: "Mulai dari sini, berurutan.",
      description: "Buka halaman tiap langkah, selesaikan dulu, lalu kembali ke langkah berikutnya.",
    },
    ms: {
      title: "Mula di sini, ikut turutan.",
      description: "Buka halaman untuk setiap langkah, siapkan dahulu, kemudian kembali untuk langkah seterusnya.",
    },
    th: {
      title: "เริ่มจากตรงนี้ ตามลำดับ",
      description: "เปิดหน้าของแต่ละขั้น ทำให้เสร็จ แล้วค่อยกลับมาทำขั้นถัดไป",
    },
    vi: {
      title: "Bat dau tu day, theo dung thu tu.",
      description: "Mo tung trang can thiet, hoan thanh buoc do, roi quay lai buoc tiep theo.",
    },
    my: {
      title: "ဒီကနေ အစဉ်လိုက်စပါ",
      description: "အဆင့်တစ်ခုချင်းစီအတွက် လိုတဲ့ page ကိုဖွင့်ပြီး အဲဒီ step ကိုပြီးမှ နောက်တစ်ဆင့်ကိုပြန်လာပါ။",
    },
    fil: {
      title: "Magsimula rito, sunod-sunod.",
      description: "Buksan ang page ng bawat hakbang, tapusin iyon, saka bumalik para sa susunod.",
    },
  };

  const guidedStartSteps = {
    en: [
      {
        title: "Get your model account ready",
        description: "Sign up for an LLM account or get an API key. The recommended path is OpenAI with ChatGPT.",
        cta: "Open ChatGPT",
      },
      {
        title: "Set up a channel bot",
        description: "Connect a messaging channel so Maumau can meet you somewhere familiar. Telegram is the recommended first channel.",
        cta: "Open BotFather",
      },
      {
        title: "Install Tailscale on your devices",
        description: "Download Tailscale and sign in on your Mac and phone. It makes links generated by the system much easier to open from mobile.",
        cta: "Get Tailscale",
      },
      {
        title: "Set up Vapi for calling",
        description: "Add Vapi so Maumau can handle actions that work better over a call, not only in chat.",
        cta: "Open Vapi",
      },
      {
        title: "Download the app and follow along",
        description: "Download the macOS app, run it, and keep going inside the guided setup. Maumau walks you through the remaining steps in order.",
        cta: "Download Maumau",
      },
    ],
    zh: [
      {
        title: "先准备好模型账户",
        description: "注册一个 LLM 账户或获取 API key。推荐路径是 OpenAI 和 ChatGPT。",
        cta: "打开 ChatGPT",
      },
      {
        title: "设置频道机器人",
        description: "先接上一个消息频道，让 Maumau 出现在你熟悉的地方。推荐从 Telegram 开始。",
        cta: "打开 BotFather",
      },
      {
        title: "在设备上安装 Tailscale",
        description: "在你的 Mac 和手机上下载并登录 Tailscale。这样系统生成的链接会更容易在手机上打开。",
        cta: "获取 Tailscale",
      },
      {
        title: "为通话设置 Vapi",
        description: "接上 Vapi，让 Maumau 也能处理更适合通过电话完成的动作。",
        cta: "打开 Vapi",
      },
      {
        title: "下载应用并跟着走",
        description: "下载 macOS 应用，运行它，然后继续跟着应用里的引导走。Maumau 会按顺序带你完成后面的步骤。",
        cta: "下载 Maumau",
      },
    ],
    id: [
      {
        title: "Siapkan akun model dulu",
        description: "Daftar akun LLM atau ambil API key. Jalur yang direkomendasikan adalah OpenAI dengan ChatGPT.",
        cta: "Buka ChatGPT",
      },
      {
        title: "Setel bot channel",
        description: "Hubungkan channel pesan supaya Maumau bisa menemuimu di tempat yang familiar. Telegram adalah channel pertama yang direkomendasikan.",
        cta: "Buka BotFather",
      },
      {
        title: "Pasang Tailscale di perangkatmu",
        description: "Unduh Tailscale dan masuk di Mac dan ponselmu. Ini membuat tautan yang dibuat sistem jauh lebih mudah dibuka dari ponsel.",
        cta: "Ambil Tailscale",
      },
      {
        title: "Siapkan Vapi untuk panggilan",
        description: "Tambahkan Vapi supaya Maumau juga bisa menangani tindakan yang lebih cocok dilakukan lewat panggilan, bukan hanya chat.",
        cta: "Buka Vapi",
      },
      {
        title: "Unduh aplikasinya lalu ikuti",
        description: "Unduh aplikasi macOS, jalankan, lalu lanjutkan setup terpandu di dalamnya. Maumau akan membawamu melewati langkah sisanya dengan urut.",
        cta: "Unduh Maumau",
      },
    ],
    ms: [
      {
        title: "Sediakan akaun model dahulu",
        description: "Daftar akaun LLM atau dapatkan API key. Laluan yang disyorkan ialah OpenAI dengan ChatGPT.",
        cta: "Buka ChatGPT",
      },
      {
        title: "Sediakan bot saluran",
        description: "Sambungkan saluran mesej supaya Maumau boleh menemui anda di tempat yang biasa. Telegram ialah saluran pertama yang disyorkan.",
        cta: "Buka BotFather",
      },
      {
        title: "Pasang Tailscale pada peranti anda",
        description: "Muat turun Tailscale dan log masuk pada Mac dan telefon anda. Ini menjadikan pautan yang dijana sistem lebih mudah dibuka dari telefon.",
        cta: "Dapatkan Tailscale",
      },
      {
        title: "Sediakan Vapi untuk panggilan",
        description: "Tambahkan Vapi supaya Maumau juga boleh mengendalikan tindakan yang lebih sesuai dibuat melalui panggilan, bukan chat sahaja.",
        cta: "Buka Vapi",
      },
      {
        title: "Muat turun aplikasi dan ikut panduan",
        description: "Muat turun aplikasi macOS, jalankan, dan teruskan di dalam setup berpandu. Maumau akan membawa anda melalui langkah selebihnya mengikut turutan.",
        cta: "Muat turun Maumau",
      },
    ],
    th: [
      {
        title: "เตรียมบัญชีโมเดลของคุณ",
        description: "สมัครบัญชี LLM หรือรับ API key มาก่อน เส้นทางที่แนะนำคือ OpenAI กับ ChatGPT",
        cta: "เปิด ChatGPT",
      },
      {
        title: "ตั้งค่าบอตช่องทาง",
        description: "เชื่อมช่องทางส่งข้อความเพื่อให้ Maumau ไปอยู่ในที่ที่คุณคุ้นเคย โดยแนะนำให้เริ่มจาก Telegram",
        cta: "เปิด BotFather",
      },
      {
        title: "ติดตั้ง Tailscale บนอุปกรณ์ของคุณ",
        description: "ดาวน์โหลด Tailscale และล็อกอินทั้งบน Mac และโทรศัพท์ของคุณ เพื่อให้ลิงก์ที่ระบบสร้างเปิดจากมือถือได้ง่ายขึ้นมาก",
        cta: "รับ Tailscale",
      },
      {
        title: "ตั้งค่า Vapi สำหรับการโทร",
        description: "เพิ่ม Vapi เพื่อให้ Maumau ทำงานที่เหมาะกับการโทรได้ ไม่ได้จำกัดอยู่แค่ในแชต",
        cta: "เปิด Vapi",
      },
      {
        title: "ดาวน์โหลดแอปแล้วทำตามไกด์",
        description: "ดาวน์โหลดแอป macOS เปิดใช้งาน แล้วเดินต่อในขั้นตอนแบบมีไกด์ภายในแอป Maumau จะพาคุณผ่านขั้นที่เหลือตามลำดับ",
        cta: "ดาวน์โหลด Maumau",
      },
    ],
    vi: [
      {
        title: "Chuan bi tai khoan model",
        description: "Dang ky mot tai khoan LLM hoac lay API key. Lo trinh duoc khuyen nghi la OpenAI voi ChatGPT.",
        cta: "Mo ChatGPT",
      },
      {
        title: "Thiet lap bot kenh",
        description: "Ket noi mot kenh nhan tin de Maumau co the gap ban o noi ban quen thuoc. Telegram la kenh dau tien duoc khuyen nghi.",
        cta: "Mo BotFather",
      },
      {
        title: "Cai Tailscale tren cac thiet bi cua ban",
        description: "Tai Tailscale va dang nhap tren Mac va dien thoai cua ban. Dieu nay giup cac lien ket do he thong tao ra mo tren di dong de dang hon nhieu.",
        cta: "Lay Tailscale",
      },
      {
        title: "Thiet lap Vapi cho cuoc goi",
        description: "Them Vapi de Maumau co the xu ly nhung viec phu hop hon voi cuoc goi, khong chi chat.",
        cta: "Mo Vapi",
      },
      {
        title: "Tai ung dung va lam theo",
        description: "Tai ung dung macOS, chay no, roi tiep tuc voi setup co huong dan ben trong. Maumau se dua ban qua cac buoc con lai theo dung thu tu.",
        cta: "Tai Maumau",
      },
    ],
    my: [
      {
        title: "Model account ကိုအရင်ပြင်ပါ",
        description: "LLM account တစ်ခုဖွင့်ပါ၊ ဒါမှမဟုတ် API key ယူပါ။ Recommended path က OpenAI နဲ့ ChatGPT ဖြစ်ပါတယ်။",
        cta: "ChatGPT ဖွင့်မယ်",
      },
      {
        title: "Channel bot ကို setup လုပ်ပါ",
        description: "Maumau က သင်ရင်းနှီးတဲ့နေရာမှာလာတွေ့နိုင်အောင် messaging channel တစ်ခုကို ချိတ်ပါ။ Recommended first channel က Telegram ဖြစ်ပါတယ်။",
        cta: "BotFather ဖွင့်မယ်",
      },
      {
        title: "Tailscale ကို device တွေမှာ install လုပ်ပါ",
        description: "Tailscale ကို download လုပ်ပြီး Mac နဲ့ phone မှာ sign in လုပ်ပါ။ System ကထုတ်ပေးတဲ့ link တွေကို ဖုန်းကနေဖွင့်ရတာ ပိုလွယ်စေပါတယ်။",
        cta: "Tailscale ရယူမယ်",
      },
      {
        title: "Calling အတွက် Vapi ကို setup လုပ်ပါ",
        description: "Vapi ကိုထည့်ပြီး Maumau က chat ပဲမဟုတ်ဘဲ call နဲ့ပိုသင့်တော်တဲ့ action တွေကိုလည်း ကိုင်တွယ်နိုင်အောင်လုပ်ပါ။",
        cta: "Vapi ဖွင့်မယ်",
      },
      {
        title: "App ကို download လုပ်ပြီး လိုက်လုပ်ပါ",
        description: "macOS app ကို download လုပ်၊ run လုပ်ပြီး guided setup ကိုဆက်လိုက်ပါ။ Maumau က ကျန်တဲ့အဆင့်တွေကို အစဉ်လိုက်လမ်းညွှန်ပေးပါလိမ့်မယ်။",
        cta: "Maumau ကို download လုပ်မယ်",
      },
    ],
    fil: [
      {
        title: "Ihanda ang iyong model account",
        description: "Mag-sign up para sa LLM account o kumuha ng API key. Ang inirerekomendang landas ay OpenAI gamit ang ChatGPT.",
        cta: "Buksan ang ChatGPT",
      },
      {
        title: "Mag-set up ng channel bot",
        description: "Ikonekta ang messaging channel para makasalubong ka ni Maumau sa lugar na pamilyar ka. Telegram ang inirerekomendang unang channel.",
        cta: "Buksan ang BotFather",
      },
      {
        title: "I-install ang Tailscale sa mga device mo",
        description: "I-download ang Tailscale at mag-sign in sa Mac at phone mo. Pinapadali nito ang pagbukas ng mga link na ginagawa ng system mula sa mobile.",
        cta: "Kunin ang Tailscale",
      },
      {
        title: "I-set up ang Vapi para sa tawag",
        description: "Idagdag ang Vapi para kayanin ni Maumau ang mga aksyong mas angkop sa tawag, hindi lang sa chat.",
        cta: "Buksan ang Vapi",
      },
      {
        title: "I-download ang app at sumunod lang",
        description: "I-download ang macOS app, patakbuhin ito, at ituloy ang guided setup sa loob. Dadalhin ka ni Maumau sa natitirang mga hakbang ayon sa tamang ayos.",
        cta: "I-download ang Maumau",
      },
    ],
  };

  Object.entries(conciseWhyContent).forEach(([locale, copy]) => {
    Object.assign(landingTranslations[locale].text, {
      why_title: copy.title,
      why_desc: copy.description,
    });
  });

  Object.entries(conciseFeatureCards).forEach(([locale, cards]) => {
    landingTranslations[locale].featureCards = cards;
  });

  Object.entries(guidedStartContent).forEach(([locale, copy]) => {
    Object.assign(landingTranslations[locale].text, {
      start_title: copy.title,
      start_desc: copy.description,
    });
  });

  Object.entries(guidedStartSteps).forEach(([locale, steps]) => {
    landingTranslations[locale].startSteps = steps;
  });

  ["jv", "su", "btk", "min", "ban"].forEach((locale) => {
    landingTranslations[locale].text.why_title = conciseWhyContent.id.title;
    landingTranslations[locale].text.why_desc = conciseWhyContent.id.description;
    landingTranslations[locale].featureCards = conciseFeatureCards.id;
    landingTranslations[locale].text.start_title = guidedStartContent.id.title;
    landingTranslations[locale].text.start_desc = guidedStartContent.id.description;
    landingTranslations[locale].startSteps = guidedStartSteps.id;
  });

  const localeLang = {
    en: "en",
    zh: "zh-Hans",
    id: "id",
    ms: "ms",
    th: "th",
    vi: "vi",
    my: "my",
    fil: "fil",
    jv: "jv",
    su: "su",
    btk: "btk",
    min: "min",
    ban: "ban",
  };

  const supportedLocales = Object.keys(landingTranslations);

  const normalizeLocale = (value) => {
    if (!value) {
      return "en";
    }

    const lower = value.toLowerCase();
    if (supportedLocales.includes(lower)) {
      return lower;
    }
    if (lower.startsWith("en")) {
      return "en";
    }
    if (lower.startsWith("zh")) {
      return "zh";
    }
    if (lower.startsWith("id")) {
      return "id";
    }
    if (lower.startsWith("ms")) {
      return "ms";
    }
    if (lower.startsWith("th")) {
      return "th";
    }
    if (lower.startsWith("vi")) {
      return "vi";
    }
    if (lower.startsWith("my")) {
      return "my";
    }
    if (lower.startsWith("fil") || lower.startsWith("tl")) {
      return "fil";
    }
    if (lower.startsWith("jv")) {
      return "jv";
    }
    if (lower.startsWith("su")) {
      return "su";
    }
    if (lower.startsWith("btk")) {
      return "btk";
    }
    if (lower.startsWith("min")) {
      return "min";
    }
    if (lower.startsWith("ban")) {
      return "ban";
    }
    return "en";
  };

  const applyFeatureTranslations = (cards) => {
    featureCards.forEach((cardNodes, cardIndex) => {
      const card = cards[cardIndex];
      if (!card) {
        return;
      }

      cardNodes.title.textContent = card.title;
      cardNodes.description.textContent = card.description;

      cardNodes.points.forEach((pointNodes, pointIndex) => {
        const point = card.points[pointIndex];
        if (!point) {
          return;
        }
        pointNodes.title.textContent = point.title;
        pointNodes.description.textContent = point.description;
      });
    });
  };

  const applyStartTranslations = (steps) => {
    startSteps.forEach((stepNodes, stepIndex) => {
      const step = steps[stepIndex];
      if (!step) {
        return;
      }

      stepNodes.title.textContent = step.title;
      stepNodes.description.textContent = step.description;
      if (stepNodes.cta && step.cta) {
        stepNodes.cta.textContent = step.cta;
      }
    });
  };

  const applyLandingLocale = (locale) => {
    const translation = landingTranslations[locale] ?? landingTranslations.en;

    document.title = translation.title;
    document.documentElement.lang = localeLang[locale] ?? "en";

    if (metaDescription) {
      metaDescription.setAttribute("content", translation.metaDescription);
    }

    Object.entries(translation.text).forEach(([key, value]) => {
      if (slotNodes[key]) {
        slotNodes[key].textContent = value;
      }
    });

    applyFeatureTranslations(translation.featureCards);
    applyStartTranslations(translation.startSteps);
  };

  let initialLocale = "en";
  try {
    const storedLocale = window.localStorage.getItem("maumau-language");
    if (storedLocale) {
      initialLocale = normalizeLocale(storedLocale);
    } else {
      const browserLocale = (navigator.languages ?? [navigator.language])
        .map(normalizeLocale)
        .find((locale) => supportedLocales.includes(locale));
      initialLocale = browserLocale ?? "en";
    }
  } catch {
    initialLocale = "en";
  }

  languageSelector.value = initialLocale;
  applyLandingLocale(initialLocale);

  languageSelector.addEventListener("change", (event) => {
    const nextLocale = normalizeLocale(event.target.value);
    languageSelector.value = nextLocale;
    applyLandingLocale(nextLocale);
    try {
      window.localStorage.setItem("maumau-language", nextLocale);
    } catch {
      // Ignore storage failures and keep the session-local selection.
    }
  });
}
