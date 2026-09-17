// ============================================================
// SALARY TRACKER — uses staff.salary_status jsonb, keyed
// "<termId>_1"/"_2"/"_3" (one tickbox per month of that term),
// admin-only write, any staff can read own.
// ============================================================
async function renderSalaryTracker() {
  const el = document.getElementById("panel-salaryTracker");
  el.innerHTML = `
    <div class="page-header">
      <div class="page-header-text">
        <h1>Salary Tracker</h1>
        <p>Tick each month of the term as it's paid — status updates automatically per staff member.</p>
      </div>
    </div>
    <div class="field" style="max-width:280px;"><label>Term</label><select id="salTermSelect" onchange="loadSalaryTracker()">
      ${state.terms.map(t => `<option value="${t.id}" ${t.id===state.currentTermId?"selected":""}>${t.name}</option>`).join("")}</select></div>
    <div id="salBody"></div>
    <div class="no-print" style="margin-top:12px;" id="salExportHost"></div>`;
  await loadSalaryTracker();
}
async function loadSalaryTracker() {
  const termId = document.getElementById("salTermSelect").value;
  const body = document.getElementById("salBody");
  body.innerHTML = "Loading…";
  const { data: staff } = await sb.from("staff").select("id, staff_code, full_name, positions, salary_status").eq("is_active", true).order("full_name");
  const term = state.terms.find(t => t.id === termId);

  const rows = (staff || []).map(s => {
    // salary_status is keyed "<termId>_1" / "_2" / "_3" (Month 1-3 of
    // that term) — each a boolean, ticked independently. A month that
    // isn't paid simply stays unticked; nothing forces all-or-nothing.
    const months = [1,2,3].map(m => (s.salary_status || {})[`${termId}_${m}`] === true);
    const monthCells = months.map((paid, i) => `
      <td style="text-align:center;">
        <input type="checkbox" ${paid?"checked":""} onchange="setSalaryMonth('${s.id}','${termId}',${i+1},this.checked)" style="width:18px;height:18px;cursor:pointer;"/>
      </td>`).join("");
    const allPaid = months.every(Boolean);
    const nonePaid = months.every(v => !v);
    const badge = allPaid
      ? `<span class="badge badge-success">✔ Fully Paid</span>`
      : nonePaid
      ? `<span class="badge badge-danger">✘ Unpaid</span>`
      : `<span class="badge badge-warning">◐ Partial</span>`;
    return `<tr>
      <td class="name-cell">${s.full_name}</td>
      <td>${s.staff_code}</td>
      <td>${(s.positions||[]).join(", ")}</td>
      ${monthCells}
      <td>${badge}</td>
    </tr>`;
  }).join("");

  body.innerHTML = `<p style="color:var(--dash-muted);font-size:12px;">Tick each month of ${term?.name || "the term"} as it's paid. A month left unticked shows as not yet paid — months don't have to be paid in order.</p>
    <div style="overflow-x:auto;"><table class="data-table" id="salaryTable">
    <thead><tr><th>Name</th><th>Staff ID</th><th>Position(s)</th><th>Month 1</th><th>Month 2</th><th>Month 3</th><th>Status</th></tr></thead>
    <tbody>${rows}</tbody></table></div>`;

  document.getElementById("salExportHost").innerHTML = `
    <button class="btn" onclick="downloadBrandedPdf('Staff Salary Status','${(term?.name||"").replace(/'/g,"")} — ${(state.schoolSettings.current_session||"").replace(/'/g,"")}',document.getElementById('salaryTable').outerHTML,'Salary_Status_${(term?.name||"").replace(/\\s/g,"_")}.pdf')"><i class="fa-solid fa-file-pdf"></i> Download PDF</button>
    <button class="btn" onclick="downloadBrandedWord('Staff Salary Status','${(term?.name||"").replace(/'/g,"")} — ${(state.schoolSettings.current_session||"").replace(/'/g,"")}',document.getElementById('salaryTable').outerHTML,'Salary_Status_${(term?.name||"").replace(/\\s/g,"_")}.doc')"><i class="fa-solid fa-file-word"></i> Download Word</button>`;
}
async function setSalaryMonth(staffId, termId, monthIndex, paid) {
  const { data: current } = await sb.from("staff").select("salary_status").eq("id", staffId).single();
  const updated = { ...(current?.salary_status || {}), [`${termId}_${monthIndex}`]: paid };
  const { error } = await sb.from("staff").update({ salary_status: updated }).eq("id", staffId);
  if (error) { alert(error.message); return; }
  loadSalaryTracker();
}

