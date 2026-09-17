// ============================================================
// CERTIFICATES & AWARDS — full design ported from the original
// app: landscape Student certificate (forest green/gold), landscape
// Teacher certificate (royal blue/silver), and portrait Testimonial
// certificate (navy Greek-key border, blackletter title, curved
// stamp text, wax seal). Signatures resolve live from Staff
// Directory the same way report cards do.
// ============================================================
async function renderCertificates() {
  const el = document.getElementById("panel-certificates");
  el.innerHTML = `
    <div class="page-header">
      <div class="page-header-text">
        <h1>Certificates &amp; Awards</h1>
        <p>Generate Best Student, custom student, staff, or testimonial certificates.</p>
      </div>
    </div>
    <div class="tab-bar">
      <button class="tab-bar-item" id="ctab-best" onclick="switchCertTab('best')">🏅 Best Student Awards</button>
      <button class="tab-bar-item" id="ctab-custom" onclick="switchCertTab('custom')">🎖️ Custom Student Certificate</button>
      <button class="tab-bar-item" id="ctab-teacher" onclick="switchCertTab('teacher')">📋 Staff Certificate</button>
      <button class="tab-bar-item" id="ctab-testimonial" onclick="switchCertTab('testimonial')">🎓 Testimonial Certificate</button>
    </div>

    <div id="cpanel-best" class="cert-panel">
      <div class="settings-card">
        <div class="settings-card-title">Best Student Certificates (All Sections)</div>
        <p style="font-size:12px;color:var(--dash-muted);">Picks the single highest annual average per section (Nursery, Primary, Junior Secondary, Senior Secondary) for the chosen term.</p>
        <div class="field"><label>Term (uses Annual Average on Third Term, term average otherwise)</label><select id="bestTermSelect">
          ${state.terms.map(t => `<option value="${t.id}" ${t.id===state.currentTermId?"selected":""}>${t.name}</option>`).join("")}</select></div>
        <button class="btn btn-green" onclick="generateBestStudentCertificates()">🏆 Generate Best Student Certificates</button>
      </div>
      <div id="best-student-certs-preview"></div>
    </div>

    <div id="cpanel-custom" class="cert-panel" style="display:none;">
      <div class="settings-card">
        <div class="settings-card-title">Custom Student Certificate</div>
        <div class="field"><label>Student Name</label><input id="cust-stu-name"/></div>
        <div class="field"><label>Class (optional label)</label><input id="cust-stu-class"/></div>
        <div class="field"><label>Section</label><select id="cust-stu-section">
          <option>Nursery</option><option>Primary</option><option>Junior Secondary</option><option>Senior Secondary</option>
        </select></div>
        <div class="field"><label>Award Purpose</label><input id="cust-stu-award" placeholder="e.g. Best in Mathematics"/></div>
        <div class="field"><label>Citation (optional)</label><input id="cust-stu-desc"/></div>
        <button class="btn btn-green" onclick="generateCustomStudentCert()">🎖️ Generate Certificate</button>
      </div>
      <div id="custom-student-preview"></div>
    </div>

    <div id="cpanel-teacher" class="cert-panel" style="display:none;">
      <div class="settings-card">
        <div class="settings-card-title">Staff Award Certificate</div>
        <div class="field"><label>Staff Name</label><input id="cust-tch-name"/></div>
        <div class="field"><label>Position/Role (optional label)</label><input id="cust-tch-role"/></div>
        <div class="field"><label>Section</label><select id="cust-tch-section">
          <option>Nursery</option><option>Primary</option><option>Junior Secondary</option><option>Senior Secondary</option>
        </select></div>
        <div class="field"><label>Award Title</label><input id="cust-tch-award" placeholder="e.g. Best Teacher Award"/></div>
        <div class="field"><label>Citation (optional)</label><input id="cust-tch-desc"/></div>
        <button class="btn btn-green" onclick="generateTeacherCert()">📋 Generate Staff Certificate</button>
      </div>
      <div id="teacher-cert-preview"></div>
    </div>

    <div id="cpanel-testimonial" class="cert-panel" style="display:none;">
      <div class="settings-card">
        <div class="settings-card-title">🎓 Automatic Testimonial Certificate</div>
        <p style="font-size:12px;color:var(--dash-muted);">Generates one testimonial per active student in every class marked "Graduating" in Manage Classes — Primary-category classes are signed by the Headmaster, JSS/SS-category by the Principal.</p>
        <button class="btn btn-green" onclick="generateTestimonialCertificates()">🎓 Generate Testimonial Certificates</button>
      </div>
      <div id="testimonial-certs-preview"></div>
    </div>`;
  switchCertTab("best");
}

