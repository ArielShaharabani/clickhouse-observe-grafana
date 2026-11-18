/**
 * Saves `parts` as a file named `fileName` in the browser.
 *
 * Grafana installs a document-level click handler that routes `<a href>` clicks through its own
 * router. A bubbling click on a blob link reaches it, the blob is navigated to instead of
 * downloaded, and Chrome saves it under a random UUID name. Dispatching a non-bubbling click keeps
 * the event on the anchor, so the browser's own download handling (and the `download` name) applies.
 */
export function saveFile(fileName: string, parts: BlobPart[], type: string): void {
  const url = URL.createObjectURL(new Blob(parts, { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.dispatchEvent(new MouseEvent('click', { bubbles: false, cancelable: true }));
  a.remove();
  // The download reads the blob asynchronously; revoking right away can abort it.
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
