// Ward -> neighbourhood (community area) context for chiwardboard.
//
// METHOD: the 311 records themselves carry BOTH `ward` and `community_area`
// for each request, assigned by the city's own geocoder. Grouping 2025
// requests by (ward, community_area) gives, for every ward, the community
// areas its service requests actually come from, weighted by where residents
// file. Community area numbers are resolved to names from the city's
// Community Areas dataset (igwz-8jzy).
//
// WHY NOT POLYGON OVERLAP: computing true area overlap would need polygon
// clipping between 50 ward shapes and 77 community areas. That is doable but
// it answers a different question - share of land, not share of the place
// people live and file from. A ward can hold a large empty rail yard or
// industrial tract that dominates by area and means nothing to a resident.
//
// LIMITATIONS, stated because they matter:
//  - Weighted by request volume, not by population or by area. A community
//    area that complains more will rank higher than an equally populous
//    quieter one.
//  - Rows with a null community_area are excluded from the shares.
//  - Boundary assignment is the city's, inherited warts and all.
//  - This is context for recognition, not an authoritative boundary claim.
const BASE='https://data.cityofchicago.org/resource/v6vf-nfxy.json';
const AREAS='https://data.cityofchicago.org/resource/igwz-8jzy.json';
const Y="created_date >= '2025-01-01T00:00:00' AND created_date < '2026-01-01T00:00:00'";
const MIN_SHARE = 0.08;   // ignore slivers under 8% of a ward's requests
const MAX_SHOWN = 3;      // two or three names, never an exhaustive list

const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function get(url,label){
  for(let a=1;a<=5;a++){
    try{ const r=await fetch(url,{signal:AbortSignal.timeout(90000)}); if(r.ok) return r.json(); }
    catch(e){}
    if(a<5) await sleep(Math.min(2000*2**(a-1),30000));
  }
  throw new Error('exhausted '+label);
}
// The dataset stores names in caps; plain title-casing mangles the ones Chicagoans
// would notice, so the irregulars are corrected explicitly.
const FIX = { 'Ohare':"O'Hare", 'Mckinley Park':'McKinley Park', 'Ohare ':"O'Hare" };
const titleCase=s=>{
  const t=String(s).toLowerCase().replace(/\b[a-z]/g,c=>c.toUpperCase())
    .replace(/\bOf\b/g,'of').replace(/\bAnd\b/g,'and').replace(/\bThe\b/g,'the').trim();
  return FIX[t] || t;
};

const areas=await get(`${AREAS}?$limit=200`,'areas');
const areaName=Object.fromEntries(areas.map(a=>[String(Number(a.area_numbe??a.area_num_1)), titleCase(a.community)]));
console.log(`community areas resolved: ${Object.keys(areaName).length}`);

const rows=await get(`${BASE}?${new URLSearchParams({
  $select:'ward, community_area, count(1) as c',
  $where:`${Y} AND ward IS NOT NULL AND community_area IS NOT NULL`,
  $group:'ward, community_area', $order:'count(1) DESC', $limit:'50000'})}`,'pairs');
console.log(`ward/community-area pairs: ${rows.length}`);

const byWard=new Map();
for(const r of rows){
  const w=Number(r.ward), ca=String(Number(r.community_area)), c=Number(r.c);
  if(!Number.isFinite(w)||w<1||w>50) continue;
  if(!byWard.has(w)) byWard.set(w,{total:0,areas:[]});
  const e=byWard.get(w); e.total+=c; e.areas.push({ca,c});
}
const out={};
for(const [w,e] of [...byWard.entries()].sort((a,b)=>a[0]-b[0])){
  const ranked=e.areas.sort((a,b)=>b.c-a.c)
    .map(a=>({name:areaName[a.ca]||`Area ${a.ca}`, share:a.c/e.total}))
    .filter(a=>a.share>=MIN_SHARE).slice(0,MAX_SHOWN);
  out[w]={ names: ranked.map(a=>a.name),
           shares: ranked.map(a=>Math.round(a.share*1000)/10),
           requests: e.total };
}
const fs=await import('node:fs/promises');
await fs.writeFile(new URL('../data/ward-neighborhoods.json',import.meta.url),
  JSON.stringify({source:'v6vf-nfxy ward+community_area co-occurrence, 2025; names from igwz-8jzy',
    method:'share of the ward’s 2025 requests by community area', minShare:MIN_SHARE, maxShown:MAX_SHOWN, wards:out})+'\n');
console.log(`wrote data/ward-neighborhoods.json for ${Object.keys(out).length} wards`);
