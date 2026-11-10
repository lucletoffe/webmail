"use client";

import { Node as TiptapNode, mergeAttributes, type Editor } from "@tiptap/core";
import { NodeSelection, TextSelection } from "@tiptap/pm/state";
import { DOMParser as ProseMirrorDOMParser } from "@tiptap/pm/model";
import { parseHtmlSafely, sanitizeComposerIslandHtml } from "@/lib/email-sanitization";
import { htmlToPlainText } from "@/lib/html-to-text";

import { SIGNATURE_BLOCK_MARKER, SIGNATURE_RANGE_MARKER, containsEmbeddedSignature } from "./signature-markers";

// The markers and the helpers that only read or write the HTML live in
// signature-markers.ts, so the send path and the reader can use them without
// loading the editor (Tiptap and ProseMirror).
export { SIGNATURE_BLOCK_MARKER, SIGNATURE_RANGE_MARKER, buildSignatureBlock, containsEmbeddedSignature } from "./signature-markers";

/**
 * Force every link in the rendered signature to open in a new tab.
 *
 * Applied to the NodeView's DOM only, never to `attrs.html` — that attribute is
 * what serializeEditorContent emits into the sent message, and the recipient's
 * copy should stay exactly as the user wrote it. Without this the composer's
 * signature is a set of live, target-less anchors in the main document (the
 * message body gets a sandboxed iframe; this does not), so one stray click
 * navigates the whole app away and takes the unsent draft with it.
 */
function forceLinksToNewTab(root: HTMLElement): void {
  root.querySelectorAll("a[href]").forEach((a) => {
    a.setAttribute("target", "_blank");
    a.setAttribute("rel", "noopener noreferrer");
  });
}

/**
 * Events the browser keeps when they come from inside the signature island:
 * the ones that select text and copy it, and the start of a drag, which the
 * island cancels (undust fork, sig3). Everything else - keys, input, drops -
 * stays ProseMirror's.
 */
const ISLAND_NATIVE_EVENTS = new Set([
  "mousedown", "mouseup", "click", "dblclick", "contextmenu",
  "pointerdown", "pointerup", "pointermove",
  "touchstart", "touchmove", "touchend",
  "selectstart", "copy", "cut",
  "focus", "blur", "focusin", "focusout", "dragstart",
]);

/**
 * SignatureBlock — an atomic, NON-editable block node that carries the
 * *verbatim* HTML of the user's identity signature in its `html` attribute.
 *
 * Why: the signature is embedded into the composer so it stays in the body,
 * but parsing rich, table-based "brand" signatures into the ProseMirror schema
 * strips their inline CSS (background/text colors, fonts, border-radius). By
 * holding the signature as an atom it is never parsed into the schema, so the
 * styling survives 1:1 — both in the editor (rendered by the NodeView below)
 * and in the sent mail (emitted by serializeEditorContent in quoted-html.ts).
 *
 * Mirrors QuotedHtml, but the inner region is read-only: a signature is meant
 * to be inserted/removed as a unit, not edited inline. Select the node (arrow
 * keys, or Backspace after it) and press Backspace/Delete to drop the whole
 * signature. Its text can be selected and copied like the reading view's
 * (undust fork, sig3).
 *
 * Read-only is the default, not a wall (#822): double-click the block to
 * dissolve it into regular editable content via
 * {@link unlockSignatureBlock}. That trades the verbatim-styling guarantee
 * for editability - the explicit user gesture is what makes the trade
 * acceptable, unlike the silent flattening #476 fixed. (Enter on the selected
 * block deliberately keeps ProseMirror's default create-paragraph-after
 * behaviour - it is a low-intent everyday key.)
 */