function switchCertTab(tab) {
  ["best","custom","teacher","testimonial"].forEach(t => {
    document.getElementById(`cpanel-${t}`).style.display = t === tab ? "block" : "none";
    document.getElementById(`ctab-${t}`).classList.toggle("active", t === tab);
  });
}

// ---------- shared helpers ----------
function escapeHtml(str) {
  return String(str ?? "").replace(/[&<>"']/g, c => ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;" }[c]));
}

// Live-resolves the signing authority + Admin Officer for a section,
// exactly like the report card does: real staff row first, school
// settings fallback second.
async function getCertAuthority(isSecondary) {
  const s = state.schoolSettings;
  const authorityRole = isSecondary ? "Principal" : "Headmaster";
  const { data: authStaff } = await sb.from("staff").select("full_name, signature_url").contains("positions", [authorityRole]);
  const { data: officerStaff } = await sb.from("staff").select("full_name, signature_url").contains("positions", ["Admin Officer"]);
  const authorityName = (authStaff && authStaff[0]?.full_name) || s[`${authorityRole.toLowerCase()}_fallback_name`] || authorityRole;
  const authoritySig = (authStaff && authStaff[0]?.signature_url) || s[`${authorityRole.toLowerCase()}_fallback_sig_url`] || "";
  const fmName = (officerStaff && officerStaff[0]?.full_name) || s.admin_officer_fallback_name || "Admin Officer";
  const fmSig = (officerStaff && officerStaff[0]?.signature_url) || s.admin_officer_fallback_sig_url || "";
  return { authorityName, authoritySig, authorityTitle: isSecondary ? "Principal" : "Head Teacher", fmName, fmSig };
}

// ---------- Student certificate (landscape, green/gold) ----------
async function buildStudentCertHTML(opts) {
  const isSecondary = opts.section === "Junior Secondary" || opts.section === "Senior Secondary";
  const auth = await getCertAuthority(isSecondary);
  const s = state.schoolSettings;
  const today = new Date().toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
  return `
  <div class="cert-wrapper">
  <div class="cert-landscape cert-student" id="cert-stu-${opts._id ?? "x"}">
    <div class="cert-watermark"><img src="${s.school_logo_url||""}" alt=""></div>
    <span class="cert-corner-ornament" style="top:16px;left:16px;">❋</span>
    <span class="cert-corner-ornament" style="top:16px;right:16px;">❋</span>
    <span class="cert-corner-ornament" style="bottom:16px;left:16px;">❋</span>
    <span class="cert-corner-ornament" style="bottom:16px;right:16px;">❋</span>
    <div class="cert-inner-border-student"></div>
    <div class="cert-content">
      <div class="cert-header-row">
        <img class="cert-logo" src="${s.school_logo_url||""}" alt="School Logo" onerror="this.style.display='none'">
        <div>
          <div class="cert-school-name">${escapeHtml(s.school_name)}</div>
          <div class="cert-school-sub">${escapeHtml(s.motto||"")} &nbsp;|&nbsp; ${escapeHtml(s.address||"")}</div>
        </div>
        <img class="cert-logo" src="${s.secondary_logo_url||""}" alt="Secondary Logo" onerror="this.style.display='none'">
      </div>
      <hr class="cert-divider-student">
      <div class="cert-medal-student">🏆</div>
      <div class="cert-award-title-student">Certificate of Excellence</div>
      <div class="cert-of-excellence">${escapeHtml(opts.awardTitle)}</div>
      <div class="cert-presented-to">This Certificate is Proudly Presented To</div>
      <div class="cert-recipient-student">${escapeHtml(opts.name)}</div>
      ${opts.className ? `<div class="cert-class-row">Class: <strong>${escapeHtml(opts.className)}</strong> &nbsp;|&nbsp; Section: <strong>${escapeHtml(opts.section)}</strong></div>` : ""}
      ${opts.annualAvg ? `<div class="cert-purpose">Annual Average: <strong style="color:#228B2A;">${opts.annualAvg}%</strong></div>` : ""}
      <div class="cert-citation">${escapeHtml(opts.citation || "In recognition of outstanding academic performance and dedication to excellence.")}</div>
      <div class="cert-session">Academic Session: ${escapeHtml(s.current_session||"")} &nbsp;&nbsp; Date: ${today}</div>
      <div class="cert-sigs-row">
        <div class="cert-sig-block">
          <img class="cert-sig-img" src="${auth.fmSig}" alt="Admin Officer Sig" onerror="this.style.display='none'">
          <div class="cert-sig-line"></div>
          <div class="cert-sig-name">${escapeHtml(auth.fmName)}</div>
          <div class="cert-sig-title">Admin Officer</div>
        </div>
        <div class="cert-sig-block" style="font-size:28px;">🏅</div>
        <div class="cert-sig-block">
          <img class="cert-sig-img" src="${auth.authoritySig}" alt="Authority Sig" onerror="this.style.display='none'">
          <div class="cert-sig-line"></div>
          <div class="cert-sig-name">${escapeHtml(auth.authorityName)}</div>
          <div class="cert-sig-title">${escapeHtml(auth.authorityTitle)}</div>
        </div>
      </div>
    </div>
  </div>
  </div>`;
}

