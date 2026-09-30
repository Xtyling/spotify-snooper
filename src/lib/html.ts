export function escapeHtml(value: unknown): string {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

export function formatDate(value: Date | string | null): string {
  if (!value) return "Never";
  return new Intl.DateTimeFormat("en", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

export function layout(title: string, body: string): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(title)} · Spotify Snooper</title>
  <style>
    :root { color-scheme: dark; font-family: Inter, ui-sans-serif, system-ui, sans-serif; background:#0b0d0c; color:#f4f7f5; }
    * { box-sizing:border-box; }
    body { margin:0; }
    main { width:min(100% - 2rem, 72rem); margin:0 auto; padding:3rem 0 5rem; }
    header { display:flex; gap:1rem; justify-content:space-between; align-items:center; margin-bottom:2rem; }
    h1,h2,h3,p { margin-top:0; }
    a { color:#68df91; }
    .brand { color:inherit; text-decoration:none; font-weight:800; font-size:1.25rem; }
    .grid { display:grid; grid-template-columns:repeat(auto-fit,minmax(17rem,1fr)); gap:1rem; }
    .card { background:#151917; border:1px solid #29302c; border-radius:1rem; padding:1.25rem; }
    .muted { color:#a9b2ac; }
    .error { color:#ff9d9d; }
    .success { color:#68df91; }
    input,button { font:inherit; border-radius:.55rem; padding:.75rem .9rem; border:1px solid #3a433e; }
    input { width:100%; color:inherit; background:#0e110f; }
    button { color:#07110a; background:#68df91; border-color:#68df91; cursor:pointer; font-weight:700; }
    button.secondary { color:#f4f7f5; background:#252b27; border-color:#3a433e; }
    form.inline { display:inline-flex; gap:.5rem; }
    .add-form { display:grid; grid-template-columns:1fr auto; gap:.75rem; }
    .playlist-head { display:flex; gap:1rem; align-items:center; }
    .cover { width:5rem; height:5rem; border-radius:.5rem; object-fit:cover; background:#252b27; }
    ol.items { padding-left:2rem; }
    ol.items li { padding:.45rem; border-bottom:1px solid #29302c; }
    .event { border-left:3px solid #68df91; padding-left:1rem; margin:1rem 0; }
    .countdown { display:inline-flex; align-items:center; gap:.4rem; padding:.35rem .6rem; border:1px solid #3a433e; border-radius:999px; color:#c9f7d8; background:#101713; font-variant-numeric:tabular-nums; }
    .countdown.due { color:#ffd28a; border-color:#765b2f; background:#1d180f; }
    .change-values { display:grid; grid-template-columns:1fr 1fr; gap:.75rem; margin-top:.75rem; }
    .change-values > div { background:#0e110f; border:1px solid #29302c; border-radius:.5rem; padding:.75rem; }
    .change-values p { margin:.25rem 0 0; white-space:pre-wrap; }
    .actions { display:flex; flex-wrap:wrap; gap:.5rem; }
    @media (max-width:600px) { .add-form { grid-template-columns:1fr; } header { align-items:flex-start; } }
  </style>
</head>
<body><main><header><a class="brand" href="/">Spotify Snooper</a></header>${body}</main>
<script>
  (() => {
    const timers = document.querySelectorAll("[data-countdown]");
    const two = (value) => String(value).padStart(2, "0");
    const update = () => {
      const now = Date.now();
      for (const timer of timers) {
        const label = timer.querySelector("span");
        if (!label) continue;
        if (timer.dataset.status === "paused") {
          label.textContent = "Paused";
          continue;
        }
        const target = Date.parse(timer.dataset.nextPoll || "");
        if (!Number.isFinite(target)) {
          label.textContent = "Not scheduled";
          continue;
        }
        const remaining = Math.max(0, Math.ceil((target - now) / 1000));
        if (remaining === 0) {
          timer.classList.add("due");
          label.textContent = timer.dataset.lastError
            ? "T-00:00 · retry pending"
            : "T-00:00 · polling…";
          continue;
        }
        timer.classList.remove("due");
        const days = Math.floor(remaining / 86400);
        const hours = Math.floor((remaining % 86400) / 3600);
        const minutes = Math.floor((remaining % 3600) / 60);
        const seconds = remaining % 60;
        label.textContent = days > 0
          ? "T-" + days + "d " + two(hours) + ":" + two(minutes) + ":" + two(seconds)
          : "T-" + two(hours) + ":" + two(minutes) + ":" + two(seconds);
      }
    };
    const refreshStatuses = async () => {
      if (![...timers].some((timer) => timer.classList.contains("due"))) return;
      try {
        const response = await fetch("/api/poll-status", {
          headers: { accept: "application/json" },
          cache: "no-store",
        });
        if (!response.ok) return;
        const statuses = await response.json();
        const byId = new Map(statuses.map((status) => [status.id, status]));
        for (const timer of timers) {
          const status = byId.get(timer.dataset.playlistId);
          if (!status) continue;
          timer.dataset.status = status.status;
          timer.dataset.nextPoll = status.nextPollAt;
          timer.dataset.lastError = status.lastError || "";
        }
        update();
      } catch {
        // Keep the timer due until the server confirms a completed poll.
      }
    };
    update();
    window.setInterval(update, 1000);
    window.setInterval(refreshStatuses, 3000);
  })();
</script>
</body>
</html>`;
}