export const SignatureBlock = TiptapNode.create({
  name: "signatureBlock",
  group: "block",
  atom: true,
  selectable: true,
  draggable: false,
  // Isolating keeps selection/gapcursor behaviour sane at the boundary.
  isolating: true,

  addOptions() {
    return {
      // Translated tooltip shown on the block ("Double-click to edit the
      // signature"). Set via .configure() where translations are available;
      // empty means no tooltip.
      editHint: "",
    };
  },

  addAttributes() {
    return {
      html: {
        default: "",
        // Capture the verbatim inner HTML when parsing. Because the node is an
        // atom, ProseMirror does NOT descend into the children, so the rich
        // signature markup never hits (and is never mangled by) the schema.
        // Sanitized here, since a re-opened draft hands it in unsanitized.
        parseHTML: (el) => sanitizeComposerIslandHtml(el.innerHTML),
        // Not an HTML attribute: renderHTML below puts it inside the wrapper,
        // and serializeEditorContent inlines it for the send / draft path.
        renderHTML: () => ({}),
      },
    };
  },

  parseHTML() {
    return [{ tag: `div[${SIGNATURE_BLOCK_MARKER}]` }];
  },

  renderHTML({ node, HTMLAttributes }) {
    // Used for ProseMirror's clipboard (and getHTML, and a plugin reading the
    // selection). The send / draft path uses serializeEditorContent() which
    // inlines attrs.html itself.
    //
    // undust fork (sig3): the wrapper carries the signature's own HTML, so
    // Ctrl+A / Ctrl+C of the body copies the signature too (an empty wrapper
    // dropped it from the clipboard), and pasting it back into a composer
    // parses into a signature block again. Built in an inert document, so
    // building it loads nothing; a serializer working in the app document
    // (lib/plugin-sandbox/composer-edit.ts) adopts it, and the signature's
    // images then load as the island's already do. attrs.html is sanitized
    // on every way in (parseHTML, buildSignatureBlock's callers).
    const inert = document.implementation.createHTMLDocument("");
    const wrapper = inert.createElement("div");
    for (const [name, value] of Object.entries(mergeAttributes(HTMLAttributes, { [SIGNATURE_BLOCK_MARKER]: "" }))) {
      if (value !== null && value !== undefined && value !== false) wrapper.setAttribute(name, String(value));
    }
    wrapper.innerHTML = String(node.attrs.html || "");
    return wrapper;
  },

  renderText({ node }) {
    // The text ProseMirror's plain-text clipboard (and getText) gives the
    // signature: its lines, not nothing (undust fork, sig3).
    return htmlToPlainText(String(node.attrs.html || ""));
  },

  addNodeView() {
    return ({ node, editor, getPos }) => {
      const dom = document.createElement("div");
      dom.setAttribute(SIGNATURE_BLOCK_MARKER, "");
      dom.className = "signature-block-island";
      if (this.options.editHint) {
        dom.title = this.options.editHint;
      }
      // Double-click dissolves the atom into regular editable content (#822).
      // The listener sits on the wrapper; shadow-root events are composed, so
      // it fires for the whole island.
      dom.addEventListener("dblclick", (event) => {
        // A double-click landing on a link is the user working the link (the
        // first click already opened it) - not a request to start editing.
        if (event.composedPath().some((t) => (t as Element).tagName === "A")) return;
        const pos = typeof getPos === "function" ? getPos() : undefined;
        if (pos == null) return;
        // Only claim the event when the unlock actually ran - in a read-only
        // editor the default dblclick behaviour must stay untouched.
        if (unlockSignatureBlock(editor, pos)) event.preventDefault();
      });


      // CRITICAL: render the signature inside a Shadow Root. The app's global
      // CSS (Tailwind preflight, .tiptap table/td rules, box-sizing resets)
      // would otherwise cascade INTO the signature and destroy its layout -
      // exactly the corruption we are fixing. Shadow DOM isolates both
      // directions, so only the browser's UA defaults + the signature's own
      // inline styles apply and the in-editor preview matches the sent mail.
      const shadow = dom.attachShadow({ mode: "open" });
      const inner = document.createElement("div");
      // Read-only: a signature is inserted/removed as a unit, not edited inline.
      inner.contentEditable = "false";
      // ...but its text can be selected and copied (undust fork, sig3): with
      // the island non-editable inside an editable host, `user-select: auto`
      // resolves differently across engines, so say it.
      inner.style.cssText = "user-select:text;-webkit-user-select:text;outline:none;";
      // A press inside the island takes the focus off the editor: while the
      // editor has it, ProseMirror reads every selectionchange, sees the
      // selection at the shadow host and puts its caret back, which wiped
      // the text selection as it was being made (drag, long press). Focused,
      // the island is the browser's; ProseMirror keeps the atom selected, so
      // Backspace/Delete still remove the whole signature.
      inner.tabIndex = -1;
      const selectAtom = () => {
        const pos = typeof getPos === "function" ? getPos() : undefined;
        if (pos == null || !editor.isEditable) return;
        const { state } = editor.view;
        if (state.selection instanceof NodeSelection && state.selection.from === pos) return;
        editor.view.dispatch(state.tr.setSelection(NodeSelection.create(state.doc, pos)).setMeta("addToHistory", false));
      };
      inner.addEventListener("focus", selectAtom);
      // A key pressed there is meant for the editor: give it the focus back
      // first, so ProseMirror acts on the selected atom with the DOM in step
      // (Enter, then typing, lands in the new line; Ctrl+A shows what it
      // selects). Copy keeps the island's text selection. The listener runs
      // before ProseMirror's, which sits on the editor.
      inner.addEventListener("keydown", (event) => {
        if (["Control", "Meta", "Shift", "Alt"].includes(event.key)) return;
        if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "c") return;
        editor.view.focus();
        // Focusing the editor reads the browser's caret, which is not on
        // the atom: select it again before ProseMirror takes the key.
        selectAtom();
      });
      // Dragging selected signature text would move the whole block (the
      // atom is what ProseMirror holds selected), out of its markers.
      inner.addEventListener("dragstart", (event) => event.preventDefault());
      // Track what we were given, not what's in the DOM: forceLinksToNewTab
      // rewrites the markup, so inner.innerHTML no longer round-trips against
      // attrs.html and comparing the two would rewrite on every transaction.
      let appliedHtml = node.attrs.html || "";
      inner.innerHTML = appliedHtml;
      forceLinksToNewTab(inner);
      shadow.appendChild(inner);

      return {
        dom,
        // ProseMirror must not try to reconcile the foreign shadow content.
        ignoreMutation: () => true,
        // undust fork (sig3): pointer, touch and clipboard events from inside
        // the island are the browser's, so a drag, a long press or a
        // double-click selects the signature's text and Copy copies it
        // (focus included: the island's focus is not the editor's). When
        // ProseMirror took them, a click selected the whole atom and the text
        // could never be selected (nor copied, on a phone). Events inside the
        // shadow root are retargeted to `dom`. Keys are not in the list, so
        // they stay ProseMirror's wherever they come from: the arrows still
        // select the atom and Backspace/Delete remove the whole signature.
        // The double-click unlock above is a listener of its own.
        stopEvent: (event) => {
          if (!ISLAND_NATIVE_EVENTS.has(event.type)) return false;
          const target = event.target as Node | null;
          return !!target && dom.contains(target);
        },
        update: (updatedNode) => {
          if (updatedNode.type.name !== "signatureBlock") return false;
          const nextHtml = updatedNode.attrs.html || "";
          if (nextHtml !== appliedHtml) {
            appliedHtml = nextHtml;
            inner.innerHTML = nextHtml;
            forceLinksToNewTab(inner);
          }
          return true;
        },
      };
    };
  },
});

