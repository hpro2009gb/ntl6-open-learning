import fs from 'node:fs';
import path from 'node:path';

const WEEKDAYS=['SUNDAY','MONDAY','TUESDAY','WEDNESDAY','THURSDAY','FRIDAY','SATURDAY'];
const SCHOOL_DAYS=['MONDAY','TUESDAY','WEDNESDAY','THURSDAY','FRIDAY'];

function readJson(file){ return JSON.parse(fs.readFileSync(file,'utf8')); }
function rel(root,file){ return path.relative(root,file).replaceAll('\\','/'); }

function localParts(asOf,timeZone){
  const date=new Date(asOf);
  if(Number.isNaN(date.getTime())) throw new Error('INVALID_AS_OF');
  const parts=new Intl.DateTimeFormat('en-US',{
    timeZone,
    year:'numeric',month:'2-digit',day:'2-digit',weekday:'long'
  }).formatToParts(date);
  const get=(type)=>parts.find((x)=>x.type===type)?.value;
  const weekday=String(get('weekday')??'').toUpperCase();
  return {
    year:Number(get('year')),
    month:Number(get('month')),
    day:Number(get('day')),
    local_date:`${get('year')}-${get('month')}-${get('day')}`,
    weekday
  };
}

function addLocalDays(parts,offset){
  const d=new Date(Date.UTC(parts.year,parts.month-1,parts.day+offset,12,0,0));
  return d.toISOString().slice(0,10);
}

function selectTimetable(root,classId,localDate){
  const dir=path.join(root,'runtime-data','school-context');
  if(!fs.existsSync(dir)) return null;
  const prefix=`class-${classId}-timetable-`;
  const candidates=fs.readdirSync(dir)
    .filter((name)=>name.startsWith(prefix)&&name.endsWith('.json'))
    .map((name)=>({name,date:name.slice(prefix.length,-5)}))
    .filter((x)=>/^\d{4}-\d{2}-\d{2}$/.test(x.date)&&x.date<=localDate)
    .sort((a,b)=>b.date.localeCompare(a.date));
  if(!candidates.length) return null;
  const file=path.join(dir,candidates[0].name);
  return {file,record:readJson(file)};
}

function periodsFor(record,dayKey){
  const value=record?.days?.[dayKey];
  return Array.isArray(value)?value:[];
}

function externalLoad(periods){
  if(periods.length>=7) return 'HIGH';
  if(periods.length>=4) return 'MEDIUM';
  return 'LOW';
}

function nextSchoolDay(record,currentIndex,parts){
  for(let offset=1;offset<=7;offset+=1){
    const key=WEEKDAYS[(currentIndex+offset)%7];
    const periods=periodsFor(record,key);
    if(SCHOOL_DAYS.includes(key)&&periods.length){
      return {date:addLocalDays(parts,offset),weekday:key,periods};
    }
  }
  return null;
}

export function resolveSchoolPlanningContext(options={}){
  const root=path.resolve(options.root??process.cwd());
  const classId=String(options.classId??'DEMO_CLASS');
  const asOf=options.asOf??new Date().toISOString();
  const fallbackTimeZone=options.timeZone??'Asia/Ho_Chi_Minh';
  const initialParts=localParts(asOf,fallbackTimeZone);
  const selected=selectTimetable(root,classId,initialParts.local_date);
  if(!selected){
    return {
      contract_version:'SCHOOL_PLANNING_CONTEXT/1.0',
      status:'NOT_FOUND',
      class_id:classId,
      as_of:asOf,
      timezone:fallbackTimeZone,
      planning_only:true,
      mastery_evidence:false,
      current_school_day:null,
      next_school_day:null,
      workload_context:{
        day_type:SCHOOL_DAYS.includes(initialParts.weekday)?'WEEKDAY':'WEEKEND',
        readiness:'UNKNOWN',
        external_load:'UNKNOWN',
        schedule_known:false,
        unusual_load:'UNKNOWN',
        supplemental_events_today:[],
        missed_prior_minutes:0
      }
    };
  }

  const record=selected.record;
  const timeZone=record.timezone??fallbackTimeZone;
  const parts=localParts(asOf,timeZone);
  const currentIndex=WEEKDAYS.indexOf(parts.weekday);
  const periods=periodsFor(record,parts.weekday);
  const dayType=SCHOOL_DAYS.includes(parts.weekday)?'WEEKDAY':'WEEKEND';
  const next=nextSchoolDay(record,currentIndex,parts);

  return {
    contract_version:'SCHOOL_PLANNING_CONTEXT/1.0',
    status:'READY',
    class_id:classId,
    as_of:asOf,
    timezone:timeZone,
    source_ref:rel(root,selected.file),
    source_verified_at:record.verified_at??null,
    planning_only:true,
    mastery_evidence:false,
    current_school_day:{
      date:parts.local_date,
      weekday:parts.weekday,
      periods,
      school_period_count:periods.length
    },
    next_school_day:next,
    workload_context:{
      day_type:dayType,
      readiness:'UNKNOWN',
      external_load:externalLoad(periods),
      schedule_known:true,
      unusual_load:'NONE',
      supplemental_events_today:[],
      missed_prior_minutes:0
    },
    uncertain_abbreviations:Array.isArray(record.uncertain_abbreviations)?record.uncertain_abbreviations:[]
  };
}