// ============================================================
// BRANDED EXPORT UTILITY — reusable letter-headed PDF/Word export,
// used across Salary Tracker, Master List, Fees, and elsewhere.
// ============================================================
function buildLetterHeaderHtml(title, subtitle) {
  const s = state.schoolSettings;
  const today = new Date().toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
  return `
    <div style="display:flex;align-items:center;gap:16px;border-bottom:3px solid #228B2A;padding-bottom:14px;margin-bottom:16px;">
      ${s.school_logo_url ? `<img src="${s.school_logo_url}" style="width:64px;height:64px;object-fit:contain;" crossorigin="anonymous">` : ""}
      <div style="flex:1;text-align:center;">
        <div style="font-size:18px;font-weight:900;color:#228B2A;">${escapeHtml(s.school_name||"")}</div>
        <div style="font-size:11px;color:#666;">${escapeHtml(s.address||"")}</div>
      </div>
      ${s.secondary_logo_url ? `<img src="${s.secondary_logo_url}" style="width:64px;height:64px;object-fit:contain;" crossorigin="anonymous">` : ""}
    </div>
    <div style="text-align:center;margin-bottom:14px;">
      <div style="font-size:16px;font-weight:800;color:#222;text-transform:uppercase;letter-spacing:1px;">${escapeHtml(title)}</div>
      ${subtitle ? `<div style="font-size:12px;color:#666;margin-top:2px;">${escapeHtml(subtitle)}</div>` : ""}
      <div style="font-size:10px;color:#999;margin-top:4px;">Generated ${today}</div>
    </div>`;
}
function buildLetterPdfHtml(title, subtitle, bodyHtml) {
  return `<div style="width:794px;background:#fff;color:#222;font-family:Arial,sans-serif;font-size:12px;padding:30px 36px;box-sizing:border-box;">
    ${buildLetterHeaderHtml(title, subtitle)}
    <div>${bodyHtml}</div>
  </div>`;
}
async function downloadBrandedPdf(title, subtitle, bodyHtml, filename) {
  if (typeof html2canvas === "undefined") { alert("PDF library not loaded."); return; }
  const mount = document.createElement("div");
  mount.style.cssText = "position:fixed;top:0;left:-99999px;z-index:-1;background:#fff;";
  mount.innerHTML = buildLetterPdfHtml(title, subtitle, bodyHtml);
  document.body.appendChild(mount);
  await new Promise(r => setTimeout(r, 60));
  await Promise.all(Array.from(mount.querySelectorAll("img")).map(img => img.complete ? Promise.resolve() : new Promise(res => { img.onload = img.onerror = res; })));

  const canvas = await html2canvas(mount, { scale: 2, useCORS: true, allowTaint: true, logging: false, backgroundColor: "#ffffff" });
  document.body.removeChild(mount);

  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ unit: "mm", format: "a4", orientation: "portrait" });
  const pageW = 210, pageH = 297, margin = 8;
  const usableW = pageW - margin * 2;
  const imgWpx = canvas.width, imgHpx = canvas.height;
  const pxToMm = usableW / imgWpx;
  const pageHeightPx = (pageH - margin * 2) / pxToMm;

  let renderedPx = 0, first = true;
  while (renderedPx < imgHpx) {
    const sliceHeightPx = Math.min(pageHeightPx, imgHpx - renderedPx);
    const pageCanvas = document.createElement("canvas");
    pageCanvas.width = imgWpx;
    pageCanvas.height = sliceHeightPx;
    const ctx = pageCanvas.getContext("2d");
    ctx.drawImage(canvas, 0, renderedPx, imgWpx, sliceHeightPx, 0, 0, imgWpx, sliceHeightPx);
    const sliceData = pageCanvas.toDataURL("image/jpeg", 0.95);
    if (!first) doc.addPage();
    doc.addImage(sliceData, "JPEG", margin, margin, usableW, sliceHeightPx * pxToMm);
    renderedPx += sliceHeightPx;
    first = false;
  }
  doc.save(filename);
}
function downloadBrandedWord(title, subtitle, bodyHtml, filename) {
  const html = `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word" xmlns="http://www.w3.org/TR/REC-html40">
    <head><meta charset="utf-8"><title>${escapeHtml(title)}</title></head>
    <body style="font-family:Arial,sans-serif;">
      ${buildLetterHeaderHtml(title, subtitle)}
      ${bodyHtml}
    </body></html>`;
  const blob = new Blob(["\ufeff", html], { type: "application/msword" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
