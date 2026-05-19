import { useRef, useEffect, useImperativeHandle, forwardRef } from "react";
import { EditorState, StateEffect, StateField, RangeSetBuilder } from "@codemirror/state";
import { EditorView, keymap, lineNumbers, highlightActiveLineGutter, highlightActiveLine, drawSelection, rectangularSelection, highlightSpecialChars, Decoration, type DecorationSet } from "@codemirror/view";
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { syntaxHighlighting, defaultHighlightStyle, bracketMatching, foldGutter, indentOnInput, foldKeymap } from "@codemirror/language";
import {
  autocompletion,
  closeBrackets,
  closeBracketsKeymap,
  completionKeymap,
  snippetCompletion,
  type Completion,
  type CompletionContext,
  type CompletionSource
} from "@codemirror/autocomplete";
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

export interface FindRange {
  start: number;
  end: number;
  active: boolean;
}

interface CodeEditorProps {
  value: string;
  language?: string;
  onChange?: (value: string) => void;
  readOnly?: boolean;
  darkMode?: boolean;
  lineWrapping?: boolean;
  className?: string;
  findRanges?: FindRange[];
}

export interface CodeEditorHandle {
  getView: () => EditorView | null;
  getValue: () => string;
  scrollToPosition: (pos: number) => void;
}

const setFindDecorations = StateEffect.define<DecorationSet>();

const findMatchMark = Decoration.mark({ class: "editor-find-match" });
const findMatchActiveMark = Decoration.mark({ class: "editor-find-match active" });

const findDecorationField = StateField.define<DecorationSet>({
  create() {
    return Decoration.none;
  },
  update(decorations, transaction) {
    for (const effect of transaction.effects) {
      if (effect.is(setFindDecorations)) {
        return effect.value;
      }
    }
    if (transaction.docChanged) {
      return decorations.map(transaction.changes);
    }
    return decorations;
  },
  provide: (field) => EditorView.decorations.from(field)
});

function normalizeLanguageName(lang?: string): string {
  return lang?.toLowerCase().replace(/^\.*/, "") ?? "";
}

function languageFamily(lang?: string): string {
  const normalized = normalizeLanguageName(lang);
  if (normalized === "js" || normalized === "jsx" || normalized === "ts" || normalized === "tsx" || normalized === "javascript" || normalized === "typescript") return "javascript";
  if (normalized === "py" || normalized === "python") return "python";
  if (normalized === "json" || normalized === "jsonc") return "json";
  if (normalized === "html" || normalized === "htm") return "html";
  if (normalized === "css" || normalized === "scss" || normalized === "less") return "css";
  if (normalized === "md" || normalized === "markdown") return "markdown";
  if (normalized === "java") return "java";
  if (normalized === "c" || normalized === "cpp" || normalized === "cc" || normalized === "cxx" || normalized === "h" || normalized === "hpp") return "cpp";
  if (normalized === "rs" || normalized === "rust") return "rust";
  if (normalized === "sh" || normalized === "bash" || normalized === "zsh" || normalized === "shell") return "shell";
  if (normalized === "yml" || normalized === "yaml") return "yaml";
  return normalized || "text";
}

function keyword(label: string, detail = "keyword"): Completion {
  return { label, detail, type: "keyword", boost: 1 };
}

function word(label: string, detail = "word", type = "variable"): Completion {
  return { label, detail, type };
}

function snippet(label: string, template: string, detail: string): Completion {
  return snippetCompletion(template, { label, detail, type: "keyword", boost: 2 });
}

const javascriptCompletions: Completion[] = [
  snippet("if", "if (${condition}) {\n\t${}\n}", "if block"),
  snippet("for", "for (let ${index} = 0; ${index} < ${end}; ${index}++) {\n\t${}\n}", "for loop"),
  snippet("forof", "for (const ${item} of ${items}) {\n\t${}\n}", "for...of"),
  snippet("function", "function ${name}(${params}) {\n\t${}\n}", "function"),
  snippet("async", "async function ${name}(${params}) {\n\t${}\n}", "async function"),
  snippet("try", "try {\n\t${}\n} catch (${error}) {\n\t\n}", "try/catch"),
  snippet("class", "class ${Name} {\n\tconstructor(${params}) {\n\t\t${}\n\t}\n}", "class"),
  snippet("console.log", "console.log(${value});", "log"),
  ...[
    "await",
    "break",
    "case",
    "catch",
    "const",
    "continue",
    "default",
    "else",
    "export",
    "extends",
    "false",
    "finally",
    "from",
    "import",
    "interface",
    "let",
    "new",
    "null",
    "return",
    "switch",
    "this",
    "throw",
    "true",
    "type",
    "typeof",
    "undefined",
    "while"
  ].map((item) => keyword(item))
];