// ---------- Teacher/Staff certificate (landscape, blue/silver) ----------
async function buildTeacherCertHTML(opts) {
  const isSecondary = opts.section === "Junior Secondary" || opts.section === "Senior Secondary";
  const auth = await getCertAuthority(isSecondary);
  const s = state.schoolSettings;
  const { data: headStaff } = await sb.from("staff").select("full_name, signature_url").contains("positions", ["Headmaster"]);
  const headName = (headStaff && headStaff[0]?.full_name) || s.headmaster_fallback_name || "Headmaster";
  const headSig = (headStaff && headStaff[0]?.signature_url) || s.headmaster_fallback_sig_url || "";
  const today = new Date().toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
  return `
  <div class="cert-wrapper">
  <div class="cert-landscape cert-teacher" id="cert-tch-${opts._id ?? "x"}">
    <div class="cert-watermark"><img src="${s.school_logo_url||""}" alt=""></div>
    <span class="cert-corner-ornament" style="top:16px;left:16px;color:#1d4ed8;">✦</span>
    <span class="cert-corner-ornament" style="top:16px;right:16px;color:#1d4ed8;">✦</span>
    <span class="cert-corner-ornament" style="bottom:16px;left:16px;color:#1d4ed8;">✦</span>
    <span class="cert-corner-ornament" style="bottom:16px;right:16px;color:#1d4ed8;">✦</span>
    <div class="cert-inner-border-teacher"></div>
    <div class="cert-content">
      <div class="cert-header-row">
        <img class="cert-logo" src="${s.school_logo_url||""}" alt="School Logo" onerror="this.style.display='none'">
        <div>
          <div class="cert-school-name">${escapeHtml(s.school_name)}</div>
          <div class="cert-school-sub">${escapeHtml(s.motto||"")} &nbsp;|&nbsp; ${escapeHtml(s.address||"")}</div>
        </div>
        <img class="cert-logo" src="${s.secondary_logo_url||""}" alt="Secondary Logo" onerror="this.style.display='none'">
      </div>
      <hr class="cert-divider-teacher">
      <div class="cert-medal-teacher">🎖️</div>
      <div class="cert-award-title-teacher">Staff Award Certificate</div>
      <div class="cert-of-excellence" style="color:#1d4ed8;">${escapeHtml(opts.awardTitle)}</div>
      <div class="cert-presented-to">This Award is Proudly Presented To</div>
      <div class="cert-recipient-teacher">${escapeHtml(opts.name)}</div>
      ${opts.role ? `<div class="cert-class-row">Position: <strong>${escapeHtml(opts.role)}</strong> &nbsp;|&nbsp; Section: <strong>${escapeHtml(opts.section)}</strong></div>` : ""}
      <div class="cert-citation">${escapeHtml(opts.citation || "In recognition of exceptional dedication to teaching and outstanding contributions to the school community.")}</div>
      <div class="cert-session">Academic Session: ${escapeHtml(s.current_session||"")} &nbsp;&nbsp; Date: ${today}</div>
      <div class="cert-sigs-row">
        <div class="cert-sig-block">
          <img class="cert-sig-img" src="${auth.authoritySig}" alt="Principal Sig" onerror="this.style.display='none'">
          <div class="cert-sig-line"></div>
          <div class="cert-sig-name">${escapeHtml(auth.authorityName)}</div>
          <div class="cert-sig-title">${escapeHtml(auth.authorityTitle)}</div>
        </div>
        <div class="cert-sig-block" style="font-size:28px;">⭐</div>
        <div class="cert-sig-block">
          <img class="cert-sig-img" src="${headSig}" alt="Head Sig" onerror="this.style.display='none'">
          <div class="cert-sig-line"></div>
          <div class="cert-sig-name">${escapeHtml(headName)}</div>
          <div class="cert-sig-title">Head Teacher</div>
        </div>
      </div>
    </div>
  </div>
  </div>`;
}

