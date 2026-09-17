// ============================================================
// TIMETABLE — constraint-based builder
// Detects teacher double-booking: a staff member cannot be placed
// in two different classes at the same day+period.
// ============================================================
const TT_DAYS = [1,2,3,4,5]; // Mon-Fri
const TT_DAY_LABELS = { 1:"Mon", 2:"Tue", 3:"Wed", 4:"Thu", 5:"Fri" };
const TT_PERIODS = [1,2,3,4,5,6,7,8];

async function renderTimetable() {
  const el = document.getElementById("panel-timetable");
  el.innerHTML = `
    <div class="page-header">
      <div class="page-header-text">
        <h1>Timetable</h1>
        <p>Weekly schedule per class — auto-generate from assigned teachers, or edit any slot by hand.</p>
      </div>
    </div>
    <div class="field" style="max-width:280px;"><label>Class</label>
    <select id="ttClassSelect" onchange="loadTimetableGrid()"><option value="">— choose —</option>
    ${state.classes.map(c => `<option value="${c.id}">${c.name}</option>`).join("")}</select></div>
    <div id="ttGrid"></div>`;
}

async function getOrCreateTimetable(classId) {
  const { data: existing } = await sb.from("timetables").select("id").eq("class_id", classId).order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (existing) return existing.id;
  const { data: created, error } = await sb.from("timetables").insert({ class_id: classId, generated_by: state.staff?.id }).select("id").single();
  if (error) { alert(error.message); return null; }
  return created.id;
}

async function loadTimetableGrid() {
  const classId = document.getElementById("ttClassSelect").value;
  const grid = document.getElementById("ttGrid");
  if (!classId) { grid.innerHTML = ""; return; }
  grid.innerHTML = "Loading…";

  const timetableId = await getOrCreateTimetable(classId);
  if (!timetableId) return;
  state.ttCurrentId = timetableId;
  state.ttCurrentClass = classId;

  const [{ data: slots }, { data: assigns }] = await Promise.all([
    sb.from("timetable_slots").select("*, subjects(name), staff(full_name)").eq("timetable_id", timetableId),
    sb.from("class_teacher_subjects").select("staff_id, subject_id, staff(full_name), subjects(name)").eq("class_id", classId),
  ]);
  state.ttSlots = slots || [];
  state.ttAssigns = assigns || [];

  if (!assigns || !assigns.length) {
    grid.innerHTML = `<div class="empty-state"><i class="fa-solid fa-user-slash"></i><p>No teachers assigned to this class yet. Assign some in Curriculum &amp; Assignments before building a timetable.</p></div>`;
    return;
  }

  const slotMap = {};
  (slots||[]).forEach(s => { slotMap[`${s.day_of_week}_${s.period_index}`] = s; });
  const filledCount = slots ? slots.length : 0;
  const totalSlots = TT_DAYS.length * TT_PERIODS.length;

  let html = `
  <div class="settings-card no-print" style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;">
    <button class="btn btn-green" onclick="autoGenerateTimetable()"><i class="fa-solid fa-wand-magic-sparkles"></i> Auto-Generate</button>
    <button class="btn btn-danger" onclick="clearTimetable()"><i class="fa-solid fa-trash"></i> Clear Grid</button>
    <span class="badge badge-info">${filledCount}/${totalSlots} periods filled</span>
    <span style="flex:1;"></span>
    <button class="btn" onclick="window.print()"><i class="fa-solid fa-print"></i> Print</button>
    <button class="btn" onclick="downloadTimetablePdf()"><i class="fa-solid fa-file-pdf"></i> PDF</button>
    <button class="btn" onclick="downloadTimetableWord()"><i class="fa-solid fa-file-word"></i> Word</button>
    <button class="btn" onclick="downloadTimetablePNG()"><i class="fa-solid fa-file-image"></i> PNG</button>
    <button class="btn" onclick="downloadTimetableExcel()"><i class="fa-solid fa-file-excel"></i> Excel</button>
  </div>
  <div style="overflow-x:auto;"><table class="data-table sticky-head" id="ttTable"><thead><tr><th>Period</th>${TT_DAYS.map(d => `<th>${TT_DAY_LABELS[d]}</th>`).join("")}</tr></thead><tbody>`;
  TT_PERIODS.forEach(p => {
    html += `<tr><td style="font-weight:800;">${p}</td>`;
    TT_DAYS.forEach(d => {
      const key = `${d}_${p}`;
      const cell = slotMap[key];
      html += `<td style="min-width:130px;padding:5px !important;${cell ? "background:var(--dash-green-soft);" : ""}">
        <select data-day="${d}" data-period="${p}" onchange="saveTimetableCell(this)" style="width:100%;font-size:11px;padding:6px;border-radius:6px;border:1px solid ${cell ? "var(--dash-green)" : "var(--dash-border)"};background:var(--dash-surface);color:var(--dash-text);">
          <option value="">— empty —</option>
          ${(assigns||[]).map(a => `<option value="${a.staff_id}|${a.subject_id}" ${cell && cell.staff_id===a.staff_id && cell.subject_id===a.subject_id ? "selected" : ""}>${a.subjects.name} (${a.staff.full_name})</option>`).join("")}
        </select>
      </td>`;
    });
    html += `</tr>`;
  });
  html += `</tbody></table></div>
    <p style="color:var(--dash-muted);font-size:12px;margin-top:10px;">Only teachers already assigned to this class (via Curriculum & Assignments) appear in the dropdowns. Saving a slot — manually or via Auto-Generate — automatically checks for double-booking against this teacher's other classes.</p>`;
  grid.innerHTML = html;
}

