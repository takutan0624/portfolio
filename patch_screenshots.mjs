import fs from 'fs';
import path from 'path';

const filePath = path.join(import.meta.dirname, 'index.html');
let html = fs.readFileSync(filePath, 'utf8');

// Replace each work-placeholder div with an img tag
for (let i = 1; i <= 27; i++) {
  const id = String(i).padStart(2, '0');
  const placeholder = `            <div class="work-placeholder">\n              <span class="placeholder-icon">${id}</span>\n            </div>`;
  const img = `            <img src="works/screenshots/${id}.jpg" alt="Project ${id}" class="work-screenshot" loading="lazy">`;
  html = html.replace(placeholder, img);
}

// Add CSS for .work-screenshot right after .work-placeholder style block
const cssTarget = `    .work-placeholder {
      width: 100%;
      height: 100%;
      display: flex;
      align-items: center;
      justify-content: center;
    }

    .placeholder-icon {
      font-family: var(--font-heading);
      font-size: 4rem;
      font-weight: 700;
      color: rgba(255, 255, 255, 0.1);
    }`;

const cssReplacement = `    .work-placeholder {
      width: 100%;
      height: 100%;
      display: flex;
      align-items: center;
      justify-content: center;
    }

    .placeholder-icon {
      font-family: var(--font-heading);
      font-size: 4rem;
      font-weight: 700;
      color: rgba(255, 255, 255, 0.1);
    }

    .work-screenshot {
      width: 100%;
      height: 100%;
      object-fit: cover;
      object-position: top center;
      display: block;
      transition: transform 0.6s cubic-bezier(0.25, 0.46, 0.45, 0.94);
    }

    .work-card:hover .work-screenshot {
      transform: scale(1.04);
    }`;

html = html.replace(cssTarget, cssReplacement);

fs.writeFileSync(filePath, html, 'utf8');
console.log('✅ All 27 placeholders replaced with screenshot images.');