// ---------- Testimonial certificate helpers ----------
function computeTestimonialDates(spanYears) {
  const now = new Date();
  const toYear = now.getFullYear();
  const fromYear = toYear - (spanYears || 1);
  const dd = String(now.getDate()).padStart(2, "0");
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  return { fromYear, toYear, dateShort: `${dd}/${mm}/${toYear}` };
}
function generateSealSVG(color) {
  color = color || "#C0272D";
  const bumps = 20, rOuter = 46, rInner = 40, cx = 50, cy = 50;
  const pts = [];
  for (let i = 0; i < bumps * 2; i++) {
    const r = (i % 2 === 0) ? rOuter : rInner;
    const angle = (Math.PI * 2 * i) / (bumps * 2) - Math.PI / 2;
    pts.push(`${(cx + r * Math.cos(angle)).toFixed(1)},${(cy + r * Math.sin(angle)).toFixed(1)}`);
  }
  return `<svg class="cert-testi-seal-svg" viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg"><polygon points="${pts.join(" ")}" fill="${color}"/></svg>`;
}
function curvedStampText(text, radius, fontSize, color) {
  radius = radius || 44; fontSize = fontSize || 8; color = color || "#2a4d9e";
  const chars = (text || "").split("");
  const totalArc = Math.min(150, chars.length * 13);
  const start = -totalArc / 2;
  const step = chars.length > 1 ? totalArc / (chars.length - 1) : 0;
  const spans = chars.map((ch, i) => {
    const angle = start + step * i;
    return `<span style="position:absolute;left:50%;top:50%;font-size:${fontSize}px;font-weight:800;color:${color};font-family:'Manrope',sans-serif;transform:translate(-50%,-50%) rotate(${angle.toFixed(2)}deg) translateY(-${radius}px);">${escapeHtml(ch)}</span>`;
  }).join("");
  return `<div class="cert-testi-stamp-curved-text">${spans}</div>`;
}
function curvedStampStars(count, radius, fontSize, color) {
  count = count || 5; radius = radius || 40; fontSize = fontSize || 8; color = color || "#2a4d9e";
  const totalArc = 90;
  const start = 180 - totalArc / 2;
  const step = count > 1 ? totalArc / (count - 1) : 0;
  const spans = [];
  for (let i = 0; i < count; i++) {
    const angle = start + step * i;
    spans.push(`<span style="position:absolute;left:50%;top:50%;font-size:${fontSize}px;color:${color};transform:translate(-50%,-50%) rotate(${angle.toFixed(2)}deg) translateY(-${radius}px) rotate(180deg);">★</span>`);
  }
  return `<div class="cert-testi-stamp-stars">${spans.join("")}</div>`;
}

// opts: { _id, name, classArm, admissionNo, fromYear, toYear, dateShort,
//         isSecondary, authorityName, authoritySig, signLabel }
function buildTestimonialCertHTML(opts) {
  const s = state.schoolSettings;
  const name = opts.name || "Unnamed Student";
  const firstName = name.trim().split(/\s+/)[0] || name;
  const schoolName = s.school_name || "THE SCHOOL";
  const completionLine1 = opts.isSecondary ? "Has Completed His/Her Junior Secondary School Education" : "Has Completed His/Her Primary School Education";
  const completionLine2 = opts.isSecondary ? "From the above mentioned School, and is registered for the BECE" : "From the above mentioned School";
  const signLabel = opts.signLabel || (opts.isSecondary ? "PRINCIPAL'S SIGN" : "HEADTEACHER'S SIGN");
  return `
  <div class="cert-portrait-wrapper">
  <div class="cert-testimonial" id="cert-tst-${opts._id ?? "x"}">
    <div class="cert-gk-strip-top"></div><div class="cert-gk-strip-bottom"></div>
    <div class="cert-gk-strip-left"></div><div class="cert-gk-strip-right"></div>
    <div class="cert-gk-corner" style="top:0;left:0;"></div>
    <div class="cert-gk-corner" style="top:0;right:0;"></div>
    <div class="cert-gk-corner" style="bottom:0;left:0;"></div>
    <div class="cert-gk-corner" style="bottom:0;right:0;"></div>
    <div class="cert-testimonial-inner">
      <div class="cert-testi-bracket tl"></div><div class="cert-testi-bracket tr"></div>
      <div class="cert-testi-bracket bl"></div><div class="cert-testi-bracket br"></div>
      <div class="cert-testi-passport-mark"><div class="l1"></div><div class="l2"></div><div class="txt">PASSPORT</div></div>
      <div class="cert-testi-header-row">
        <div class="cert-testi-school-name">${escapeHtml(schoolName)}</div>
        ${s.address ? `<div class="cert-testi-school-sub">${escapeHtml(s.address)}</div>` : ""}
      </div>
      <div class="cert-testi-title">Testimonial</div>
      <div class="cert-testi-title-underline"></div>
      <div class="cert-testi-whom">To whom it may Concern</div>
      <div class="cert-testi-certify">This is to Certify that:</div>
      <div class="cert-testi-name">${escapeHtml(name.toUpperCase())}</div>
      ${opts.classArm ? `<div class="cert-testi-classarm">${escapeHtml(opts.classArm)}${opts.admissionNo ? " &nbsp;|&nbsp; Admission No: " + escapeHtml(opts.admissionNo) : ""}</div>` : ""}
      <div class="cert-testi-line">${completionLine1}</div>
      <div class="cert-testi-line">${completionLine2}</div>
      <div class="cert-testi-yearrow">From the year: <b>${opts.fromYear}</b> &nbsp;&nbsp; To: <b>${opts.toYear}</b></div>
      <div class="cert-testi-conduct">And His/Her conduct was: <b>GOOD</b> during His/Her stay<br>in the School.</div>
      <div class="cert-testi-namesign-row">
        <div>Name:<span class="field-line">${escapeHtml(firstName.toUpperCase())}</span></div>
        <div>Sign:<span class="field-line">&nbsp;</span></div>
      </div>
      <div class="cert-testi-seals-row">
        <div class="cert-testi-stamp-block">
          <div class="cert-testi-stamp-circle">
            <div class="cert-testi-stamp-circle-dotted"></div>
            ${curvedStampText(schoolName.toUpperCase())}
            ${curvedStampStars()}
            <div style="display:flex;flex-direction:column;align-items:center;">
              <img class="cert-testi-stamp-sig" src="${opts.authoritySig||""}" alt="" onerror="this.style.display='none'">
              <div class="cert-testi-stamp-date">DATE: ${opts.dateShort}</div>
            </div>
          </div>
          <div class="cert-testi-stamp-label">STAMP</div>
        </div>
        <div style="text-align:center;">${generateSealSVG()}</div>
        <div class="cert-testi-sig-block">
          <img class="cert-testi-sig-img" src="${opts.authoritySig||""}" alt="Signature" onerror="this.style.display='none'">
          <div class="cert-testi-sig-line"></div>
          <div class="cert-testi-sig-title">${escapeHtml(signLabel)}</div>
        </div>
      </div>
    </div>
  </div>
  </div>`;
}

