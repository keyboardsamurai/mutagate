// Preserve offsets while removing comments and literals. Nested Kotlin comments
// and triple-quoted strings must not manufacture class or function declarations.
function kotlinCode(source) {
  let out = '', i = 0;
  while (i < source.length) {
    const start = i;
    if (source.startsWith('//', i)) {
      i = source.indexOf('\n', i);
      if (i < 0) i = source.length;
    } else if (source.startsWith('/*', i)) {
      i += 2;
      let depth = 1;
      while (i < source.length && depth) {
        if (source.startsWith('/*', i)) { depth++; i += 2; }
        else if (source.startsWith('*/', i)) { depth--; i += 2; }
        else i++;
      }
    } else if (source.startsWith('"""', i)) {
      const end = source.indexOf('"""', i + 3);
      i = end < 0 ? source.length : end + 3;
    } else if (source[i] === '"' || source[i] === "'") {
      const quote = source[i++];
      while (i < source.length) {
        if (source[i] === '\\') i += 2;
        else if (source[i++] === quote) break;
      }
    } else { out += source[i++]; continue; }
    out += source.slice(start, i).replace(/[^\n]/g, ' ');
  }
  return out;
}

// Resolve only empty, top-level marker interfaces declared in the same file.
// External types, inherited interfaces, delegation and generic supertypes remain
// unproven: they may supply behavior, so their mutants must stay eligible.
function markerInterfaces(code) {
  const names = new Set();
  for (const match of code.matchAll(/\binterface\s+(\w+)\b/g)) {
    const prefix = code.slice(0, match.index);
    if ((prefix.match(/{/g)?.length || 0) !== (prefix.match(/}/g)?.length || 0)) continue;
    const rest = code.slice(match.index + match[0].length).trimStart();
    if (!rest || /^\{\s*\}/.test(rest) || /^(?:(?:public|internal|private|data|sealed|enum|abstract|open|final)\s+)*(?:class|interface|object|fun|val|var)\b/.test(rest)) names.add(match[1]);
  }
  return names;
}

function dataClassRule(m, source) {
  if (!m.file.endsWith('.kt') || !/^(?:equals|hashCode|toString|component\d+|copy|copy\$default)$/.test(m.method)) return;
  const code = kotlinCode(source);
  const pkg = code.match(/^\s*package\s+([\w.]+)/m)?.[1];
  // Only top-level declarations are proven here. Nested/local classes stay
  // eligible until their full JVM owner can be established without ambiguity.
  for (const match of code.matchAll(/\bdata\s+class\s+(\w+)\s*\(/g)) {
    const prefix = code.slice(0, match.index);
    if ((prefix.match(/{/g)?.length || 0) !== (prefix.match(/}/g)?.length || 0)) continue;
    if ([pkg, match[1]].filter(Boolean).join('.') !== m.class) continue;
    let i = match.index + match[0].length, depth = 1;
    while (i < code.length && depth) {
      if (code[i] === '(') depth++;
      if (code[i] === ')') depth--;
      i++;
    }
    if (depth) continue;
    const tail = code.slice(i);
    const nextDeclaration = tail.search(/\b(?:(?:public|internal|private|data|sealed|enum|abstract|open|final)\s+)*(?:class|interface|object|fun|val|var)\b/);
    const brace = tail.indexOf('{');
    const hasBody = brace >= 0 && (nextDeclaration < 0 || brace < nextDeclaration);
    const header = hasBody ? tail.slice(0, brace) : tail.slice(0, nextDeclaration < 0 ? tail.length : nextDeclaration);
    if (header.includes(':')) {
      const parents = header.trim().match(/^:\s*([\w.]+(?:\s*,\s*[\w.]+)*)\s*$/)?.[1];
      const markers = markerInterfaces(code);
      if (!parents || !parents.split(',').every(parent => {
        const name = parent.trim();
        return markers.has(name) || pkg && name.startsWith(pkg + '.') && markers.has(name.slice(pkg.length + 1));
      })) continue;
    }
    let body = '';
    if (hasBody) {
      const start = i + brace + 1;
      i = start; depth = 1;
      while (i < code.length && depth) {
        if (code[i] === '{') depth++;
        if (code[i] === '}') depth--;
        i++;
      }
      if (depth) continue;
      body = code.slice(start, i - 1);
    }
    if (new RegExp('\\bfun\\s+(?:`' + m.method + '`|' + m.method.replaceAll('$', '\\$') + ')\\s*\\(').test(body)) return;
    return { id: 'data-class-synthetic', reason: 'Generated method on a source-proven data class with no explicit implementation.' };
  }
}

// Top-level declarations compile to the file facade `<package>.<File>Kt`, or the
// @file:JvmName override. ponytail: @JvmMultifileClass parts are not resolved.
function facadeClass(file, source) {
  const pkg = kotlinCode(source).match(/^\s*package\s+([\w.]+)/m)?.[1];
  const name = source.match(/@file\s*:\s*JvmName\s*\(\s*"([^"]+)"/)?.[1] ||
    file.split(/[\\/]/).pop().replace(/\.kt$/, '').replace(/[^\w$]/g, '_').replace(/^[a-z]/, ch => ch.toUpperCase()) + 'Kt';
  return [pkg, name].filter(Boolean).join('.');
}

function continuationRule(m, source) {
  if (!m.file.endsWith('.kt') || m.method !== 'invokeSuspend') return;
  const owner = m.class?.match(/^(.*)\$([A-Za-z_]\w*)\$\d+$/);
  if (!owner || m.line !== 0) return;
  const code = kotlinCode(source);
  const pkg = code.match(/^\s*package\s+([\w.]+)/m)?.[1];
  const name = owner[1].split('.').at(-1);
  if (owner[1] !== facadeClass(m.file, source) && (owner[1] !== [pkg, name].filter(Boolean).join('.') || !new RegExp('\\bclass\\s+' + name + '\\b').test(code))) return;
  if (!new RegExp('\\bsuspend\\s+fun\\s+' + owner[2] + '\\s*\\(').test(code)) return;
  return { id: 'source-continuation', reason: 'Generated continuation forwarding method for a source-declared suspend function.' };
}

exports.kotlinCode = kotlinCode;
exports.dataClassRule = dataClassRule;
exports.continuationRule = continuationRule;
exports.facadeClass = facadeClass;