const pythonCompletions: Completion[] = [
  snippet("def", "def ${name}(${params}):\n\t${}", "function"),
  snippet("class", "class ${Name}:\n\tdef __init__(self${params}):\n\t\t${}", "class"),
  snippet("if", "if ${condition}:\n\t${}", "if block"),
  snippet("for", "for ${item} in ${items}:\n\t${}", "for loop"),
  snippet("try", "try:\n\t${}\nexcept ${Exception} as ${error}:\n\tpass", "try/except"),
  snippet("with", "with ${expr} as ${name}:\n\t${}", "with block"),
  snippet("print", "print(${value})", "print"),
  ...[
    "and",
    "as",
    "assert",
    "async",
    "await",
    "break",
    "continue",
    "elif",
    "else",
    "except",
    "False",
    "finally",
    "from",
    "global",
    "import",
    "in",
    "is",
    "lambda",
    "None",
    "not",
    "or",
    "pass",
    "raise",
    "return",
    "self",
    "True",
    "while",
    "yield"
  ].map((item) => keyword(item))
];

const jsonCompletions: Completion[] = ["true", "false", "null"].map((item) => keyword(item, "value"));

const htmlCompletions: Completion[] = [
  snippet("div", "<div>\n\t${}\n</div>", "element"),
  snippet("section", "<section>\n\t${}\n</section>", "element"),
  snippet("script", "<script>\n\t${}\n</script>", "element"),
  snippet("style", "<style>\n\t${}\n</style>", "element"),
  ...["a", "button", "form", "h1", "h2", "img", "input", "label", "li", "main", "p", "span", "ul"].map((item) => word(item, "tag", "type")),
  ...["class", "href", "id", "rel", "src", "style", "target", "type", "value"].map((item) => word(item, "attribute", "property"))
];

const cssCompletions: Completion[] = [
  snippet("media", "@media (${query}) {\n\t${}\n}", "media query"),
  ...[
    "align-items",
    "background",
    "border",
    "border-radius",
    "box-shadow",
    "color",
    "display",
    "flex",
    "font-size",
    "font-weight",
    "gap",
    "grid-template-columns",
    "height",
    "justify-content",
    "margin",
    "max-width",
    "min-height",
    "opacity",
    "overflow",
    "padding",
    "position",
    "transform",
    "transition",
    "width",
    "z-index"
  ].map((item) => word(item, "property", "property")),
  ...["absolute", "auto", "block", "center", "flex", "grid", "hidden", "inline-flex", "none", "relative"].map((item) => keyword(item, "value"))
];

const javaCompletions: Completion[] = [
  snippet("class", "public class ${Name} {\n\t${}\n}", "class"),
  snippet("main", "public static void main(String[] args) {\n\t${}\n}", "main method"),
  snippet("if", "if (${condition}) {\n\t${}\n}", "if block"),
  snippet("for", "for (${type} ${item} : ${items}) {\n\t${}\n}", "for each"),
  ...[
    "boolean",
    "break",
    "catch",
    "class",
    "continue",
    "double",
    "else",
    "extends",
    "false",
    "final",
    "finally",
    "float",
    "implements",
    "import",
    "int",
    "new",
    "null",
    "private",
    "protected",
    "public",
    "return",
    "static",
    "String",
    "this",
    "throw",
    "true",
    "try",
    "void",
    "while"
  ].map((item) => keyword(item))
];

