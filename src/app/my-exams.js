/* ===============================================================
   Exams & tests (student) — one question at a time, with a timer.

   Ports the Pariya Central student flow, with the security holes
   closed: the correct answers are never sent to this page, the
   deadline shown here is the one the server stored, and the score
   comes back from submit_assessment_attempt(). If the timer runs out
   the page submits, but a student who defeats the timer gains
   nothing — the server marks a late submission as late.
   =============================================================== */

import { h, mount, skeleton, setBusy } from "../lib/dom.js";
import { page, requireRole } from "./shell.js";
import { supabase } from "../lib/supabase.js";
import { unwrap, humanError, logError } from "../lib/errors.js";
import { emptyState, errorState, confirmAction, toastError, inlineAlert } from "../lib/ui.js";
import { fetchActiveTerm } from "../lib/data.js";
import { onDataChanged } from "../lib/realtime.js";

export default async function render({ outlet }) {
  if (!requireRole(outlet, "student")) return;

  const state = { term: null, kind: "test", list: [], attempt: null, timer: null };
  const body = h("div.u-stack");
  mount(outlet, page({ title: "Exams & tests", subtitle: "What is open for your class right now.", body }));

  try {
    state.term = await fetchActiveTerm();
  } catch (err) {
    logError("my-exams boot", err);
    return mount(body, errorState(humanError(err)));
  }
  if (!state.term) return mount(body, emptyState({ title: "No active term", body: "Your school has not started a term yet." }));

  onDataChanged(() => { if (!state.attempt) loadList(); });
  await loadList();

  async function loadList() {
    stopTimer();
    state.attempt = null;
    mount(body, skeleton(4));
    try {
      state.list = unwrap(await supabase.rpc("get_my_available_assessments", {
        p_kind: state.kind, p_term_id: state.term.id,
      }), "available assessments");
      drawList();
    } catch (err) {
      logError("load assessments", err);
      mount(body, errorState(humanError(err), loadList));
    }
  }

  function drawList() {
    const tabs = h("div.u-row", { style: { gap: "8px", marginBottom: "12px" } },
      tabBtn("test", "Tests (CA)"), tabBtn("exam", "Examinations"));

    mount(body, tabs, state.list.length
      ? h("div.u-stack", {}, state.list.map(card))
      : emptyState({ title: "Nothing open", body: "There is no test or examination open for your class right now." }));
  }

  function tabBtn(kind, label) {
    return h(`button.btn.${state.kind === kind ? "btn-primary" : "btn-outline"}.btn-sm`, {
      type: "button", text: label,
      onclick: () => { state.kind = kind; loadList(); },
    });
  }

  function card(a) {
    const done = a.my_attempt_status === "submitted";
    const open = a.effective_status === "active";
    let status;
    if (done) status = h("span.badge.badge-ok", { text: `Completed — ${a.my_score} / ${a.my_total}` });
    else if (open) status = h("span.badge.badge-ok", { text: "Open now" });
    else if (a.effective_status === "scheduled") status = h("span.badge.badge-warn", { text: `Opens ${new Date(a.start_at).toLocaleString()}` });
    else status = h("span.badge", { text: "Not available" });

    return h("div.card", {},
      h("div.u-row", { style: { justifyContent: "space-between", gap: "12px", flexWrap: "wrap" } },
        h("div.u-grow", {},
          h("div", { style: { fontWeight: "600" }, text: a.subject_name }),
          h("div.u-xs.u-muted", { text: a.title }),
          h("div.u-xs.u-muted", {
            text: `${a.question_count} question${Number(a.question_count) === 1 ? "" : "s"} · ${a.total_marks} marks${a.duration_minutes ? ` · ${a.duration_minutes} minutes` : " · untimed"}`,
          }),
        ),
        h("div", {}, status),
      ),
      open && !done
        ? h("div.u-row", { style: { justifyContent: "flex-end", marginTop: "10px" } },
            h("button.btn.btn-primary.btn-sm", { type: "button", text: "Start", onclick: (e) => begin(e.target, a) }))
        : null,
    );
  }

  async function begin(btn, a) {
    const ok = await confirmAction({
      title: `Start ${a.title}?`,
      message: `${a.subject_name} · ${a.question_count} questions · ${a.total_marks} marks${a.duration_minutes ? `\n\nYou will have ${a.duration_minutes} minutes once you start.` : ""}\n\nYou get one attempt. Your answers are kept as you move between questions.`,
      confirmLabel: "Start now",
    });
    if (!ok) return;

    setBusy(btn, true, "Starting…");
    try {
      const startRows = unwrap(await supabase.rpc("start_assessment_attempt", { p_assessment_id: a.assessment_id }), "start attempt");
      const started = Array.isArray(startRows) ? startRows[0] : startRows;
      const questions = unwrap(await supabase.rpc("get_attempt_questions", { p_attempt_id: started.out_attempt_id }), "attempt questions");

      state.attempt = {
        id: started.out_attempt_id,
        title: started.out_title,
        totalMarks: started.out_total_marks,
        deadline: started.out_deadline_at ? new Date(started.out_deadline_at) : null,
        questions, index: 0, saveNote: "",
        // Answers already saved on the server come back with the questions,
        // so refreshing the page or coming back later loses nothing.
        answers: Object.fromEntries(questions.filter((q) => q.saved_option).map((q) => [q.question_id, q.saved_option])),
      };
      drawQuestion();
      if (state.attempt.deadline) startTimer();
    } catch (err) {
      toastError(humanError(err, "That assessment could not be started."));
    } finally { setBusy(btn, false); }
  }

  function drawQuestion() {
    const at = state.attempt;
    const q = at.questions[at.index];
    const total = at.questions.length;
    const answered = Object.keys(at.answers).length;
    const options = [["A", q.option_a], ["B", q.option_b], ["C", q.option_c], ["D", q.option_d]].filter(([, v]) => v);

    mount(body,
      h("div.card", {},
        h("div.u-row", { style: { justifyContent: "space-between", flexWrap: "wrap", gap: "8px" } },
          h("div", { style: { fontWeight: "600" }, text: at.title }),
          at.deadline ? h("span.badge.badge-warn#examTimer", { text: "—:—" }) : null,
        ),
        h("div.u-xs.u-muted", { style: { marginTop: "6px" } },
          `Question ${at.index + 1} of ${total} · ${answered} answered  `,
          h("span#saveNote", { text: at.saveNote || "" })),
        h("h3", { style: { margin: "14px 0", lineHeight: "1.5" }, text: q.question_text }),
        h("div.u-stack", { style: { gap: "8px" } }, options.map(([letter, text]) => {
          const chosen = at.answers[q.question_id] === letter;
          return h("label.u-row", {
            style: {
              gap: "10px", padding: "12px 14px", cursor: "pointer", alignItems: "center",
              border: `2px solid ${chosen ? "var(--ama-green)" : "var(--ama-line)"}`,
              background: chosen ? "var(--ama-green-soft)" : "transparent",
              borderRadius: "10px",
            },
          },
            h("input", {
              type: "radio", name: "examOption", checked: chosen,
              style: { width: "20px", height: "20px" },
              onchange: () => { at.answers[q.question_id] = letter; drawQuestion(); saveAnswer(q.question_id, letter); },
            }),
            h("span", { text: `${letter}. ${text}` }),
          );
        })),
        h("div.u-row", { style: { gap: "10px", marginTop: "18px" } },
          h("button.btn.btn-outline.u-grow", { type: "button", text: "Previous", disabled: at.index === 0,
            onclick: () => { at.index -= 1; drawQuestion(); } }),
          at.index === total - 1
            ? h("button.btn.btn-primary.u-grow", { type: "button", text: "Submit", onclick: (e) => askSubmit(e.target) })
            : h("button.btn.btn-primary.u-grow", { type: "button", text: "Next", onclick: () => { at.index += 1; drawQuestion(); } }),
        ),
      ),
    );
    tickTimer();
  }

  /** Save each choice as it is made, so the server holds the answers, not
   *  just this tab. A failed save is not fatal: the full set is still sent
   *  on Submit, and the person is told so they are not surprised. */
  async function saveAnswer(questionId, letter) {
    const at = state.attempt;
    if (!at) return;
    const note = (text) => { at.saveNote = text; const el = document.getElementById("saveNote"); if (el) el.textContent = text; };
    note("Saving…");
    try {
      unwrap(await supabase.rpc("save_attempt_answer", { p_attempt_id: at.id, p_question_id: questionId, p_selected: letter }), "save answer");
      note("· saved");
    } catch (err) {
      logError("save answer", err);
      note("· not saved yet — it will be sent when you submit");
    }
  }

  function startTimer() {
    stopTimer();
    state.timer = setInterval(() => { if (!tickTimer()) { stopTimer(); doSubmit(true); } }, 1000);
  }
  function stopTimer() { if (state.timer) { clearInterval(state.timer); state.timer = null; } }

  function tickTimer() {
    const at = state.attempt;
    const el = document.getElementById("examTimer");
    if (!at?.deadline || !el) return true;
    const left = at.deadline - new Date();
    if (left <= 0) { el.textContent = "00:00"; return false; }
    const m = Math.floor(left / 60000), s = Math.floor((left % 60000) / 1000);
    el.textContent = `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
    return true;
  }

  async function askSubmit(btn) {
    const at = state.attempt;
    const unanswered = at.questions.length - Object.keys(at.answers).length;
    const ok = await confirmAction({
      title: "Submit your answers?",
      message: unanswered
        ? `${unanswered} question${unanswered === 1 ? "" : "s"} left unanswered will be marked wrong.`
        : "You have answered every question.",
      confirmLabel: "Submit",
    });
    if (!ok) return;
    setBusy(btn, true, "Submitting…");
    await doSubmit(false);
  }

  async function doSubmit(automatic) {
    stopTimer();
    const at = state.attempt;
    if (!at) return;
    const answers = Object.entries(at.answers).map(([question_id, selected_option]) => ({ question_id, selected_option }));
    try {
      const rows = unwrap(await supabase.rpc("submit_assessment_attempt", {
        p_attempt_id: at.id, p_answers: answers,
      }), "submit attempt");
      const result = Array.isArray(rows) ? rows[0] : rows;
      state.attempt = null;
      mount(body, h("div.card", { style: { textAlign: "center", maxWidth: "440px", margin: "32px auto" } },
        automatic ? inlineAlert("Time ran out, so your answers were submitted automatically.", "warn") : null,
        h("h2", { style: { margin: "8px 0" }, text: "Submitted" }),
        h("div.u-xs.u-muted", { text: "Your score" }),
        h("div", { style: { fontSize: "40px", fontWeight: "700", color: "var(--ama-green-deep)" },
          text: `${result.out_score} / ${result.out_total_marks}` }),
        h("div.u-xs.u-muted", { text: `${result.out_percentage}%` }),
        result.out_was_late ? h("p.u-xs", { style: { color: "var(--ama-warn)" }, text: "This was recorded as a late submission." }) : null,
        h("button.btn.btn-outline", { type: "button", text: "Back to exams & tests", style: { marginTop: "18px" }, onclick: loadList }),
      ));
    } catch (err) {
      logError("submit attempt", err);
      mount(body, errorState(humanError(err, "Your answers could not be submitted. Try again."), () => doSubmit(false)));
    }
  }
}
