let cards = [...document.querySelectorAll(".update-card")];
const toast = document.getElementById("toast");
const searchOverlay = document.getElementById("searchOverlay");
const searchInput = document.getElementById("searchInput");
const updateList = document.getElementById("updateList");

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;"
  })[char]);
}

function bindCard(card) {
  card.querySelector(".update-button").addEventListener("click", async (event) => {
    const button = event.currentTarget;
    if (button.disabled) return;
    button.textContent = "Updating";
    button.disabled = true;
    card.classList.add("updating");
    try {
      await fetch("/api/upgrade", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ package: card.dataset.package })
      });
      showToast(`${card.dataset.name} update started`);
    } catch {
      button.textContent = "Update";
      button.disabled = false;
      card.classList.remove("updating");
      showToast("Could not start the package update");
    }
  });

  card.querySelector(".more-button").addEventListener("click", () => {
    showToast(`${card.dataset.name}: ${card.dataset.size} download`);
  });
}

const packageIcons = [
  { match: /^(firefox|firefox-langpacks)$/, className: "firefox-icon", iconUrl: "https://api.iconify.design/logos/firefox.svg" },
  { match: /^(code|code-insiders|vscode|visual-studio-code)$/, className: "vscode-icon", iconUrl: "https://api.iconify.design/logos/visual-studio-code.svg" },
  { match: /^(thunderbird|thunderbird-langpacks)$/, className: "thunderbird-icon", iconUrl: "https://cdn.simpleicons.org/thunderbird" },
  { match: /^(libreoffice|libreoffice-.*)$/, className: "libre-icon", iconUrl: "https://cdn.simpleicons.org/libreoffice" },
  { match: /^(git|git-.*|.*-git(?:-.*)?)$/, className: "git-icon", iconUrl: "https://api.iconify.design/logos/git.svg" },
  { match: /^(python|python3|python3-libs|python3-.*)$/, className: "python-icon", iconUrl: "https://api.iconify.design/logos/python.svg" },
  { match: /^(kernel|kernel-.*)$/, className: "kernel-icon", iconUrl: "https://cdn.simpleicons.org/linux" },
  { match: /^(gnome|gnome-.*)$/, className: "gnome-icon", iconUrl: "https://api.iconify.design/logos/gnome.svg" }
];

function getPackageIcon(name) {
  const icon = packageIcons.find(({ match }) => match.test(name.toLowerCase()));
  if (icon) {
    return {
      className: icon.className,
      markup: `<img class="brand-icon" src="${icon.iconUrl}" alt="" loading="lazy">`
    };
  }
  return {
    className: "package-icon",
    markup: `<span>${escapeHtml(name.slice(0, 2).toUpperCase())}</span>`
  };
}

function renderPackages(packages) {
  updateList.innerHTML = packages.map((pkg) => {
    const oldVersion = pkg.old_version ? pkg.old_version : "installed";
    const icon = getPackageIcon(pkg.name);
    return `
      <article class="update-card" data-name="${escapeHtml(pkg.name)}" data-package="${escapeHtml(pkg.name)}" data-size="${escapeHtml(pkg.size)}">
        <div class="app-icon ${icon.className}" aria-hidden="true">${icon.markup}</div>
        <div class="update-details">
          <div class="title-row">
            <h3>${escapeHtml(pkg.name)}</h3>
            <span class="tag package">${escapeHtml(pkg.repository)}</span>
          </div>
          <p>${escapeHtml(pkg.arch)} system package</p>
          <div class="meta-row">
            <span>${escapeHtml(oldVersion)} → <strong>${escapeHtml(pkg.version)}</strong></span>
            <span class="separator"></span>
            <span>${escapeHtml(pkg.size)}</span>
          </div>
        </div>
        <button class="more-button" type="button" aria-label="Show ${escapeHtml(pkg.name)} update details">
          <svg viewBox="0 0 24 24"><path d="m8 10 4 4 4-4"/></svg>
        </button>
        <button class="update-button" type="button">Update</button>
      </article>`;
  }).join("");
  cards = [...document.querySelectorAll(".update-card")];
  cards.forEach(bindCard);
}

async function loadUpdates(refresh = false) {
  try {
    const response = await fetch(`/api/updates${refresh ? "?refresh=1" : ""}`);
    let data;
    try {
      data = await response.json();
    } catch {
      throw new Error("The update service returned an invalid response");
    }
    if (!response.ok) {
      throw new Error(data.error || "The update service is unavailable");
    }
    if (data.error && (!data.packages || !data.packages.length)) {
      showToast(data.error);
    }
    if (Array.isArray(data.packages)) {
      renderPackages(data.packages);
    }
    document.getElementById("availableCount").textContent = data.count || data.packages?.length || 0;
    document.querySelector(".count-badge").textContent = data.count || data.packages?.length || 0;
    document.getElementById("downloadSize").textContent = data.download_size || "0 MiB";
    document.getElementById("installSize").textContent =
      data.extra_size ? `${data.extra_size} extra` : "0 MiB";
  } catch (error) {
    showToast(error instanceof Error ? error.message : "Could not read DNF package updates");
  }
}

