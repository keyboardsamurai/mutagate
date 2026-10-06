function glob(pattern) {
  let s = '', depth = 0;
  for (let i = 0; i < pattern.length; i++) {
    const ch = pattern[i];
    if (ch === '*') {
      if (pattern[i + 1] === '*') {
        i++;
        if (pattern[i + 1] === '/') {
          i++;
          s += '(?:.*/)?';
        } else s += '.*';
      } else s += '[^/]*';
    } else if (ch === '?') s += '[^/]';
    else if (ch === '{') { depth++; s += '(?:'; }
    else if (ch === '}') { if (!depth--) throw Error('unbalanced glob braces'); s += ')'; }
    else if (ch === ',') s += depth ? '|' : ',';
    else s += ch.replace(/[|\\{}()[\]^$+?.]/g, '\\$&');
  }
  if (depth) throw Error('unbalanced glob braces');
  return new RegExp('^' + s + '$');
}

exports.glob = glob;
