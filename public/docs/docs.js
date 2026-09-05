import { watchtowerFaq } from "/faq-data.js";

const themePreferenceKey = "watchtower-theme";

function applyTheme(theme) {
  const selectedTheme = theme === "dark" ? "dark" : "light";
  document.documentElement.dataset.theme = selectedTheme;
  const toggle = document.querySelector("#docs-theme-toggle");
  if (!toggle) return;
  const dark = selectedTheme === "dark";
  toggle.setAttribute("aria-pressed", String(dark));
  toggle.setAttribute("aria-label", dark ? "Switch to light mode" : "Switch to dark mode");
  toggle.title = dark ? "Switch to light mode" : "Switch to dark mode";
}

function initializeTheme() {
  const toggle = document.querySelector("#docs-theme-toggle");
  if (!toggle) return;

  let savedTheme;
  try {
    savedTheme = localStorage.getItem(themePreferenceKey);
  } catch {
    savedTheme = null;
  }

  const initialTheme = savedTheme === "dark" || savedTheme === "light"
    ? savedTheme
    : window.matchMedia?.("(prefers-color-scheme: dark)").matches
      ? "dark"
      : "light";
  applyTheme(initialTheme);
  toggle.addEventListener("click", () => {
    const nextTheme = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
    applyTheme(nextTheme);
    try {
      localStorage.setItem(themePreferenceKey, nextTheme);
    } catch {
      // The selected theme remains active when storage is unavailable.
    }
  });
}

function initializeSectionNavigation() {
  const links = [...document.querySelectorAll("[data-doc-link]")];
  const sections = [...document.querySelectorAll("[data-doc-section]")];
  const mobileMenu = document.querySelector(".docs-mobile-nav");

  const setActive = (id) => {
    links.forEach((link) => {
      const active = link.getAttribute("href") === `#${id}`;
      if (active) link.setAttribute("aria-current", "true");
      else link.removeAttribute("aria-current");
    });
  };

  links.forEach((link) => {
    link.addEventListener("click", () => {
      if (mobileMenu) mobileMenu.removeAttribute("open");
    });
  });

  const initialId = window.location.hash.slice(1);
  if (initialId && sections.some((section) => section.id === initialId)) setActive(initialId);
  else if (sections[0]) setActive(sections[0].id);

  if ("IntersectionObserver" in window) {
    const observer = new IntersectionObserver((entries) => {
      const visible = entries
        .filter(({ isIntersecting }) => isIntersecting)
        .sort((left, right) => left.boundingClientRect.top - right.boundingClientRect.top);
      if (visible[0]) setActive(visible[0].target.id);
    }, { rootMargin: "-110px 0px -65%", threshold: [0, 0.25, 0.7] });
    sections.forEach((section) => observer.observe(section));
  }

  window.addEventListener("hashchange", () => {
    const id = window.location.hash.slice(1);
    if (sections.some((section) => section.id === id)) setActive(id);
  });
}

function createDocsFaqItem(entry, index) {
  const details = document.createElement("details");
  details.open = index === 0;
  const summary = document.createElement("summary");
  summary.textContent = entry.question;
  const answer = document.createElement("p");
  answer.textContent = entry.longAnswer;
  details.append(summary, answer);
  return details;
}

function initializeSharedFaq() {
  const container = document.querySelector("[data-doc-shared-faq]");
  if (!container) return;
  container.replaceChildren(...watchtowerFaq.map(createDocsFaqItem));
}

initializeTheme();
initializeSharedFaq();
initializeSectionNavigation();