function showToast(message) {
  toast.querySelector("span").textContent = message;
  toast.classList.add("show");
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => toast.classList.remove("show"), 2200);
}

document.querySelectorAll(".nav-item").forEach((item) => {
  item.addEventListener("click", () => {
    document.querySelectorAll(".nav-item").forEach((nav) => nav.classList.remove("active"));
    item.classList.add("active");
    if (item.dataset.view !== "updates") {
      showToast(`${item.textContent.trim().replace(/\d+$/, "")} view selected`);
    }
  });
});

cards.forEach((card) => {
  card.querySelector(".update-button").addEventListener("click", (event) => {
    const button = event.currentTarget;
    if (button.disabled) return;
    button.textContent = "Updating";
    button.disabled = true;
    card.classList.add("updating");
    setTimeout(() => {
      card.classList.remove("updating");
      card.classList.add("updated");
      button.textContent = "Installed";
      showToast(`${card.dataset.name} updated successfully`);
      updateRemainingCount();
    }, 850);
  });

  card.querySelector(".more-button").addEventListener("click", () => {
    showToast(`${card.dataset.name}: ${card.dataset.size} download`);
  });
});

function updateRemainingCount() {
  const remaining = cards.filter((card) =>
    !card.querySelector(".update-button").disabled
  ).length;
  document.getElementById("availableCount").textContent = remaining;
  document.querySelector(".count-badge").textContent = remaining;
  if (remaining === 0) {
    document.querySelector(".summary-main h2").innerHTML = "System is up to date";
    document.querySelector(".summary-main p").textContent = "All available updates have been installed";
  }
}

document.getElementById("updateAllButton").addEventListener("click", (event) => {
  const button = event.currentTarget;
  if (button.classList.contains("updating")) return;
  button.classList.add("updating");
  button.querySelector("span").textContent = "Updating";
  fetch("/api/upgrade", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({})
  }).catch(() => showToast("Could not start the system update"));
  cards.forEach((card, index) => {
    const updateButton = card.querySelector(".update-button");
    if (updateButton.disabled) return;
    setTimeout(() => {
      updateButton.textContent = "Updating";
      updateButton.disabled = true;
      card.classList.add("updating");
      setTimeout(() => {
        card.classList.remove("updating");
        card.classList.add("updated");
        updateButton.textContent = "Installed";
        updateRemainingCount();
        if (index === cards.length - 1) {
          button.classList.remove("updating");
          button.querySelector("span").textContent = "Updated";
          showToast("All updates installed");
        }
      }, 600);
    }, index * 180);
  });
});

document.getElementById("checkButton").addEventListener("click", (event) => {
  const button = event.currentTarget;
  button.classList.add("loading");
  button.querySelector("span").textContent = "Checking";
  loadUpdates(true).finally(() => {
    button.classList.remove("loading");
    button.querySelector("span").textContent = "Check for updates";
    showToast("DNF update check complete");
  });
});

document.getElementById("searchButton").addEventListener("click", () => {
  searchOverlay.classList.add("open");
  searchOverlay.setAttribute("aria-hidden", "false");
  searchInput.focus();
});

function closeSearch() {
  searchOverlay.classList.remove("open");
  searchOverlay.setAttribute("aria-hidden", "true");
  searchInput.value = "";
  cards.forEach((card) => card.classList.remove("hidden"));
}

document.getElementById("closeSearch").addEventListener("click", closeSearch);
searchOverlay.addEventListener("click", (event) => {
  if (event.target === searchOverlay) closeSearch();
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") closeSearch();
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "f") {
    event.preventDefault();
    searchOverlay.classList.add("open");
    searchOverlay.setAttribute("aria-hidden", "false");
    searchInput.focus();
  }
});

searchInput.addEventListener("input", () => {
  const query = searchInput.value.trim().toLowerCase();
  cards.forEach((card) => {
    card.classList.toggle("hidden", !card.textContent.toLowerCase().includes(query));
  });
});

document.getElementById("sortButton").addEventListener("click", (event) => {
  const label = event.currentTarget.querySelector("span");
  if (label.textContent.includes("Recommended")) {
    label.textContent = "Sort: Name";
    cards.sort((a, b) => a.dataset.name.localeCompare(b.dataset.name));
  } else {
    label.textContent = "Sort: Recommended";
  }
  const list = document.getElementById("updateList");
  cards.forEach((card) => list.appendChild(card));
});

  loadUpdates();
