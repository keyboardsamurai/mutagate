// mutmut version seams for the Python runner, required lazily by python(): the [tool.mutmut] section and the
// Python bridge that turns mutmut's own state into mutagate raw rows. mutmut 3.6 moved config into
// mutmut.configuration (Config.ensure_loaded, should_mutate), deprecated tests_dir/paths_to_mutate and added
// use_setproctitle; setproctitle in forked children segfaults on macOS. 3.8 replaced Config.ensure_loaded with
// configuration.config() and moved orig_function_and_class_names_from_key to mutmut.utils.format_utils.
const modern = (major, minor) => major > 3 || (major === 3 && minor >= 6);
const list = JSON.stringify;

function tomlConfig(major, minor, t, inputs = []) {
  if (major < 3) return '';
  // Preserve the scoped package around a single mutated file; editable installs otherwise win over its namespace copy.
  const dirs = t.file.split('/').slice(0, -1), root = dirs.map((_, i) => dirs.slice(0, i + 1).join('/')).find(d => inputs.includes(d + '/__init__.py'));
  const copy = root ? inputs.filter(f => f !== t.file && f.startsWith(root + '/')) : [];
  const extra = copy.length ? `also_copy = ${list(copy)}\n` : '';
  return modern(major, minor)
    ? `\n[tool.mutmut]\nsource_paths = ${list([t.file])}\npytest_add_cli_args_test_selection = ${list(t.tests)}\nuse_setproctitle = false\n${extra}`
    : `\n[tool.mutmut]\npaths_to_mutate = ${list([t.file])}\ntests_dir = ${list(t.tests)}\npytest_add_cli_args = ${list(['-x', '-q', ...t.tests])}\n${extra}`;
}

const head = `import ast, contextlib, io, json, re
from pathlib import Path
out=[]
def row(file, method, line, status, diff):
    changes=[s for s in diff.splitlines() if s[:1] in ('+','-') and not s.startswith(('+++','---'))]
    out.append(dict(file=str(file), method=method, line=line, status=status, mutator='mutmut:'+ '|'.join(changes), description='; '.join(changes)))
`;
const setup3 = `import mutmut.__main__ as mm
mm.ensure_config_loaded()
names=mm.orig_function_and_class_names_from_key
skip=lambda file: mm.mutmut.config.should_ignore_for_mutation(file)
`;
const setup36 = `import mutmut.__main__ as mm, mutmut.configuration as mc
cfg=mc.config() if hasattr(mc,'config') else (mc.Config.ensure_loaded() or mc.Config.get())
names=getattr(mm,'orig_function_and_class_names_from_key',None) or __import__('mutmut.utils.format_utils',fromlist=['_']).orig_function_and_class_names_from_key
skip=lambda file: not cfg.should_mutate(file)
`;
const collect3 = `for file in mm.walk_source_files():
    if skip(file): continue
    data=mm.SourceFileMutationData(path=file); data.load()
    tree=ast.parse(Path(file).read_text())
    for key, code in data.exit_code_by_key.items():
        name, cls=names(key)
        nodes=[n for n in ast.walk(tree) if isinstance(n,(ast.FunctionDef,ast.AsyncFunctionDef)) and n.name==name]
        base=nodes[0].lineno if len(nodes)==1 else 1
        with contextlib.redirect_stdout(io.StringIO()): diff=mm.get_diff_for_mutant(key,path=file)
        offset=re.search(r'@@ -([0-9]+)',diff)
        line=base+(int(offset[1])-1 if offset else 0)
        if offset:
            for part in diff[offset.end():].splitlines()[1:]:
                if part.startswith('-'): break
                if part.startswith(' '): line+=1
        status={'killed':'KILLED','survived':'SURVIVED','timeout':'TIMED_OUT','no tests':'NO_COVERAGE'}.get(mm.status_by_exit_code.get(code),'PENDING')
        row(file,name,line,status,diff)
`;
const collect2 = `from mutmut import cache
@cache.init_db
@cache.db_session
def collect():
    for mutant in cache.Mutant.select():
        status={'ok_killed':'KILLED','bad_survived':'SURVIVED','bad_timeout':'TIMED_OUT','skipped':'NON_VIABLE'}.get(mutant.status,'PENDING')
        diff=cache.get_unified_diff(mutant.id,[],update_cache=False)
        tree=ast.parse(Path(mutant.line.sourcefile.filename).read_text())
        line=mutant.line.line_number+1
        names=[n.name for n in ast.walk(tree) if isinstance(n,(ast.FunctionDef,ast.AsyncFunctionDef)) and n.lineno<=line<=n.end_lineno]
        row(mutant.line.sourcefile.filename,names[-1] if names else '',line,status,diff)
collect()
`;

function bridgeSource(major, minor) {
  return head + (major < 3 ? collect2 : (modern(major, minor) ? setup36 : setup3) + collect3) + 'print(json.dumps(out))\n';
}

module.exports = { tomlConfig, bridgeSource };