// Block elements that must not end up inside a <p>: a div containing any of
// these is a container, not a text line, and is left for the schema parse.
const NON_LINE_BLOCKS =
  "div, p, table, ul, ol, blockquote, h1, h2, h3, h4, h5, h6, hr, pre, address, figure, dl";

// Inherited style properties hoisted from wrapper divs onto the generated
// line paragraphs. Wrappers themselves have no schema node and are dropped by
// the parse, so without hoisting the font/color the whole signature inherits
// from its container would silently vanish on unlock. Longhands only: setting
// the `font` shorthand would reset font longhands the line declares itself
// (browsers expose shorthand values through the longhands anyway).
// Non-inherited properties (background, border, padding) are deliberately NOT
// hoisted - per-line copies would render differently than the container did.
const INHERITED_STYLE_PROPS = [
  "font-family", "font-size", "font-style", "font-weight",
  "color", "line-height", "letter-spacing", "text-transform", "direction",
];

/**
 * Line-level <div>s render margin-less in mail clients, but the editor schema
 * has no div node: parsing would re-wrap their content into default-margin
 * paragraphs and the signature's tight line structure blows apart into spaced
 * paragraphs. Rewrite leaf divs into explicit margin-0 paragraphs (keeping
 * their attributes, inheriting wrapper styles) so the unlocked signature
 * keeps the locked rendering's line spacing - the composer's paragraph
 * preserves inline styles. Vertical margins are reset only where the line
 * does not set them itself; horizontal margins (indented lines) are left
 * alone. <br> runs and <p> blocks are untouched (the schema already handles
 * those faithfully). Returns the parsed body element, ready for the
 * ProseMirror DOM parser.
 */