// ============================================================
// AUTO-GENERATE — round-robins the class's assigned teacher+subject
// pairs across the whole week, skipping any slot where that teacher
// is already booked (in any other class's timetable) at that exact
// day+period. Manual per-cell editing above still works afterward.
// ============================================================
async function autoGenerateTimetable() {
  if (!state.ttAssigns || !state.ttAssigns.length) {
    alert("No teacher/subject assignments found for this class yet. Assign teachers first in Curriculum & Assignments.");
    return;
  }
  if (!confirm("This clears the current grid for this class and auto-fills it from the assigned teachers/subjects. Continue?")) return;

  await sb.from("timetable_slots").delete().eq("timetable_id", state.ttCurrentId);

  const busy = {};
  const { data: existingSlots } = await sb.from("timetable_slots")
    .select("staff_id, day_of_week, period_index").neq("timetable_id", state.ttCurrentId);
  (existingSlots||[]).forEach(s => { busy[`${s.staff_id}_${s.day_of_week}_${s.period_index}`] = true; });

  const assigns = state.ttAssigns;
  let idx = 0;
  const toInsert = [];
  for (const p of TT_PERIODS) {
    for (const d of TT_DAYS) {
      for (let tries = 0; tries < assigns.length; tries++) {
        const a = assigns[idx % assigns.length]; idx++;
        const key = `${a.staff_id}_${d}_${p}`;
        if (busy[key]) continue;
        toInsert.push({ timetable_id: state.ttCurrentId, day_of_week: d, period_index: p, staff_id: a.staff_id, subject_id: a.subject_id });
        busy[key] = true;
        break;
      }
    }
  }
  if (toInsert.length) {
    const { error } = await sb.from("timetable_slots").insert(toInsert);
    if (error) { alert(error.message); return; }
  }
  await loadTimetableGrid();
  const total = TT_DAYS.length * TT_PERIODS.length;
  showToastOrAlert(`Auto-generated ${toInsert.length} of ${total} slots. Empty cells (if any) had no conflict-free teacher available — fill those manually.`);
}
async function clearTimetable() {
  if (!confirm("Clear every slot in this class's timetable?")) return;
  await sb.from("timetable_slots").delete().eq("timetable_id", state.ttCurrentId);
  await loadTimetableGrid();
}
function showToastOrAlert(msg) { if (typeof showToast === "function") showToast(msg); else alert(msg); }

