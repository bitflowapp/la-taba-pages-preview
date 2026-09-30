// Rendered markup is the version: identical data causes no DOM writes. Keys
// preserve card/image identity across updates, sorting and temporary filters.
const versions = new WeakMap();
const detached = new WeakMap();
const keyFor = (node) => node?.nodeType === 1 ? node.getAttribute('data-catalog-key') : null;
const compatible = (a, b) => a?.nodeType === b.nodeType && a?.nodeName === b.nodeName;
const runtimeClass = (name) => name === 'is-motion-visible' || name.startsWith('motion-');

export function renderStableCatalog(container, html, { retainedKeys = null, cacheLimit = 120 } = {}) {
  if (!container || versions.get(container) === html) return;
  const template = container.ownerDocument.createElement('template');
  template.innerHTML = html;
  patchChildren(container, template.content, retainedKeys, cacheLimit);
  versions.set(container, html);
}

function remember(node, desired) {
  versions.set(node, desired.nodeType === 1 ? desired.outerHTML : desired.nodeValue);
  [...node.childNodes].forEach((child, i) => remember(child, desired.childNodes[i]));
}

function patchNode(node, desired, retainedKeys, cacheLimit) {
  const version = desired.nodeType === 1 ? desired.outerHTML : desired.nodeValue;
  if (versions.get(node) === version) return;
  if (node.nodeType !== 1) {
    if (node.nodeValue !== desired.nodeValue) node.nodeValue = desired.nodeValue;
    versions.set(node, version);
    return;
  }
  for (const attribute of [...node.attributes]) {
    // Motion owns these fields and a reveal is allowed only once per node.
    if (attribute.name.startsWith('data-motion-') || attribute.name === 'style') continue;
    if (!desired.hasAttribute(attribute.name)) node.removeAttribute(attribute.name);
  }
  for (const { name, value } of desired.attributes) {
    if (name === 'class') {
      const classes = new Set(value.split(/\s+/).filter(Boolean));
      [...node.classList].filter(runtimeClass).forEach((c) => classes.add(c));
      const next = [...classes].join(' ');
      if (node.className !== next) node.setAttribute(name, next);
    } else if (node.getAttribute(name) !== value) node.setAttribute(name, value);
  }
  patchChildren(node, desired, retainedKeys, cacheLimit);
  versions.set(node, version);
}

function patchChildren(parent, desired, retainedKeys, cacheLimit) {
  let pool = detached.get(parent);
  if (!pool) { pool = new Map(); detached.set(parent, pool); }
  const keyed = new Map([...parent.childNodes].filter(keyFor).map((n) => [keyFor(n), n]));
  let cursor = parent.firstChild;
  for (const next of [...desired.childNodes]) {
    const key = keyFor(next);
    let node = key ? keyed.get(key) || pool.get(key) : (!keyFor(cursor) && compatible(cursor, next) ? cursor : null);
    if (!compatible(node, next)) {
      node = next.cloneNode(true);
      remember(node, next);
    } else patchNode(node, next, retainedKeys, cacheLimit);
    if (key) pool.delete(key);
    if (node !== cursor) parent.insertBefore(node, cursor);
    cursor = node.nextSibling;
  }
  while (cursor) {
    const next = cursor.nextSibling;
    const key = keyFor(cursor);
    if (key && (!retainedKeys || !key.startsWith('product:') || retainedKeys.has(key))) pool.set(key, cursor);
    parent.removeChild(cursor);
    cursor = next;
  }
  for (const key of pool.keys()) {
    if (retainedKeys && key.startsWith('product:') && !retainedKeys.has(key)) pool.delete(key);
  }
  // Bound memory for catalogs much larger than the current one. Attached nodes
  // are never evicted; only a maximum of 120 recently filtered cards is kept.
  while (pool.size > cacheLimit) pool.delete(pool.keys().next().value);
}
