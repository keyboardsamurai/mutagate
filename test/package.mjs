import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
export function packageSkill(destination) {
  const root=path.resolve(import.meta.dirname,'..');
  if(fs.existsSync(destination))throw Error('Package destination must not already exist.');
  fs.mkdirSync(destination,{recursive:true});
  for(const entry of ['SKILL.md','README.md','LICENSE','scripts','references'])fs.cpSync(path.join(root,entry),path.join(destination,entry),{recursive:true,filter:src=>path.basename(src)!=='.node-path'}); // machine-specific, written by install
  let bytes=0;function count(dir){for(const e of fs.readdirSync(dir,{withFileTypes:true})){const p=path.join(dir,e.name);if(e.isDirectory())count(p);else bytes+=fs.statSync(p).size;}}count(destination);
  if(bytes>=300000)throw Error(`Skill exceeds 300 KB: ${bytes}`);
  return bytes;
}
if(process.argv[1]===fileURLToPath(import.meta.url)){if(!process.argv[2])throw Error('Provide an empty output path');console.log(JSON.stringify({bytes:packageSkill(path.resolve(process.argv[2]))}));}