async function saveTimetableCell(selectEl) {
  const day = Number(selectEl.dataset.day), period = Number(selectEl.dataset.period);
  const val = selectEl.value;

  // Clear this slot
  if (!val) {
    await sb.from("timetable_slots").delete().eq("timetable_id", state.ttCurrentId).eq("day_of_week", day).eq("period_index", period);
    return;
  }
  const [staff_id, subject_id] = val.split("|");

  // Conflict check: is this staff member already booked elsewhere at this day+period,
  // in ANY class's timetable (not just this one)?
  const { data: conflicts } = await sb.from("timetable_slots")
    .select("id, timetables(class_id, classes(name))")
    .eq("staff_id", staff_id).eq("day_of_week", day).eq("period_index", period)
    .neq("timetable_id", state.ttCurrentId);
  if (conflicts && conflicts.length) {
    const otherClass = conflicts[0].timetables?.classes?.name || "another class";
    alert(`Conflict: this teacher is already scheduled in ${otherClass} at this exact day/period. Choose a different slot or teacher.`);
    selectEl.value = "";
    return;
  }

  const { error } = await sb.from("timetable_slots").delete().eq("timetable_id", state.ttCurrentId).eq("day_of_week", day).eq("period_index", period);
  if (error) { alert(error.message); return; }
  const { error: insErr } = await sb.from("timetable_slots").insert({
    timetable_id: state.ttCurrentId, day_of_week: day, period_index: period, staff_id, subject_id,
  });
  if (insErr) alert(insErr.message);
}

// ============================================================
// EXPORTS — PDF/Word reuse the school's branded letterhead utility
// (see app-phase4.js); PNG mirrors the same letterhead via
// html2canvas directly; Excel uses SheetJS on the raw slot list.
// ============================================================
function ttCurrentClassName() {
  return state.classes.find(c => c.id === state.ttCurrentClass)?.name || "Timetable";
}
function ttSubtitle() {
  const term = state.terms.find(t => t.id === state.currentTermId);
  return `${ttCurrentClassName()} — ${term?.name || ""} — ${state.schoolSettings.current_session || ""}`;
}
function downloadTimetablePdf() {
  const table = document.getElementById("ttTable");
  if (!table) return;
  downloadBrandedPdf("Class Timetable", ttSubtitle(), table.outerHTML, `Timetable_${ttCurrentClassName().replace(/\s/g,"_")}.pdf`);
}
function downloadTimetableWord() {
  const table = document.getElementById("ttTable");
  if (!table) return;
  downloadBrandedWord("Class Timetable", ttSubtitle(), table.outerHTML, `Timetable_${ttCurrentClassName().replace(/\s/g,"_")}.doc`);
}
async function downloadTimetablePNG() {
  const table = document.getElementById("ttTable");
  if (!table || typeof html2canvas === "undefined") { alert("PNG export library not loaded."); return; }
  const mount = document.createElement("div");
  mount.style.cssText = "position:fixed;top:0;left:-99999px;z-index:-1;background:#fff;";
  mount.innerHTML = buildLetterPdfHtml("Class Timetable", ttSubtitle(), table.outerHTML);
  document.body.appendChild(mount);
  await new Promise(r => setTimeout(r, 60));
  try {
    const canvas = await html2canvas(mount, { scale: 2, useCORS: true, allowTaint: true, backgroundColor: "#ffffff" });
    canvas.toBlob(blob => {
      const link = document.createElement("a");
      link.href = URL.createObjectURL(blob);
      link.download = `Timetable_${ttCurrentClassName().replace(/\s/g,"_")}.png`;
      document.body.appendChild(link); link.click(); document.body.removeChild(link);
    });
  } finally {
    document.body.removeChild(mount);
  }
}
function downloadTimetableExcel() {
  if (typeof XLSX === "undefined") { alert("Excel export library not loaded."); return; }
  const slots = state.ttSlots || [];
  if (!slots.length) { alert("This timetable is empty — nothing to export."); return; }
  const data = slots
    .slice()
    .sort((a,b) => a.period_index - b.period_index || a.day_of_week - b.day_of_week)
    .map(s => ({
      Period: s.period_index, Day: TT_DAY_LABELS[s.day_of_week],
      Subject: s.subjects?.name || "", Teacher: s.staff?.full_name || "",
    }));
  const ws = XLSX.utils.json_to_sheet(data);
  ws["!cols"] = [{wch:8},{wch:10},{wch:22},{wch:24}];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Timetable");
  XLSX.writeFile(wb, `Timetable_${ttCurrentClassName().replace(/\s/g,"_")}.xlsx`);
}