// ---------- Best Student generator ----------
const CATEGORY_TO_SECTION = { primary: "Primary" };
async function generateBestStudentCertificates() {
  const preview = document.getElementById("best-student-certs-preview");
  preview.innerHTML = `<p style="color:var(--dash-muted);font-size:12px;">⏳ Loading best students…</p>`;
  const termId = document.getElementById("bestTermSelect").value;
  const term = state.terms.find(t => t.id === termId);
  const isThirdTerm = (term?.name || "").toLowerCase().includes("third");

  const { data: summaries } = await sb.from("student_term_summary")
    .select("student_id, average, annual_average, class_id, students(full_name, classes(name, category))")
    .eq("term_id", termId);

  const bestBySection = {};
  (summaries || []).forEach(row => {
    const category = row.students?.classes?.category;
    const section = CATEGORY_TO_SECTION[category];
    if (!section) return;
    const scoreValue = isThirdTerm && row.annual_average != null ? row.annual_average : row.average;
    if (scoreValue == null) return;
    if (!bestBySection[section] || scoreValue > bestBySection[section].score) {
      bestBySection[section] = { score: scoreValue, name: row.students.full_name, className: row.students.classes.name };
    }
  });

  const sections = ["Primary"];
  preview.innerHTML = "";
  for (let i = 0; i < sections.length; i++) {
    const sec = sections[i];
    const b = bestBySection[sec];
    const container = document.createElement("div");
    container.style.marginBottom = "24px";
    if (!b) {
      container.innerHTML = `<div class="settings-card" style="color:var(--dash-muted);">⚠️ No score data yet for ${sec} section this term.</div>`;
      preview.appendChild(container);
      continue;
    }
    const certHtml = await buildStudentCertHTML({
      _id: i, name: b.name, className: b.className, section: sec,
      awardTitle: isThirdTerm ? "Best Student of the Year" : `Best Student — ${term?.name || ""}`,
      citation: `In recognition of outstanding academic performance with ${isThirdTerm ? "an annual average" : "a term average"} of ${b.score}% ${isThirdTerm ? `across all terms of the ${state.schoolSettings.current_session} academic session` : `in ${term?.name || "this term"}`}.`,
      annualAvg: b.score,
    });
    container.innerHTML = `<div style="font-size:12px;font-weight:800;color:var(--dash-muted);margin-bottom:8px;text-transform:uppercase;">🏆 ${sec} — Best Student</div>${certHtml}
      <div style="margin-top:8px;text-align:center;" class="no-print">
        <button class="btn btn-green" onclick="downloadCertPDF('cert-stu-${i}','BestStudent_${sec.replace(/\s/g,"_")}_${b.name.replace(/\s/g,"_")}.pdf','landscape')">📄 Download PDF</button>
      </div>`;
    preview.appendChild(container);
  }
  if (Object.keys(bestBySection).length) {
    preview.insertAdjacentHTML("beforeend", `<div class="no-print" style="text-align:center;margin-top:12px;"><button class="btn" onclick="printAllCerts('best-student-certs-preview','landscape')"><i class="fa-solid fa-print"></i> Print All</button></div>`);
  }
}