function normalizeSignatureHtmlForEditing(html: string): HTMLElement {
  const doc = parseHtmlSafely(html);
  const body = doc.body;
  body.querySelectorAll("div").forEach((div) => {
    if (div.querySelector(NON_LINE_BLOCKS)) return;
    const p = doc.createElement("p");
    for (const attr of Array.from(div.attributes)) p.setAttribute(attr.name, attr.value);
    // Hoist inherited styles from wrapper divs, outermost first so closer
    // wrappers win; the line's own declarations always take precedence.
    const wrappers: HTMLElement[] = [];
    for (let ancestor = div.parentElement; ancestor && ancestor !== body; ancestor = ancestor.parentElement) {
      if (ancestor.tagName === "DIV") wrappers.unshift(ancestor);
    }
    for (const wrapper of wrappers) {
      for (const prop of INHERITED_STYLE_PROPS) {
        const value = wrapper.style.getPropertyValue(prop);
        if (value && !div.style.getPropertyValue(prop)) p.style.setProperty(prop, value);
      }
    }
    // A div renders with zero margins; reset only the verticals the line
    // does not declare itself, keeping explicit spacing and indents intact.
    if (!p.style.margin) {
      if (!p.style.marginTop) p.style.marginTop = "0";
      if (!p.style.marginBottom) p.style.marginBottom = "0";
    }
    while (div.firstChild) p.appendChild(div.firstChild);
    div.replaceWith(p);
  });
  // An empty signature still needs a block to put the caret into.
  if (!body.firstElementChild) body.appendChild(doc.createElement("p"));
  return body;
}

/**
 * Dissolve the signature atom at `pos` into regular, editable editor content
 * (#822). The verbatim HTML is parsed into the schema at the atom's position -
 * the pre-#476 representation, with the known consequence that heavily styled
 * markup may be normalized by the schema. Leaf <div> lines are rewritten to
 * margin-0 paragraphs first so the line spacing survives the parse (see
 * normalizeSignatureHtmlForEditing). The bracketing `data-signature-block`
 * marker paragraphs live OUTSIDE the atom and are left untouched, so the
 * identity-switch splice and the send path's already-embedded detection keep
 * working on the unlocked content, and switching identities re-embeds a fresh
 * locked block. Undo restores the atom.
 */
export function unlockSignatureBlock(editor: Editor, pos: number): boolean {
  if (!editor.isEditable) return false;
  const node = editor.state.doc.nodeAt(pos);
  if (!node || node.type.name !== "signatureBlock") return false;
  const body = normalizeSignatureHtmlForEditing(String(node.attrs.html || ""));
  // Parse as a CLOSED document (complete blocks) and splice it in with one
  // plain transaction. insertContentAt parses an OPEN slice instead, and
  // fitting an open slice may split text runs at hard breaks - which turned a
  // <br>-lined signature into one spaced paragraph per line in the browser.
  // A closed fragment of complete blocks cannot be refitted that way.
  const parsed = ProseMirrorDOMParser.fromSchema(editor.state.schema).parse(body, {
    preserveWhitespace: false,
  });
  const tr = editor.state.tr.replaceWith(pos, pos + node.nodeSize, parsed.content);
  tr.setSelection(TextSelection.near(tr.doc.resolve(pos))).scrollIntoView();
  editor.view.dispatch(tr);
  editor.view.focus();
  return true;
}

// The quotes of a body (QuotedHtml islands, blockquotes), as
// lib/org/body-match.ts reads them; quoted-html.ts imports this module.
const QUOTES = "[data-quoted-html], blockquote";

/**
 * Whether the body carries a signature marker outside its quotes (undust
 * fork, sig3). A mail sent from the composer keeps its markers, so a reply
 * written elsewhere that quotes one carries them too, in the quote: that
 * says nothing about who wrote the reply.
 */
export function containsOwnEmbeddedSignature(html: string): boolean {
  if (!containsEmbeddedSignature(html)) return false;
  const body = parseHtmlSafely(html).body;
  body.querySelectorAll(QUOTES).forEach((quote) => quote.remove());
  return !!body.querySelector(`[${SIGNATURE_RANGE_MARKER}], [${SIGNATURE_BLOCK_MARKER}]`);
}
