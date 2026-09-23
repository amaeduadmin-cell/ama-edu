import { renderHeader } from '../lib/ui.js';

export function renderLandingPage() {
  const container = document.createElement('div');
  container.className = 'landing-page-wrapper';

  container.innerHTML = `
    <!-- Sticky Header preserved -->
    <header id="site-header"></header>

    <main>
      <!-- Premium Hero Section -->
      <section class="hero-section">
        <div class="container hero-grid">
          <div class="hero-content">
            <div class="hero-pill">
              <span class="badge badge-gold">NEW</span> Modern School Management SaaS
            </div>
            <h1 class="hero-title">
              Powering Academic Excellence for <span>Nigerian Schools</span>
            </h1>
            <p class="hero-description">
              Streamline enrollment, grade books, automated report cards, bursary fees, and parent communication in one unified, secure platform.
            </p>
            <div class="hero-ctas">
              <a href="/register" class="btn btn-primary">Register Your School</a>
              <a href="/find-school" class="btn btn-secondary">Find My School</a>
            </div>
          </div>

          <!-- Report Card Showcase Frame (Unchanged Inner Logic) -->
          <div class="hero-preview-frame">
            <div id="hero-report-preview">
              <!-- Report Card Sample Embed -->
              <div style="padding: 1rem; text-align: center; color: var(--color-slate-500);">
                <span class="badge badge-green">LIVE PREVIEW</span>
                <p style="margin-top: 0.5rem; font-size: 0.875rem;">Instant Report Card & Grade Analytics Preview</p>
              </div>
            </div>
          </div>
        </div>
      </section>

      <!-- Features Section -->
      <section class="features-section">
        <div class="container">
          <div style="text-align: center; max-width: 36rem; margin: 0 auto;">
            <h2 style="font-size: var(--font-size-3xl); color: var(--color-slate-900);">Everything Your School Needs</h2>
            <p style="color: var(--color-slate-600); margin-top: 0.5rem;">Engineered specifically for Nigerian primary, secondary, and tertiary institutions.</p>
          </div>

          <div class="features-grid">
            <div class="feature-card">
              <div class="feature-icon-wrapper">01</div>
              <h3 class="feature-title">Students & Enrollment</h3>
              <p class="feature-description">Manage student bio-data, enrollment, classes, and academic histories easily.</p>
            </div>
            <div class="feature-card">
              <div class="feature-icon-wrapper">02</div>
              <h3 class="feature-title">Scores & Assessment</h3>
              <p class="feature-description">Custom grading scales, test scores, continuous assessment, and term examinations.</p>
            </div>
            <div class="feature-card">
              <div class="feature-icon-wrapper">03</div>
              <h3 class="feature-title">Automated Report Cards</h3>
              <p class="feature-description">One-click batch generation of beautiful, accurate report cards with positions.</p>
            </div>
            <div class="feature-card">
              <div class="feature-icon-wrapper">04</div>
              <h3 class="feature-title">Staff & Permissions</h3>
              <p class="feature-description">Role-based access for Principals, Teachers, Bursars, and Administrators.</p>
            </div>
            <div class="feature-card">
              <div class="feature-icon-wrapper">05</div>
              <h3 class="feature-title">Bursary & Fees</h3>
              <p class="feature-description">Track tuition payments, outstanding balances, receipts, and financial reports.</p>
            </div>
            <div class="feature-card">
              <div class="feature-icon-wrapper">06</div>
              <h3 class="feature-title">Parent & Student Access</h3>
              <p class="feature-description">Dedicated portals for parents to view results, announcements, and fee status online.</p>
            </div>
          </div>
        </div>
      </section>
    </main>
  `;

  // Retain existing header mounting logic
  const headerElem = container.querySelector('#site-header');
  if (headerElem) {
    headerElem.appendChild(renderHeader());
  }

  return container;
}
