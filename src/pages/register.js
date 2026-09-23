// Retain all existing imports and backend functions intact
// Pure presentation enhancement for registration container step wrapper

export function renderRegisterProgress(currentStep = 1) {
  return `
    <div class="stepper-nav">
      <div class="stepper-step ${currentStep >= 1 ? 'active' : ''}">
        <span class="step-number">1</span>
        <span>School Info</span>
      </div>
      <div class="stepper-step ${currentStep >= 2 ? 'active' : ''}">
        <span class="step-number">2</span>
        <span>Sections</span>
      </div>
      <div class="stepper-step ${currentStep >= 3 ? 'active' : ''}">
        <span class="step-number">3</span>
        <span>Web Portal</span>
      </div>
      <div class="stepper-step ${currentStep >= 4 ? 'active' : ''}">
        <span class="step-number">4</span>
        <span>Admin Account</span>
      </div>
    </div>
  `;
}
