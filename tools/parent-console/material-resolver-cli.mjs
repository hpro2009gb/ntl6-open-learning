import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { createParentConsoleFacade } from '../../application/parent-console/facade.mjs';

const HERE=path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_ROOT=path.resolve(HERE,'..','..');

function safeJson(value){
  if(value==null||value==='') return {};
  if(typeof value==='object') return value;
  try { return JSON.parse(String(value)); }
  catch { throw new Error('INVALID_QUERY_JSON'); }
}

export function executeMaterialCommand({facade,command,payload={}}){
  const input=safeJson(payload);
  if(command==='search') return facade.getMaterials(input);
  if(command==='current') return facade.getCurrentMaterial(input);
  if(command==='get'){
    const id=input.assessment_id??input.assessmentId;
    if(!id) throw new Error('ASSESSMENT_ID_REQUIRED');
    return facade.getMaterialResolution(id,{artifact_ref:input.artifact_ref??input.artifactRef??null});
  }
  throw new Error('UNKNOWN_MATERIAL_COMMAND');
}

export function runMaterialResolverCli(options={}){
  const argv=options.argv??process.argv.slice(2);
  const command=argv[0]??'search';
  const payload=safeJson(argv[1]??'{}');
  const root=path.resolve(options.root??process.env.NTL6_ROOT??DEFAULT_ROOT);
  const facade=options.facade??createParentConsoleFacade({root,learnerId:payload.learner_id??'default-learner'});
  const result=executeMaterialCommand({facade,command,payload});
  const output=JSON.stringify(result,null,2);
  if(options.stdout?.write) options.stdout.write(output+'\n');
  return result;
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  try{
    runMaterialResolverCli({stdout:process.stdout});
  }catch(error){
    process.stderr.write(JSON.stringify({error_code:String(error?.message??error).split(':')[0],message:String(error?.message??error)})+'\n');
    process.exitCode=1;
  }
}
