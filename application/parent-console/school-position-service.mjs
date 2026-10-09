const POSITION_FIELDS=['unit','lesson','page'];

function text(value){
  if(value===null||value===undefined) return null;
  const normalized=String(value).trim();
  return normalized||null;
}

function comparable(value){
  const normalized=text(value);
  return normalized===null?null:normalized.replace(/\s+/g,' ').toLocaleUpperCase('en-US');
}

function requireObservation(observation){
  if(!observation||typeof observation!=='object'||Array.isArray(observation)){
    throw new Error('INVALID_SCHOOL_POSITION_OBSERVATION');
  }
  for(const field of ['source','observed_at','subject']){
    if(text(observation[field])===null) throw new Error('INVALID_SCHOOL_POSITION_OBSERVATION');
  }
  return observation;
}

function requireArray(value,name){
  if(value===undefined) return [];
  if(!Array.isArray(value)) throw new Error(`INVALID_${name}`);
  return value;
}

function entryKey(entry){
  return [entry.id,entry.subject,entry.unit,entry.lesson,entry.page]
    .map((value)=>comparable(value)??'')
    .join('\u0000');
}

function observationKey(observation){
  return [observation.observed_at,observation.id,observation.source,observation.subject]
    .map((value)=>comparable(value)??'')
    .join('\u0000');
}

function compareRecords(left,right){
  return observationKey(left).localeCompare(observationKey(right));
}

function matchingEntries(observation,knownEntries){
  return knownEntries
    .filter((entry)=>entry&&typeof entry==='object'&&!Array.isArray(entry))
    .filter((entry)=>comparable(entry.subject)===comparable(observation.subject))
    .filter((entry)=>POSITION_FIELDS.every((field)=>{
      const observed=comparable(observation[field]);
      return observed===null||(comparable(entry[field])!==null&&comparable(entry[field])===observed);
    }))
    .sort((left,right)=>entryKey(left).localeCompare(entryKey(right)));
}

function hasId(observation,id){
  return id!==null&&comparable(observation?.id)===id;
}

function correctionId(observation){
  return comparable(observation.corrects_observation_id);
}

function sameObservationWindow(left,right){
  return ['source','observed_at','subject'].every((field)=>comparable(left[field])===comparable(right[field]));
}

function contradicts(left,right){
  return POSITION_FIELDS.some((field)=>{
    const leftValue=comparable(left[field]);
    const rightValue=comparable(right[field]);
    return leftValue!==null&&rightValue!==null&&leftValue!==rightValue;
  });
}

function isSuperseded(observation,observations){
  const id=comparable(observation.id);
  return id!==null&&observations.some((candidate)=>candidate!==observation&&correctionId(candidate)===id);
}

function unknowns(observation){
  return POSITION_FIELDS
    .filter((field)=>text(observation[field])===null)
    .map((field)=>`${field.toUpperCase()}_UNKNOWN`);
}

/**
 * Resolves one school-reported position against caller-supplied catalog entries.
 * It is a pure planning-context projection: callers retain observation storage.
 */
export function resolveSchoolPositionObservation(options={}){
  const observation=requireObservation(options.observation);
  const knownEntries=requireArray(options.known_entries,'KNOWN_ENTRIES');
  const observations=requireArray(options.observations,'OBSERVATIONS');
  const allObservations=[...observations,observation];
  const observationId=comparable(observation.id);
  const correctedId=correctionId(observation);
  const correctionOf=correctedId===null
    ?null
    :allObservations.find((candidate)=>candidate!==observation&&hasId(candidate,correctedId))??null;
  const supersededBy=observationId===null
    ?[]
    :allObservations
      .filter((candidate)=>candidate!==observation&&correctionId(candidate)===observationId)
      .sort(compareRecords);
  const conflictsWith=allObservations
    .filter((candidate)=>candidate!==observation)
    .filter((candidate)=>!isSuperseded(candidate,allObservations))
    .filter((candidate)=>sameObservationWindow(observation,candidate)&&contradicts(observation,candidate))
    .filter((candidate)=>correctionId(observation)!==comparable(candidate.id))
    .sort(compareRecords);
  const candidateEntries=matchingEntries(observation,knownEntries);

  let state='UNRESOLVED';
  if(supersededBy.length) state='SUPERSEDED';
  else if(conflictsWith.length) state='CONFLICT';
  else if(candidateEntries.length===1) state='RESOLVED';
  else if(candidateEntries.length>1) state='AMBIGUOUS';

  return {
    contract_version:'SCHOOL_POSITION_OBSERVATION/1.0',
    state,
    planning_only:true,
    mastery_evidence:false,
    observation,
    position:{
      source:text(observation.source),
      observed_at:text(observation.observed_at),
      subject:text(observation.subject),
      unit:text(observation.unit),
      lesson:text(observation.lesson),
      page:text(observation.page),
      confidence:text(observation.confidence),
      supporting_ref:text(observation.supporting_ref)
    },
    resolved_entry:state==='RESOLVED'?candidateEntries[0]:null,
    candidate_entries:candidateEntries,
    lineage:{
      correction_of_id:text(observation.corrects_observation_id),
      correction_of:correctionOf,
      superseded_by:supersededBy,
      conflicts_with:conflictsWith
    },
    unknowns:unknowns(observation)
  };
}
