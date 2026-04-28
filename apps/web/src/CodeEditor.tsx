import { useRef, useEffect, useImperativeHandle, forwardRef } from "react";
import { EditorState } from "@codemirror/state";
import { EditorView, keymap, lineNumbers, highlightActiveLineGutter, highlightActiveLine, drawSelection, rectangularSelection, highlightSpecialChars } from "@codemirror/view";
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { syntaxHighlighting, defaultHighlightStyle, bracketMatching, foldGutter, indentOnInput, foldKeymap } from "@codemirror/language";
import { closeBrackets, closeBracketsKeymap, autocompletion, completionKeymap } from "@codemirror/autocomplete";
import { searchKeymap, highlightSelectionMatches } from "@codemirror/search";
import { oneDark } from "@codemirror/theme-one-dark";
import { javascript } from "@codemirror/lang-javascript";
import { python } from "@codemirror/lang-python";
import { json } from "@codemirror/lang-json";
import { html } from "@codemirror/lang-html";
import { css } from "@codemirror/lang-css";
import { markdown } from "@codemirror/lang-markdown";
import { java } from "@codemirror/lang-java";
import { cpp } from "@codemirror/lang-cpp";
import { rust } from "@codemirror/lang-rust";

interface CodeEditorProps {
  value: string;
  language?: string;
  onChange?: (value: string) => void;
  readOnly?: boolean;
  darkMode?: boolean;
  className?: string;
}

export interface CodeEditorHandle {
  getView: () => EditorView | null;
}

function getLanguageExtension(lang?: string) {
  if (!lang) return [];
  const normalized = lang.toLowerCase().replace(/^\.*/, "");
  if (normalized === "js" || normalized === "jsx" || normalized === "ts" || normalized === "tsx" || normalized === "javascript" || normalized === "typescript") return [javascript({ jsx: true, typescript: normalized.includes("ts") })];
  if (normalized === "py" || normalized === "python") return [python()];
  if (normalized === "json") return [json()];
  if (normalized === "html" || normalized === "htm") return [html()];
  if (normalized === "css" || normalized === "scss" || normalized === "less") return [css()];
  if (normalized === "md" || normalized === "markdown") return [markdown()];
  if (normalized === "java") return [java()];
  if (normalized === "c" || normalized === "cpp" || normalized === "cc" || normalized === "cxx" || normalized === "h" || normalized === "hpp") return [cpp()];
  if (normalized === "rs" || normalized === "rust") return [rust()];
  return [];
}

function languageFromFileName(fileName?: string): string | undefined {
  if (!fileName) return undefined;
  const ext = fileName.split(".").pop();
  return ext;
}

export const CodeEditor = forwardRef<CodeEditorHandle, CodeEditorProps>(function CodeEditor(
  { value, language, onChange, readOnly = false, darkMode = false, className },
  ref
) {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  const langExt = getLanguageExtension(language);

  useImperativeHandle(ref, () => ({
    getView: () => viewRef.current
  }), []);

  useEffect(() => {
    if (!containerRef.current) return;

    const updateListener = EditorView.updateListener.of((update) => {
      if (update.docChanged) {
        onChangeRef.current?.(update.state.doc.toString());
      }
    });

    const state = EditorState.create({
      doc: value,
      extensions: [
        lineNumbers(),
        highlightActiveLineGutter(),
        highlightSpecialChars(),
        history(),
        foldGutter(),
        drawSelection(),
        indentOnInput(),
        bracketMatching(),
        closeBrackets(),
        autocompletion(),
        rectangularSelection(),
        highlightActiveLine(),
        highlightSelectionMatches(),
        syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
        keymap.of([
          ...closeBracketsKeymap,
          ...defaultKeymap,
          ...searchKeymap,
          ...historyKeymap,
          ...foldKeymap,
          ...completionKeymap,
          indentWithTab
        ]),
        updateListener,
        EditorView.editable.of(!readOnly),
        EditorState.readOnly.of(readOnly),
        ...langExt,
        ...(darkMode ? [oneDark] : []),
        EditorView.theme({
          "&": { height: "100%" },
          ".cm-scroller": { overflow: "auto" }
        })
      ]
    });

    const view = new EditorView({
      state,
      parent: containerRef.current
    });

    viewRef.current = view;

    return () => {
      view.destroy();
      viewRef.current = null;
    };
  }, [language, readOnly, darkMode]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    const currentDoc = view.state.doc.toString();
    if (currentDoc !== value) {
      view.dispatch({
        changes: { from: 0, to: currentDoc.length, insert: value }
      });
    }
  }, [value]);

  return <div ref={containerRef} className={className} />;
});

export { languageFromFileName };
