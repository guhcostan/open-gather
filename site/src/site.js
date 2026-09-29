(() => {
  const root = document.body.dataset.root || "./";

  // Copy buttons on code blocks
  document.querySelectorAll(".code .copy").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const text = btn.parentElement.querySelector("code").innerText;
      try {
        await navigator.clipboard.writeText(text);
        btn.textContent = "Copied";
      } catch {
        btn.textContent = "Press Ctrl+C";
      }
      setTimeout(() => (btn.textContent = "Copy"), 1600);
    });
  });

  // Fit the fixed-size hero stage into its wrapper
  const wrap = document.querySelector(".stage-wrap");
  if (wrap) {
    const stage = wrap.querySelector(".stage");
    const fit = () => stage.style.setProperty("--k", Math.min(1, wrap.clientWidth / 640));
    new ResizeObserver(fit).observe(wrap);
    fit();
  }

  // Docs: mobile sidebar toggle + tiny client-side search
  const toggle = document.querySelector(".side-toggle");
  const sidebar = document.querySelector(".sidebar");
  toggle?.addEventListener("click", () => {
    const open = sidebar.classList.toggle("open");
    toggle.setAttribute("aria-expanded", String(open));
  });

  const q = document.getElementById("q");
  const list = document.getElementById("results");
  if (q && list) {
    let index = null;
    const load = async () => (index ??= await (await fetch(root + "search-index.json")).json());
    q.addEventListener("input", async () => {
      const term = q.value.trim().toLowerCase();
      if (term.length < 2) return (list.hidden = true);
      const data = await load();
      const words = term.split(/\s+/);
      const hits = data
        .map((p) => {
          const hay = (p.t + " " + p.h.join(" ")).toLowerCase();
          const body = p.x.toLowerCase();
          let s = 0;
          for (const w of words) {
            if (p.t.toLowerCase().includes(w)) s += 8;
            if (hay.includes(w)) s += 4;
            if (body.includes(w)) s += 1;
            else return null;
          }
          return { p, s };
        })
        .filter(Boolean)
        .sort((a, b) => b.s - a.s)
        .slice(0, 6);
      list.replaceChildren(
        ...(hits.length
          ? hits.map(({ p }) => {
              const li = document.createElement("li");
              const a = document.createElement("a");
              a.href = root + p.u;
              a.textContent = p.t;
              li.append(a);
              return li;
            })
          : [Object.assign(document.createElement("li"), { textContent: "No results", className: "none" })]),
      );
      list.hidden = false;
    });
    document.addEventListener("keydown", (e) => {
      if (e.key === "/" && document.activeElement?.tagName !== "INPUT") {
        e.preventDefault();
        q.focus();
      }
      if (e.key === "Escape") list.hidden = true;
    });
  }
})();
