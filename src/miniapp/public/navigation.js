const { lastSection, rememberSection, sections, engine } = window.gptNavigation;
export { lastSection, rememberSection };
export function prepareNavigation(page) {
  if (window.gptNavigation.redirecting) return true;
  const explicit = new URLSearchParams(location.search).get("section");
  if (sections.includes(explicit)) {
    rememberSection(explicit);
    const clean = new window.URL(location.href);
    clean.searchParams.delete("section");
    window.history.replaceState(null, "", clean.href);
  }
  const remembered = lastSection();
  if (page === "chats" && ["cats", "world"].includes(remembered)) {
    location.replace("./index.html?engine="+engine+"&section=" + remembered + location.hash);
    return true;
  }
  document.querySelectorAll("a[data-section]").forEach((link) => {
    // Preserve Telegram launch data across the two documents.
    const target = new window.URL(link.dataset.section==="admin"?"./chats.html":link.href,location.href);
    target.hash = location.hash;
    target.searchParams.set("engine",engine);
    link.href = target.href;
  });
  return false;
}