const cppCompletions: Completion[] = [
  snippet("if", "if (${condition}) {\n\t${}\n}", "if block"),
  snippet("for", "for (${type} ${i} = 0; ${i} < ${end}; ${i}++) {\n\t${}\n}", "for loop"),
  snippet("main", "int main() {\n\t${}\n\treturn 0;\n}", "main"),
  ...[
    "auto",
    "bool",
    "break",
    "case",
    "class",
    "const",
    "continue",
    "double",
    "else",
    "false",
    "float",
    "include",
    "int",
    "long",
    "namespace",
    "nullptr",
    "private",
    "protected",
    "public",
    "return",
    "std",
    "string",
    "struct",
    "switch",
    "true",
    "void",
    "while"
  ].map((item) => keyword(item))
];

const rustCompletions: Completion[] = [
  snippet("fn", "fn ${name}(${params}) {\n\t${}\n}", "function"),
  snippet("if", "if ${condition} {\n\t${}\n}", "if block"),
  snippet("for", "for ${item} in ${items} {\n\t${}\n}", "for loop"),
  snippet("match", "match ${value} {\n\t${pattern} => ${},\n}", "match"),
  ...[
    "as",
    "break",
    "const",
    "continue",
    "crate",
    "else",
    "enum",
    "false",
    "impl",
    "let",
    "loop",
    "mod",
    "mut",
    "pub",
    "return",
    "self",
    "Self",
    "struct",
    "true",
    "use",
    "where",
    "while"
  ].map((item) => keyword(item))
];

const shellCompletions: Completion[] = [
  snippet("if", "if [ ${condition} ]; then\n\t${}\nfi", "if block"),
  snippet("for", "for ${item} in ${items}; do\n\t${}\ndone", "for loop"),
  ...["case", "cd", "do", "done", "echo", "elif", "else", "export", "fi", "for", "function", "grep", "if", "then", "while"].map((item) => keyword(item))
];

const yamlCompletions: Completion[] = ["true", "false", "null"].map((item) => keyword(item, "value"));

const markdownCompletions: Completion[] = [
  snippet("link", "[${text}](${url})", "link"),
  snippet("image", "![${alt}](${url})", "image"),
  snippet("code", "```${language}\n${}\n```", "code fence")
];

const completionsByFamily: Record<string, Completion[]> = {
  cpp: cppCompletions,
  css: cssCompletions,
  html: htmlCompletions,
  java: javaCompletions,
  javascript: javascriptCompletions,
  json: jsonCompletions,
  markdown: markdownCompletions,
  python: pythonCompletions,
  rust: rustCompletions,
  shell: shellCompletions,
  yaml: yamlCompletions
};

const completionTokenPattern = /[A-Za-z_$][\w$-]*$/;
const completionValidFor = /^[\w$-]*$/;
const documentWordPattern = /[A-Za-z_$][\w$-]{2,}/g;

function documentWordCompletions(context: CompletionContext, currentWord: string, existingLabels: Set<string>): Completion[] {
  const docLength = context.state.doc.length;
  const from = Math.max(0, context.pos - 100000);
  const to = Math.min(docLength, context.pos + 100000);
  const text = context.state.sliceDoc(from, to);
  const options: Completion[] = [];
  let match: RegExpExecArray | null;

  while ((match = documentWordPattern.exec(text)) && options.length < 80) {
    const label = match[0];
    if (label === currentWord || existingLabels.has(label)) continue;
    existingLabels.add(label);
    options.push({ label, detail: "file", type: /^[A-Z]/.test(label) ? "type" : "variable", boost: -1 });
  }

  return options;
}

function createLightweightCompletionSource(lang?: string): CompletionSource {
  const languageOptions = completionsByFamily[languageFamily(lang)] ?? [];

  return (context) => {
    const token = context.matchBefore(completionTokenPattern);
    if (!token && !context.explicit) return null;
    if (token && token.text.length < 2 && !context.explicit) return null;

    const existingLabels = new Set<string>();
    const options: Completion[] = [];
    for (const option of languageOptions) {
      if (existingLabels.has(option.label)) continue;
      existingLabels.add(option.label);
      options.push(option);
    }
    options.push(...documentWordCompletions(context, token?.text ?? "", existingLabels));

    if (options.length === 0) return null;
    return {
      from: token?.from ?? context.pos,
      options,
      validFor: completionValidFor
    };
  };
}

