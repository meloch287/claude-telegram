export function revealPage() {
  const failed=document.querySelector('#error:not([hidden])');
  return window.gptNavigation.reveal(!failed);
}
