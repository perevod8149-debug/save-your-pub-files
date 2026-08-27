(function () {
  const dropdowns = document.querySelectorAll("[data-language-dropdown]");

  function closeDropdown(dropdown) {
    const button = dropdown.querySelector(".language-toggle");
    dropdown.classList.remove("is-open");
    if (button) {
      button.setAttribute("aria-expanded", "false");
    }
  }

  function closeAllExcept(activeDropdown) {
    dropdowns.forEach(function (dropdown) {
      if (dropdown !== activeDropdown) {
        closeDropdown(dropdown);
      }
    });
  }

  dropdowns.forEach(function (dropdown) {
    const button = dropdown.querySelector(".language-toggle");
    const menu = dropdown.querySelector(".language-menu");

    if (!button || !menu) {
      return;
    }

    button.addEventListener("click", function () {
      const isOpen = dropdown.classList.toggle("is-open");
      button.setAttribute("aria-expanded", isOpen ? "true" : "false");
      closeAllExcept(dropdown);
    });

    dropdown.addEventListener("keydown", function (event) {
      if (event.key === "Escape") {
        closeDropdown(dropdown);
        button.focus();
      }
    });
  });

  document.addEventListener("click", function (event) {
    dropdowns.forEach(function (dropdown) {
      if (!dropdown.contains(event.target)) {
        closeDropdown(dropdown);
      }
    });
  });
})();