// ---------- Custom certificates ----------
async function generateCustomStudentCert() {
  const name = document.getElementById("cust-stu-name").value.trim();
  const cls = document.getElementById("cust-stu-class").value.trim();
  const section = document.getElementById("cust-stu-section").value;
  const award = document.getElementById("cust-stu-award").value.trim();
  const desc = document.getElementById("cust-stu-desc").value.trim();
  if (!name) { alert("Please enter the student name."); return; }
  if (!award) { alert("Please enter the award purpose."); return; }
  const html = await buildStudentCertHTML({ _id: "c1", name, className: cls, section, awardTitle: award, citation: desc });
  document.getElementById("custom-student-preview").innerHTML = html + `
    <div class="no-print" style="text-align:center;margin-top:14px;"><button class="btn btn-green" onclick="downloadCertPDF('cert-stu-c1','Award_${name.replace(/\s/g,"_")}.pdf','landscape')">📄 Download PDF</button></div>`;
}
async function generateTeacherCert() {
  const name = document.getElementById("cust-tch-name").value.trim();
  const role = document.getElementById("cust-tch-role").value.trim();
  const section = document.getElementById("cust-tch-section").value;
  const award = document.getElementById("cust-tch-award").value.trim();
  const desc = document.getElementById("cust-tch-desc").value.trim();
  if (!name) { alert("Please enter the staff name."); return; }
  if (!award) { alert("Please enter the award title."); return; }
  const html = await buildTeacherCertHTML({ _id: "t1", name, role, section, awardTitle: award, citation: desc });
  document.getElementById("teacher-cert-preview").innerHTML = html + `
    <div class="no-print" style="text-align:center;margin-top:14px;"><button class="btn btn-green" onclick="downloadCertPDF('cert-tch-t1','Award_${name.replace(/\s/g,"_")}.pdf','landscape')">📄 Download PDF</button></div>`;
}

// ---------- Testimonial generator (all classes marked "Graduating") ----------
async function generateTestimonialCertificates() {
  const preview = document.getElementById("testimonial-certs-preview");
  preview.innerHTML = `<p style="color:var(--dash-muted);font-size:12px;">⏳ Loading graduating classes…</p>`;
  const { data: gradClasses } = await sb.from("classes").select("*").eq("is_graduating_class", true).order("sort_order");
  if (!gradClasses || !gradClasses.length) {
    preview.innerHTML = `<p style="color:var(--dash-muted);">No classes are marked "Graduating" yet — set this in Manage Classes.</p>`;
    return;
  }

  let idCounter = 0;
  let html = "";
  for (const cls of gradClasses) {
    const isSecondary = false;
    const spanYears = 6;
    const auth = await getCertAuthority(isSecondary);
    const signLabel = isSecondary ? "PRINCIPAL'S SIGN" : "HEADTEACHER'S SIGN";
    const { fromYear, toYear, dateShort } = computeTestimonialDates(spanYears);

    const { data: students } = await sb.from("students").select("id, full_name, admission_no").eq("class_id", cls.id).eq("is_active", true).order("full_name");
    if (!students || !students.length) {
      html += `<div class="settings-card" style="color:var(--dash-muted);">⚠️ No active students in ${escapeHtml(cls.name)}.</div>`;
      continue;
    }
    html += `<div style="font-size:12px;font-weight:800;color:var(--dash-muted);margin:14px 0;text-transform:uppercase;">🎓 ${students.length} ${escapeHtml(cls.name)} Graduating Student(s)</div>`;
    for (const stu of students) {
      const id = idCounter++;
      html += `<div style="margin-bottom:30px;">` +
        buildTestimonialCertHTML({ _id: id, name: stu.full_name, classArm: cls.name, admissionNo: stu.admission_no, fromYear, toYear, dateShort, isSecondary, authoritySig: auth.authoritySig, signLabel }) +
        `<div style="margin-top:8px;text-align:center;" class="no-print">
          <button class="btn btn-green" onclick="downloadCertPDF('cert-tst-${id}','Testimonial_${stu.full_name.replace(/\s/g,"_")}.pdf','portrait')">📄 Download</button>
        </div></div>`;
    }
  }
  preview.innerHTML = html + (idCounter > 0 ? `<div class="no-print" style="text-align:center;margin-top:12px;"><button class="btn" onclick="printAllCerts('testimonial-certs-preview','portrait')"><i class="fa-solid fa-print"></i> Print All</button></div>` : "");
}

