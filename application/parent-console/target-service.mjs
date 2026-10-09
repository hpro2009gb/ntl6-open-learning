import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildNtl6TargetModel } from '../../core/target/index.mjs';

const HERE=path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_ROOT=path.resolve(HERE,'..','..');

export function loadNtl6TargetModel(options={}) {
  const root=path.resolve(options.root??DEFAULT_ROOT);
  const archivePath=path.join(root,'content','exam-target','sample-district','archive-index.json');
  const archive=JSON.parse(fs.readFileSync(archivePath,'utf8'));
  return buildNtl6TargetModel({
    archive,
    asOf:options.asOf??new Date().toISOString(),
    targetYear:String(options.targetYear??'2027'),
    version:String(options.version??'R1-PROVISIONAL'),
    targetModelId:options.targetModelId??'NTL6-2027-TARGET'
  });
}

export function persistTargetSnapshot(model, options={}) {
  const root=path.resolve(options.root??DEFAULT_ROOT);
  const dir=path.join(root,'runtime-data','target','snapshots');
  fs.mkdirSync(dir,{recursive:true});
  const safe=String(model.version).replace(/[^A-Za-z0-9._-]+/g,'-');
  const file=path.join(dir,`${model.target_model_id}-${safe}.json`);
  fs.writeFileSync(file,JSON.stringify(model,null,2)+'\n','utf8');
  return file;
}
