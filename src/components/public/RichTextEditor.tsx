import { useRef, useState, useEffect } from "react";
import { Bold, Italic, Underline, List, ListOrdered, Link2, Undo2, Redo2 } from "lucide-react";
import { cn } from "@/lib/utils";

// Lightweight visual editor used by the public /faq support form.
//
// Why not a third-party editor (Tiptap, Slate)? The form needs five
// formatting actions — bold, italic, underline, bullet/ordered list,
// link — and emits HTML for an email body. Bringing in 50+ KB of
// editor framework + ProseMirror to power that is overkill. A plain
// `contentEditable` div + `document.execCommand` covers everything we
// need, ships with no new dependencies, and is well-supported in
// every browser the marketing site targets (modern Chrome / Firefox
// / Safari / iOS Safari / Android Chrome).
//
// `execCommand` is officially deprecated, but every major browser
// keeps it working specifically because thousands of legacy editors
// rely on it. If a future browser drops it we can swap in a proper
// editor — the API surface here is intentionally tiny.
//
// Output: the parent gets `value` (HTML) AND `text` (plain-text via
// .innerText) on every change so the submission can carry both.

interface RichTextEditorProps {
  value: string;          // HTML string
  onChange: (html: string, text: string) => void;
  placeholder?: string;
  ariaLabel?: string;
  invalid?: boolean;
  minHeight?: number;
}

export function RichTextEditor({
  value,
  onChange,
  placeholder = "اكتب تفاصيل طلبك هنا…",
  ariaLabel = "محرر النص",
  invalid = false,
  minHeight = 180,
}: RichTextEditorProps) {
  const editorRef = useRef<HTMLDivElement>(null);
  const [isEmpty, setIsEmpty] = useState(true);
  const [isFocused, setIsFocused] = useState(false);

  // Initial content sync — only on mount and when an external reset
  // (value === "") is requested. Re-syncing on every value change
  // would clobber the user's caret position while typing.
  useEffect(() => {
    if (!editorRef.current) return;
    if (value === "" && editorRef.current.innerHTML !== "") {
      editorRef.current.innerHTML = "";
      setIsEmpty(true);
    } else if (value && editorRef.current.innerHTML === "") {
      editorRef.current.innerHTML = value;
      setIsEmpty(editorRef.current.innerText.trim().length === 0);
    }
  }, [value]);

  const exec = (command: string, arg?: string) => {
    if (!editorRef.current) return;
    editorRef.current.focus();
    document.execCommand(command, false, arg);
    handleInput();
  };

  const handleInput = () => {
    if (!editorRef.current) return;
    const html = editorRef.current.innerHTML;
    const text = editorRef.current.innerText;
    setIsEmpty(text.trim().length === 0);
    onChange(html, text);
  };

  const insertLink = () => {
    const url = window.prompt("أدخل الرابط:", "https://");
    if (!url) return;
    if (!/^https?:\/\//i.test(url)) {
      window.alert("الرابط يجب أن يبدأ بـ http:// أو https://");
      return;
    }
    exec("createLink", url);
  };

  return (
    <div className="rich-editor">
      {/* Toolbar */}
      <div
        className={cn(
          "flex flex-wrap items-center gap-1 px-2 py-1.5 border border-b-0 rounded-t-xl bg-black/[0.02]",
          invalid ? "border-red-300" : "border-black/15",
        )}
        role="toolbar"
        aria-label="أدوات التنسيق"
      >
        <ToolbarButton title="غامق" onClick={() => exec("bold")}>
          <Bold className="h-4 w-4" strokeWidth={2.2} />
        </ToolbarButton>
        <ToolbarButton title="مائل" onClick={() => exec("italic")}>
          <Italic className="h-4 w-4" strokeWidth={2.2} />
        </ToolbarButton>
        <ToolbarButton title="تحته خط" onClick={() => exec("underline")}>
          <Underline className="h-4 w-4" strokeWidth={2.2} />
        </ToolbarButton>
        <span className="w-px h-5 bg-black/15 mx-1" aria-hidden />
        <ToolbarButton title="قائمة نقطية" onClick={() => exec("insertUnorderedList")}>
          <List className="h-4 w-4" strokeWidth={2.2} />
        </ToolbarButton>
        <ToolbarButton title="قائمة مرقمة" onClick={() => exec("insertOrderedList")}>
          <ListOrdered className="h-4 w-4" strokeWidth={2.2} />
        </ToolbarButton>
        <span className="w-px h-5 bg-black/15 mx-1" aria-hidden />
        <ToolbarButton title="إدراج رابط" onClick={insertLink}>
          <Link2 className="h-4 w-4" strokeWidth={2.2} />
        </ToolbarButton>
        <span className="flex-1" />
        <ToolbarButton title="تراجع" onClick={() => exec("undo")}>
          <Undo2 className="h-4 w-4" strokeWidth={2.2} />
        </ToolbarButton>
        <ToolbarButton title="إعادة" onClick={() => exec("redo")}>
          <Redo2 className="h-4 w-4" strokeWidth={2.2} />
        </ToolbarButton>
      </div>

      {/* Editor surface */}
      <div className="relative">
        <div
          ref={editorRef}
          contentEditable
          dir="rtl"
          role="textbox"
          aria-label={ariaLabel}
          aria-multiline="true"
          aria-invalid={invalid || undefined}
          onInput={handleInput}
          onFocus={() => setIsFocused(true)}
          onBlur={() => setIsFocused(false)}
          // Strip formatting on paste so users dragging text from
          // arbitrary websites don't bring along inline styles or
          // unsafe markup. Plain text is converted via execCommand
          // so undo/redo still works.
          onPaste={(e) => {
            e.preventDefault();
            const text = e.clipboardData.getData("text/plain");
            document.execCommand("insertText", false, text);
          }}
          className={cn(
            "w-full px-4 py-3.5 rounded-b-xl text-[15px] text-black bg-white outline-none transition-colors",
            "border border-t-0",
            invalid
              ? "border-red-300 focus:border-red-400"
              : isFocused
                ? "border-black/40"
                : "border-black/15",
          )}
          style={{ minHeight }}
          suppressContentEditableWarning
        />
        {isEmpty && !isFocused && (
          <div
            className="absolute top-3.5 right-4 pointer-events-none text-[15px] text-black/35"
            aria-hidden
          >
            {placeholder}
          </div>
        )}
      </div>

      {/* Editor styling — applied locally so list bullets / link
          colors render correctly in RTL inside the contentEditable. */}
      <style>{`
        .rich-editor [contenteditable] ul { list-style: disc; padding-right: 1.5rem; margin: 0.25rem 0; }
        .rich-editor [contenteditable] ol { list-style: decimal; padding-right: 1.5rem; margin: 0.25rem 0; }
        .rich-editor [contenteditable] li { margin: 0.125rem 0; }
        .rich-editor [contenteditable] a { color: #4a6cc7; text-decoration: underline; }
        .rich-editor [contenteditable] p { margin: 0; }
      `}</style>
    </div>
  );
}

function ToolbarButton({
  title,
  onClick,
  children,
}: {
  title: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  // mousedown over click so the editor doesn't lose its caret/
  // selection before the formatting command runs.
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      onMouseDown={(e) => {
        e.preventDefault();
        onClick();
      }}
      className="inline-flex items-center justify-center w-8 h-8 rounded-md text-black/65 hover:bg-black/[0.06] hover:text-black transition-colors"
    >
      {children}
    </button>
  );
}