function getLanguageExtension(lang?: string) {
  if (!lang) return [];
  const normalized = normalizeLanguageName(lang);
  if (normalized === "js" || normalized === "jsx" || normalized === "ts" || normalized === "tsx" || normalized === "javascript" || normalized === "typescript") {
    const typescript = normalized === "ts" || normalized === "tsx" || normalized === "typescript";
    const jsx = normalized === "jsx" || normalized === "tsx";
    return [javascript({ jsx, typescript })];
  }
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
  { value, language, onChange, readOnly = false, darkMode = false, lineWrapping = false, className, findRanges },
  ref
) {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const valueRef = useRef(value);
  const currentDocRef = useRef(value);
  const changeTimerRef = useRef<number | null>(null);
  const applyingExternalValueRef = useRef(false);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  valueRef.current = value;

  const langExt = getLanguageExtension(language);

  useImperativeHandle(ref, () => ({
    getView: () => viewRef.current,
    getValue: () => viewRef.current?.state.doc.toString() ?? currentDocRef.current,
    scrollToPosition: (pos: number) => {
      const view = viewRef.current;
      if (view) {
        view.dispatch({
          effects: EditorView.scrollIntoView(pos, { y: "center" })
        });
      }
    }
  }), []);

  useEffect(() => {
    if (!containerRef.current) return;

    currentDocRef.current = value;
    const completionSource = createLightweightCompletionSource(language);

    const publishChange = () => {
      if (changeTimerRef.current !== null) {
        window.clearTimeout(changeTimerRef.current);
        changeTimerRef.current = null;
      }
      const nextValue = currentDocRef.current;
      if (nextValue !== valueRef.current) {
        onChangeRef.current?.(nextValue);
      }
    };

    const updateListener = EditorView.updateListener.of((update) => {
      if (update.docChanged) {
        currentDocRef.current = update.state.doc.toString();
        if (applyingExternalValueRef.current) return;
        if (changeTimerRef.current !== null) {
          window.clearTimeout(changeTimerRef.current);
        }
        changeTimerRef.current = window.setTimeout(publishChange, 180);
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
        EditorState.languageData.of(() => [{ autocomplete: completionSource }]),
        autocompletion({
          activateOnTyping: true,
          activateOnTypingDelay: 120,
          defaultKeymap: false,
          maxRenderedOptions: 80
        }),
        rectangularSelection(),
        highlightActiveLine(),
        highlightSelectionMatches(),
        syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
        keymap.of([
          ...completionKeymap,
          ...closeBracketsKeymap,
          ...defaultKeymap,
          ...searchKeymap,
          ...historyKeymap,
          ...foldKeymap,
          indentWithTab
        ]),
        updateListener,
        findDecorationField,
        EditorView.editable.of(!readOnly),
        EditorState.readOnly.of(readOnly),
        ...(lineWrapping ? [EditorView.lineWrapping] : []),
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
      if (changeTimerRef.current !== null) {
        window.clearTimeout(changeTimerRef.current);
        changeTimerRef.current = null;
      }
      view.destroy();
      viewRef.current = null;
    };
  }, [language, readOnly, darkMode, lineWrapping]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    const currentDoc = view.state.doc.toString();
    if (currentDoc !== value) {
      applyingExternalValueRef.current = true;
      view.dispatch({
        changes: { from: 0, to: currentDoc.length, insert: value }
      });
      applyingExternalValueRef.current = false;
      currentDocRef.current = value;
    }
  }, [value]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    const ranges = findRanges ?? [];
    if (ranges.length === 0) {
      view.dispatch({ effects: setFindDecorations.of(Decoration.none) });
      return;
    }
    const docLength = view.state.doc.length;
    const builder = new RangeSetBuilder<Decoration>();
    const sorted = [...ranges].sort((a, b) => a.start - b.start || a.end - b.end);
    for (const range of sorted) {
      const from = Math.min(range.start, docLength);
      const to = Math.min(range.end, docLength);
      if (from >= to) continue;
      builder.add(from, to, range.active ? findMatchActiveMark : findMatchMark);
    }
    view.dispatch({ effects: setFindDecorations.of(builder.finish()) });
  }, [findRanges]);

  return <div ref={containerRef} className={className} data-i18n-skip="true" />;
});

export { languageFromFileName };