// ---------- Download / print helpers (html2canvas + jsPDF) ----------
function waitForImages(el) {
  const imgs = el.querySelectorAll("img");
  return Promise.all(Array.from(imgs).map(img => img.complete ? Promise.resolve() : new Promise(res => { img.onload = img.onerror = res; })));
}
async function downloadCertPDF(elementId, filename, orientation) {
  const el = document.getElementById(elementId);
  if (!el || typeof html2canvas === "undefined") { alert("PDF library not loaded."); return; }
  await waitForImages(el);
  const canvas = await html2canvas(el, { scale: 2, useCORS: true, allowTaint: true, logging: false, backgroundColor: "#ffffff" });
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ unit: "mm", format: "a4", orientation: orientation || "landscape" });
  const pageW = orientation === "portrait" ? 210 : 297;
  const pageH = orientation === "portrait" ? 297 : 210;
  const margin = 6, cW = pageW - margin * 2, cH = pageH - margin * 2;
  const imgData = canvas.toDataURL("image/jpeg", 0.98);
  const ratio = Math.min(cW / (canvas.width / 3.78), cH / (canvas.height / 3.78));
  const drawW = (canvas.width / 3.78) * ratio, drawH = (canvas.height / 3.78) * ratio;
  doc.addImage(imgData, "JPEG", margin + (cW - drawW) / 2, margin + (cH - drawH) / 2, drawW, drawH);
  doc.save(filename);
}
async function printAllCerts(containerId, orientation) {
  const container = document.getElementById(containerId);
  const wrappers = container.querySelectorAll(".cert-wrapper, .cert-portrait-wrapper");
  if (!wrappers.length) { alert("Nothing to print yet."); return; }
  document.querySelectorAll(".cert-print-clone").forEach(n => n.remove());
  const printRoot = document.createElement("div");
  printRoot.className = "cert-print-clone";
  wrappers.forEach(w => {
    const clone = w.cloneNode(true);
    clone.classList.add("cert-print-page");
    printRoot.appendChild(clone);
  });
  document.body.appendChild(printRoot);
  document.body.classList.add("printing-certs");
  await Promise.all(Array.from(wrappers).map(waitForImages));
  setTimeout(() => {
    window.print();
    setTimeout(() => { printRoot.remove(); document.body.classList.remove("printing-certs"); }, 1000);
  }, 300);
}

// ============================================================
// ANALYTICS
// ============================================================
async function renderAnalytics() {
  const el = document.getElementById("panel-analytics");
  el.innerHTML = `<div class="field"><label>Term</label><select id="anTermSelect" onchange="loadAnalytics()">
    ${state.terms.map(t => `<option value="${t.id}" ${t.id===state.currentTermId?"selected":""}>${t.name}</option>`).join("")}</select></div>
    <div id="anBody"></div>`;
  await loadAnalytics();
}
async function loadAnalytics() {
  const termId = document.getElementById("anTermSelect").value;
  const term = state.terms.find(t => t.id === termId);
  const body = document.getElementById("anBody");
  body.innerHTML = "Loading…";
  const { data: rows } = await sb.from("student_term_summary").select("class_id, average, classes(name)").eq("term_id", termId);
  const byClass = {};
  (rows||[]).forEach(r => {
    const key = r.classes?.name || "Unknown";
    byClass[key] = byClass[key] || { total: 0, count: 0, pass: 0 };
    byClass[key].total += r.average || 0;
    byClass[key].count += 1;
    if ((r.average||0) >= 40) byClass[key].pass += 1;
  });
  const classNames = Object.keys(byClass).sort();
  const avgs = classNames.map(name => byClass[name].count ? +(byClass[name].total/byClass[name].count).toFixed(1) : 0);
  const passRates = classNames.map(name => byClass[name].count ? Math.round((byClass[name].pass/byClass[name].count)*100) : 0);

  body.innerHTML = `<div class="kpi-grid">${classNames.map(name => {
    const d = byClass[name];
    const avg = d.count ? (d.total/d.count).toFixed(1) : "—";
    return kpiCard("fa-chart-simple", avg, `${name} — Class Average`) ;
  }).join("")}</div>
  <div class="settings-card" style="margin-top:16px;">
    <div class="settings-card-title">Class Average by Class</div>
    <canvas id="anAvgChart" height="90"></canvas>
  </div>
  <div class="settings-card" style="margin-top:16px;">
    <div class="settings-card-title">Pass Rate (≥40) by Class</div>
    <canvas id="anPassChart" height="90"></canvas>
  </div>
  <div style="margin-top:16px;overflow-x:auto;"><table class="data-table" id="analyticsTable">
    <thead><tr><th>Class</th><th>Students Scored</th><th>Class Average</th><th>Pass Rate (≥40)</th></tr></thead>
    <tbody>${classNames.map(name => { const d = byClass[name]; const avg = d.count?(d.total/d.count).toFixed(1):"—"; const pr = d.count?Math.round((d.pass/d.count)*100):0;
      return `<tr><td class="name-cell">${name}</td><td>${d.count}</td><td>${avg}</td><td>${pr}%</td></tr>`; }).join("")}</tbody></table></div>
  <div class="no-print" style="display:flex;gap:8px;flex-wrap:wrap;margin-top:12px;">
    <button class="btn" onclick="window.print()"><i class="fa-solid fa-print"></i> Print</button>
    <button class="btn" onclick="downloadBrandedPdf('Analytics','${(term?.name||"").replace(/'/g,"")} — ${(state.schoolSettings.current_session||"").replace(/'/g,"")}',document.getElementById('analyticsTable').outerHTML,'Analytics_${(term?.name||"").replace(/\s/g,"_")}.pdf')"><i class="fa-solid fa-file-pdf"></i> Download PDF</button>
    <button class="btn" onclick="downloadBrandedWord('Analytics','${(term?.name||"").replace(/'/g,"")} — ${(state.schoolSettings.current_session||"").replace(/'/g,"")}',document.getElementById('analyticsTable').outerHTML,'Analytics_${(term?.name||"").replace(/\s/g,"_")}.doc')"><i class="fa-solid fa-file-word"></i> Download Word</button>
  </div>`;

  if (typeof Chart === "undefined") return;
  if (state._anAvgChart) state._anAvgChart.destroy();
  if (state._anPassChart) state._anPassChart.destroy();
  const goldGreen = getComputedStyle(document.documentElement).getPropertyValue("--dash-green").trim() || "#C9973F";
  state._anAvgChart = new Chart(document.getElementById("anAvgChart"), {
    type: "bar",
    data: { labels: classNames, datasets: [{ label: "Class Average", data: avgs, backgroundColor: goldGreen }] },
    options: { responsive: true, plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true, max: 100 } } }
  });
  state._anPassChart = new Chart(document.getElementById("anPassChart"), {
    type: "bar",
    data: { labels: classNames, datasets: [{ label: "Pass Rate %", data: passRates, backgroundColor: "#5B7B4F" }] },
    options: { responsive: true, plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true, max: 100 } } }
  });
}

