// ============================================================
// DASHBOARD THEME — professional education color presets for the
// app chrome (sidebar, topbar, buttons, cards, badges). Deliberately
// separate from the report card's brand colours (--primary, --rc-navy
// etc. in index.html) — the printed report card stays tied to the
// school's official identity regardless of which dashboard theme is
// active, since that's a formal document, not app UI.
//
// Each preset only overrides --dash-* variables. Every pairing below
// keeps light, high-contrast text on a dark surface (the existing
// pattern) so nothing ever reads as low-contrast against its own
// background.
// ============================================================

const DASHBOARD_THEMES = {
  chocolate: {
    label: "Chocolate & Gold", swatch: "#C9973F",
    vars: {
      "--dash-bg":"#241408", "--dash-surface":"#2E1B10", "--dash-card":"#38220F", "--dash-border":"#4A2E1E",
      "--dash-green":"#C9973F", "--dash-green-soft":"rgba(201,151,63,0.12)", "--dash-green-glow":"rgba(201,151,63,0.25)",
      "--dash-text":"#F3E7D3", "--dash-muted":"#A98A6D", "--dash-accent":"#E8C77E", "--dash-danger":"#B3401F", "--dash-blue":"#A9722E",
    },
  },
  navy: {
    label: "Navy Scholar", swatch: "#D4A937",
    vars: {
      "--dash-bg":"#0B1B33", "--dash-surface":"#12274A", "--dash-card":"#16305A", "--dash-border":"#24406E",
      "--dash-green":"#D4A937", "--dash-green-soft":"rgba(212,169,55,0.14)", "--dash-green-glow":"rgba(212,169,55,0.28)",
      "--dash-text":"#EAF0FB", "--dash-muted":"#8CA0C4", "--dash-accent":"#F0CB6A", "--dash-danger":"#E5484D", "--dash-blue":"#5B8DEF",
    },
  },
  emerald: {
    label: "Emerald Academy", swatch: "#3FAE68",
    vars: {
      "--dash-bg":"#0D1F17", "--dash-surface":"#132C20", "--dash-card":"#17342A", "--dash-border":"#22493A",
      "--dash-green":"#3FAE68", "--dash-green-soft":"rgba(63,174,104,0.14)", "--dash-green-glow":"rgba(63,174,104,0.28)",
      "--dash-text":"#E9F5EE", "--dash-muted":"#8FB6A0", "--dash-accent":"#63C98A", "--dash-danger":"#E5484D", "--dash-blue":"#4EA8DE",
    },
  },
  burgundy: {
    label: "Burgundy Prestige", swatch: "#E0AF5C",
    vars: {
      "--dash-bg":"#210D10", "--dash-surface":"#2E1216", "--dash-card":"#3A171C", "--dash-border":"#552126",
      "--dash-green":"#C9973F", "--dash-green-soft":"rgba(201,151,63,0.14)", "--dash-green-glow":"rgba(201,151,63,0.28)",
      "--dash-text":"#F7E9E7", "--dash-muted":"#C09B9B", "--dash-accent":"#E0AF5C", "--dash-danger":"#FF6B6B", "--dash-blue":"#7CA6D8",
    },
  },
  slate: {
    label: "Slate Professional", swatch: "#2DD4BF",
    vars: {
      "--dash-bg":"#111827", "--dash-surface":"#1A2436", "--dash-card":"#202B40", "--dash-border":"#2E3B52",
      "--dash-green":"#2DD4BF", "--dash-green-soft":"rgba(45,212,191,0.14)", "--dash-green-glow":"rgba(45,212,191,0.28)",
      "--dash-text":"#EDF1F7", "--dash-muted":"#8D9BB3", "--dash-accent":"#5EEAD4", "--dash-danger":"#F87171", "--dash-blue":"#60A5FA",
    },
  },
};

function applyDashboardTheme(name) {
  const theme = DASHBOARD_THEMES[name] || DASHBOARD_THEMES.chocolate;
  const root = document.documentElement.style;
  Object.entries(theme.vars).forEach(([k, v]) => root.setProperty(k, v));
  localStorage.setItem("pariya-dashboard-theme", name);
}
// Apply the last-known theme immediately at page load (before school
// settings finish fetching) so there's no flash of the wrong colours
// on repeat visits — mirrors the existing light/dark initTheme() pattern.
(function initDashboardTheme() {
  const cached = localStorage.getItem("pariya-dashboard-theme");
  if (cached && DASHBOARD_THEMES[cached]) applyDashboardTheme(cached);
})();

function renderDashboardThemePicker() {
  const current = state.schoolSettings.dashboard_theme || "chocolate";
  return `
    <div class="settings-card" id="set-theme">
      <div class="settings-card-title">Dashboard Theme</div>
      <p style="font-size:12px;color:var(--dash-muted);">Changes the app's colours for everyone at this school — sidebar, buttons, cards, badges. The printed report card's colours are separate and won't change.</p>
      <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(140px,1fr));gap:10px;margin-top:10px;">
        ${Object.entries(DASHBOARD_THEMES).map(([key, t]) => `
        <div onclick="previewDashboardTheme('${key}')" style="cursor:pointer;border:2px solid ${key===current?"var(--dash-green)":"var(--dash-border)"};border-radius:10px;padding:10px;text-align:center;" id="themeSwatch-${key}">
          <div style="width:100%;height:36px;border-radius:6px;background:${t.swatch};margin-bottom:8px;"></div>
          <div style="font-size:12px;font-weight:700;">${t.label}</div>
          ${key===current ? `<div class="badge badge-success" style="margin-top:6px;">Active</div>` : ""}
        </div>`).join("")}
      </div>
      <button class="btn btn-green" style="margin-top:14px;" onclick="saveDashboardTheme()" id="saveThemeBtn" disabled>Save Theme</button>
    </div>`;
}
let _pendingTheme = null;
function previewDashboardTheme(key) {
  _pendingTheme = key;
  applyDashboardTheme(key); // instant preview
  document.querySelectorAll("[id^='themeSwatch-']").forEach(el => el.style.borderColor = "var(--dash-border)");
  document.getElementById(`themeSwatch-${key}`).style.borderColor = "var(--dash-green)";
  document.getElementById("saveThemeBtn").disabled = false;
}
async function saveDashboardTheme() {
  if (!_pendingTheme) return;
  const { error } = await sb.from("school_settings").update({ dashboard_theme: _pendingTheme }).eq("id", true);
  if (error) { alert(error.message); return; }
  state.schoolSettings.dashboard_theme = _pendingTheme;
  document.getElementById("saveThemeBtn").disabled = true;
  alert("Theme saved — this now applies for everyone at the school.");
}
