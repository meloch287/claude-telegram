export function miniappUrl(uid, owner, publicUrl, ownerUrl = "") {
  const base = uid === owner && ownerUrl ? ownerUrl : publicUrl;
  const url = new URL(base);
  url.pathname = url.pathname.replace(/\/?$/, "/") + "modes.html";
  url.search = "?v=modes-20261008";
  return url.href;
}
