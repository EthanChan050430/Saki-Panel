import fs from "node:fs";
import vm from "node:vm";
import { createRequire } from "node:module";
import ts from "typescript";

const require = createRequire(import.meta.url);
const root = new URL("../", import.meta.url);

export function sourceFile(relative) {
  const source = fs.readFileSync(new URL(relative, root), "utf8");
  return ts.createSourceFile(relative, source, ts.ScriptTarget.Latest, true,
    relative.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
}

export function evaluate(source, globals = {}, imports = {}) {
  const module = { exports: {} };
  const js = ts.transpileModule(source, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true
  } }).outputText;
  const context = vm.createContext({ module, exports: module.exports, Buffer, Date, Math, Error,
    require: id => id in imports ? imports[id] : require(id), ...globals });
  vm.runInContext(js, context);
  return context;
}

export function loadModule(relative, imports) {
  return evaluate(sourceFile(relative).text, {}, imports).module.exports;
}

export function loadFunctions(relative, names, globals) {
  const ast = sourceFile(relative);
  const declarations = ast.statements.filter(node => ts.isFunctionDeclaration(node) && names.includes(node.name?.text));
  return evaluate(declarations.map(node => node.getText(ast)).join("\n")
    + `\nObject.assign(exports, { ${names.join(", ")} });`, globals).module.exports;
}

export function loadCallback(relative, name, globals) {
  const ast = sourceFile(relative);
  let callback;
  function visit(node) {
    if (ts.isVariableDeclaration(node) && node.name.getText(ast) === name) callback = node.initializer.arguments[0];
    ts.forEachChild(node, visit);
  }
  visit(ast);
  if (!callback) throw new Error(`Callback not found: ${name}`);
  return evaluate(`exports.callback = ${callback.getText(ast)};`, globals).module.exports.callback;
}