// ============================================================
// CA TRACKER — score-entry completion per class/subject/term
// ============================================================
async function renderCaTracker() {
  const el = document.getElementById("panel-catracker");
  el.innerHTML = `
    <div class="page-header">
      <div class="page-header-text">
        <h1>CA Tracker</h1>
        <p>How much of each class's scores have been entered for the term below.</p>
      </div>
    </div>
    <div class="field" style="max-width:280px;"><label>Term</label><select id="caTermSelect" onchange="loadCaTracker()">
    ${state.terms.map(t => `<option value="${t.id}" ${t.id===state.currentTermId?"selected":""}>${t.name}</option>`).join("")}</select></div>
    <div id="caBody"></div>`;
  await loadCaTracker();
}
function progressBarHtml(pct) {
  const cls = pct >= 80 ? "" : pct >= 40 ? "mid" : "low";
  return `<div class="progress-row"><div class="progress-track"><div class="progress-fill ${cls}" style="width:${pct}%;"></div></div><span class="progress-pct">${pct}%</span></div>`;
}
async function loadCaTracker() {
  const termId = document.getElementById("caTermSelect").value;
  const body = document.getElementById("caBody");
  body.innerHTML = "Loading…";
  const rowsHtml = [];
  for (const cls of state.classes) {
    const [{ count: studentCount }, { data: classSubjects }] = await Promise.all([
      sb.from("students").select("id", { count: "exact", head: true }).eq("class_id", cls.id).eq("is_active", true),
      sb.from("class_subjects").select("subject_id").eq("class_id", cls.id),
    ]);
    const subjectCount = (classSubjects||[]).length;
    const expected = (studentCount||0) * subjectCount;
    const { count: entered } = await sb.from("student_scores").select("*", { count: "exact", head: true }).eq("class_id", cls.id).eq("term_id", termId);
    const pct = expected ? Math.round(((entered||0)/expected)*100) : 0;
    rowsHtml.push(`<tr><td class="name-cell">${cls.name}</td><td>${studentCount||0}</td><td>${subjectCount}</td><td>${entered||0}/${expected}</td><td style="min-width:140px;">${progressBarHtml(pct)}</td></tr>`);
  }
  body.innerHTML = `<div style="overflow-x:auto;"><table class="data-table">
    <thead><tr><th>Class</th><th>Students</th><th>Subjects</th><th>Scores Entered</th><th>Completion</th></tr></thead>
    <tbody>${rowsHtml.join("")}</tbody></table></div>`;
}
