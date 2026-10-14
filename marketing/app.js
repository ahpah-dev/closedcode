"use strict";

(() => {
  const config = window.CLOSED_CODE_SITE || {};
  const repository = typeof config.repository === "string" && /^[\w.-]+\/[\w.-]+$/.test(config.repository) ? config.repository : "";
  const repoUrl = repository ? `https://github.com/${repository}` : "";
  const menu = document.querySelector(".menu-toggle");
  const nav = document.querySelector("#main-nav");
  const toast = document.querySelector("#site-toast");
  let toastTimeout;

  function notify(message) {
    toast.textContent = message;
    toast.classList.add("is-visible");
    clearTimeout(toastTimeout);
    toastTimeout = setTimeout(() => toast.classList.remove("is-visible"), 3000);
  }

  function closeMenu() {
    nav.classList.remove("is-open");
    menu.setAttribute("aria-expanded", "false");
    menu.setAttribute("aria-label", "Open navigation");
  }

  menu.addEventListener("click", () => {
    const open = menu.getAttribute("aria-expanded") !== "true";
    menu.setAttribute("aria-expanded", String(open));
    menu.setAttribute("aria-label", open ? "Close navigation" : "Open navigation");
    nav.classList.toggle("is-open", open);
  });
  nav.addEventListener("click", (event) => { if (event.target.closest("a")) closeMenu(); });
  document.addEventListener("keydown", (event) => { if (event.key === "Escape" && nav.classList.contains("is-open")) { closeMenu(); menu.focus(); } });
  document.addEventListener("click", (event) => { if (!event.target.closest(".nav-shell")) closeMenu(); });

  if (repoUrl) {
    document.querySelectorAll("[data-repo-link]").forEach((link) => { link.href = repoUrl; link.target = "_blank"; link.rel = "noreferrer"; });
    document.querySelectorAll("[data-releases-link]").forEach((link) => { link.href = `${repoUrl}/releases`; link.target = "_blank"; link.rel = "noreferrer"; });
    document.querySelectorAll("[data-license-link]").forEach((link) => { link.href = `${repoUrl}/blob/main/LICENSE`; });
    document.querySelectorAll("[data-notices-link]").forEach((link) => { link.href = `${repoUrl}/blob/main/THIRD_PARTY_NOTICES.md`; link.target = "_blank"; link.rel = "noreferrer"; });
    const command = `git clone ${repoUrl}.git`;
    document.querySelector("#source-command").textContent = command;
    const copyButton = document.querySelector("#copy-source");
    copyButton.disabled = false;
    copyButton.addEventListener("click", async () => {
      try { await navigator.clipboard.writeText(command); notify("Clone command copied."); }
      catch { notify("Select the clone command and copy it manually."); }
    });
  }

  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (!reducedMotion && "IntersectionObserver" in window) {
    document.documentElement.classList.add("motion-ready");
    const observer = new IntersectionObserver((entries) => { entries.forEach((entry) => { if (entry.isIntersecting) { entry.target.classList.add("is-visible"); observer.unobserve(entry.target); } }); }, { rootMargin: "0px 0px 40px 0px", threshold: .04 });
    document.querySelectorAll(".reveal").forEach((element) => observer.observe(element));
  }

  const platformButtons = [...document.querySelectorAll("[data-platform]")];
  const downloadLink = document.querySelector("#download-link");
  const downloadLabel = document.querySelector("#download-label");
  const downloadStatus = document.querySelector("#download-status");
  const platformDescription = document.querySelector("#platform-description");
  const versionElement = document.querySelector("#release-version");
  const checksumLink = document.querySelector("#checksum-link");
  const refreshButton = document.querySelector("#refresh-releases");
  const architectureChooser = document.querySelector("#architecture-chooser");
  const architectureButtons = [...document.querySelectorAll("[data-architecture]")];
  const alternativeDownload = document.querySelector("#alternative-download");
  let selectedPlatform = /Mac/i.test(navigator.userAgent) ? "mac" : "windows";
  let selectedArchitecture = "arm64";
  let release = null;
  let releaseState = "loading";
  let fetchController;

  function safeDownloadUrl(value) {
    if (typeof value !== "string") return "";
    try {
      const url = new URL(value);
      if (url.protocol !== "https:" || url.hostname !== "github.com" || !repository || !url.pathname.startsWith(`/${repository}/releases/download/`)) return "";
      return url.href;
    } catch { return ""; }
  }

  function configuredDownload(platform) {
    const value = platform === "mac" ? config.downloads?.mac?.[selectedArchitecture] : config.downloads?.[platform];
    if (!value || typeof value !== "object") return null;
    const url = safeDownloadUrl(value.url);
    return url ? { url, name: value.name || "", description: value.description || "", size: value.size || 0 } : null;
  }

  function findAsset(platform) {
    const assets = Array.isArray(release?.assets) ? release.assets : [];
    const matches = assets.filter((asset) => typeof asset.name === "string" && safeDownloadUrl(asset.browser_download_url));
    let selected;
    if (platform === "windows") {
      selected = matches.find((asset) => /\.exe$/i.test(asset.name) && /setup|installer/i.test(asset.name)) || matches.find((asset) => /\.msi$/i.test(asset.name)) || matches.find((asset) => /\.exe$/i.test(asset.name));
    } else {
      const images = matches.filter((asset) => /\.dmg$/i.test(asset.name));
      selected = images.find((asset) => /universal/i.test(asset.name)) || images.find((asset) => selectedArchitecture === "arm64" ? /arm64|aarch64/i.test(asset.name) : /x64|x86_64/i.test(asset.name));
    }
    if (selected) return { url: selected.browser_download_url, name: selected.name, size: selected.size || 0, description: platform === "windows" ? "Windows · x64" : /arm64|aarch64/i.test(selected.name) ? "macOS 13+ · Apple silicon" : /x64|x86_64/i.test(selected.name) ? "macOS 13+ · Intel" : "macOS 13+ · Universal" };
    return releaseState === "loaded" ? null : configuredDownload(platform);
  }

  function formatSize(bytes) { return Number.isFinite(bytes) && bytes > 0 ? `${Math.round(bytes / 1024 / 1024)} MB` : ""; }

  function renderDownload() {
    const name = selectedPlatform === "mac" ? "macOS" : "Windows";
    const asset = findAsset(selectedPlatform);
    platformButtons.forEach((button) => { const active = button.dataset.platform === selectedPlatform; button.classList.toggle("is-selected", active); button.setAttribute("aria-pressed", String(active)); });
    architectureChooser.hidden = selectedPlatform !== "mac";
    architectureButtons.forEach((button) => { const active = button.dataset.architecture === selectedArchitecture; button.classList.toggle("is-selected", active); button.setAttribute("aria-pressed", String(active)); });
    versionElement.textContent = release?.tag_name || (asset ? config.version || "" : "");
    platformDescription.textContent = asset?.description || (selectedPlatform === "mac" ? `macOS 13+ · ${selectedArchitecture === "arm64" ? "Apple silicon" : "Intel"}` : "Windows · x64");
    downloadStatus.classList.toggle("is-unavailable", !asset);
    if (asset) {
      downloadLink.href = asset.url;
      downloadLink.setAttribute("aria-disabled", "false");
      downloadLabel.textContent = `Download for ${name}`;
      const size = formatSize(asset.size);
      downloadStatus.textContent = `Published ${/portable/i.test(asset.name) ? "portable app" : "installer"}${size ? ` · ${size}` : ""}${releaseState === "error" ? ". Latest-release check unavailable; this published download remains available." : ". Ready for your next project."}`;
    } else {
      downloadLink.removeAttribute("href");
      downloadLink.setAttribute("aria-disabled", "true");
      downloadLabel.textContent = releaseState === "loading" ? "Checking availability" : `${name} installer unavailable`;
      downloadStatus.textContent = releaseState === "loading" ? "Checking the latest public GitHub release…" : releaseState === "error" ? "Could not check the latest release. Use All releases to check published assets, or refresh availability." : `No ${name} installer has been published in the latest release. Browse the source or check All releases.`;
    }
    const checksum = release?.assets?.find((item) => /^(?:SHA256SUMS(?:\.txt)?|checksums\.txt)$/i.test(item.name));
    const checksumUrl = safeDownloadUrl(checksum?.browser_download_url) || safeDownloadUrl(config.checksumUrl);
    checksumLink.hidden = !checksumUrl;
    if (checksumUrl) checksumLink.href = checksumUrl;
    const alternative = release?.assets?.find((item) => safeDownloadUrl(item.browser_download_url) && (selectedPlatform === "windows" ? /portable.*\.exe$/i.test(item.name) : /\.zip$/i.test(item.name) && (selectedArchitecture === "arm64" ? /arm64|aarch64/i.test(item.name) : /x64|x86_64/i.test(item.name))));
    alternativeDownload.hidden = !alternative;
    if (alternative) { alternativeDownload.href = alternative.browser_download_url; alternativeDownload.childNodes[0].textContent = selectedPlatform === "windows" ? "Portable " : "ZIP archive "; }
    document.querySelector("#unsigned-note").hidden = config.unsigned === false;
  }

  platformButtons.forEach((button) => button.addEventListener("click", () => { selectedPlatform = button.dataset.platform; renderDownload(); }));
  architectureButtons.forEach((button) => button.addEventListener("click", () => { selectedArchitecture = button.dataset.architecture; renderDownload(); }));
  downloadLink.addEventListener("click", (event) => { if (downloadLink.getAttribute("aria-disabled") === "true") event.preventDefault(); });
  downloadLink.addEventListener("keydown", (event) => {
    if (event.key === " ") { event.preventDefault(); if (downloadLink.hasAttribute("href")) downloadLink.click(); }
    else if (event.key === "Enter" && !downloadLink.hasAttribute("href")) event.preventDefault();
  });

  async function loadRelease() {
    if (fetchController) fetchController.abort();
    fetchController = new AbortController();
    releaseState = "loading";
    refreshButton.disabled = true;
    renderDownload();
    if (!repository) { releaseState = "unavailable"; refreshButton.disabled = false; renderDownload(); return; }
    const controller = fetchController;
    const timeout = setTimeout(() => controller.abort(), 10000);
    try {
      const response = await fetch(`https://api.github.com/repos/${repository}/releases/latest`, { headers: { Accept: "application/vnd.github+json" }, signal: controller.signal });
      if (response.status === 404) { release = null; releaseState = "unavailable"; }
      else if (!response.ok) throw new Error(`GitHub returned ${response.status}`);
      else {
        const data = await response.json();
        if (!Array.isArray(data.assets) || data.draft || data.prerelease) throw new Error("No public stable release was returned.");
        release = data;
        releaseState = "loaded";
      }
    } catch { if (controller !== fetchController) return; releaseState = "error"; }
    finally { clearTimeout(timeout); if (controller === fetchController) { refreshButton.disabled = false; renderDownload(); } }
  }

  refreshButton.addEventListener("click", loadRelease);
  renderDownload();
  void loadRelease();
})();
