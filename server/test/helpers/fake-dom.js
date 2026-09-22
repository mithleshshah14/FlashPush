'use strict';

// A tiny DOM, just enough for the admin UI's `h()`/`icon()` helpers and the views built on them,
// so view behaviour can be tested in Node without a browser or extra dependencies.

class FakeNode {}

class FakeText extends FakeNode {
  constructor(data) {
    super();
    this.data = String(data);
  }

  get textContent() {
    return this.data;
  }
}

class FakeElement extends FakeNode {
  constructor(tag) {
    super();
    Object.assign(this, {
      tag, children: [], attributes: {}, dataset: {}, listeners: {}, className: '', hidden: false, disabled: false,
      value: '', rows: 1, placeholder: '', scrollTop: 0, scrollHeight: 0, clientHeight: 0, focused: false,
    });
  }

  get textContent() {
    return this.children.map((child) => child.textContent).join('');
  }

  set textContent(value) {
    this.children = [];
    if (value !== '') this.append(new FakeText(value));
  }

  append(...nodes) {
    for (const node of nodes) {
      if (node instanceof FakeElement) node.parent = this;
      this.children.push(node instanceof FakeNode ? node : new FakeText(node));
    }
  }

  replaceChildren(...nodes) {
    this.children = [];
    this.append(...nodes);
  }

  remove() {
    if (this.parent) this.parent.children = this.parent.children.filter((child) => child !== this);
  }

  setAttribute(name, value) {
    this.attributes[name] = String(value);
  }

  getAttribute(name) {
    return name in this.attributes ? this.attributes[name] : null;
  }

  removeAttribute(name) {
    delete this.attributes[name];
  }

  addEventListener(type, listener) {
    (this.listeners[type] ||= []).push(listener);
  }

  /** Fires listeners like the browser would; `event.defaultPrevented` tells whether one called preventDefault(). */
  async dispatch(type, event = {}) {
    const fired = { ...event, defaultPrevented: false, preventDefault() { fired.defaultPrevented = true; } };
    for (const listener of this.listeners[type] || []) await listener(fired);
    return fired;
  }

  focus() {
    this.focused = true;
  }

  /** Just enough for the admin UI's own usage: a bare tag name, e.g. `button.querySelector('span')`. */
  querySelector(tag) {
    for (const child of this.children) {
      if (child instanceof FakeElement) {
        if (child.tag === tag) return child;
        const found = child.querySelector(tag);
        if (found) return found;
      }
    }
    return null;
  }
}

/** Installs the globals the UI helpers expect. Call once, before importing the UI modules. */
function installFakeDom() {
  globalThis.Node = FakeNode;
  globalThis.document = {
    createElement: (tag) => new FakeElement(tag),
    createElementNS: (_ns, tag) => new FakeElement(tag),
    createTextNode: (text) => new FakeText(text),
  };
}

const classes = (node) => String(node.className || '').split(' ').filter(Boolean);

function* walk(node) {
  yield node;
  for (const child of node.children || []) yield* walk(child);
}

const findAll = (root, predicate) => [...walk(root)].filter((node) => node instanceof FakeElement && predicate(node));
const byClass = (root, name) => findAll(root, (node) => classes(node).includes(name));
const byTag = (root, tag) => findAll(root, (node) => node.tag === tag);

module.exports = { installFakeDom, FakeElement, byClass, byTag, findAll };
