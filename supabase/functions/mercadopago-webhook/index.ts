import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
const json=(data:unknown,status=200)=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json'}});
function constantTimeEquals(a:string,b:string){if(a.length!==b.length)return false;let n=0;for(let i=0;i<a.length;i++)n|=a.charCodeAt(i)^b.charCodeAt(i);return n===0}
async function signatureOk(req:Request,id:string,secret:string){const sig=req.headers.get('x-signature')||'',requestId=req.headers.get('x-request-id')||'';const parts=Object.fromEntries(sig.split(',').map(x=>x.trim().split('=')));if(!parts.ts||!parts.v1||!requestId||!id)return false;
 const ts=Number(parts.ts);if(!Number.isFinite(ts)||Math.abs(Date.now()-ts)>5*60*1000)return false;
 const manifest=`id:${id.toLowerCase()};request-id:${requestId};ts:${parts.ts};`;
 const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign']);
 const raw=new Uint8Array(await crypto.subtle.sign('HMAC',key,new TextEncoder().encode(manifest)));
 return constantTimeEquals(Array.from(raw).map(x=>x.toString(16).padStart(2,'0')).join(''),parts.v1.toLowerCase());}
Deno.serve(async req=>{
 if(req.method!=='POST')return json({error:'Method not allowed'},405);
 const secret=Deno.env.get('MP_WEBHOOK_SECRET'),token=Deno.env.get('MP_ACCESS_TOKEN');if(!secret||!token)return json({error:'Not configured'},503);
 const url=new URL(req.url);let body:Record<string,unknown>={};try{body=await req.json()}catch{return json({error:'Invalid payload'},400)}
 const data=body.data as Record<string,unknown>|undefined;const id=url.searchParams.get('data.id')||String(data?.id||'');
 if(!await signatureOk(req,id,secret))return json({error:'Invalid signature'},401);
 const topic=String(body.type||body.topic||url.searchParams.get('type')||'');
 const db=createClient(Deno.env.get('SUPABASE_URL')!,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
 if(topic==='subscription_preapproval'||topic==='preapproval'){
  const mp=await fetch(`https://api.mercadopago.com/preapproval/${encodeURIComponent(id)}`,{headers:{Authorization:`Bearer ${token}`}});
  if(!mp.ok)return json({error:'Provider lookup failed'},502);
  const subscription=await mp.json();const known=['pending','authorized','paused','cancelled','rejected'];
  const state=known.includes(subscription.status)?subscription.status:'pending';
  // Only update a subscription that we created: match both Mercado Pago id and external_reference.
  const{data:member}=await db.from('memberships').select('id').eq('mp_preapproval_id',String(subscription.id)).eq('id',String(subscription.external_reference)).maybeSingle();
  if(!member)return json({ok:true,ignored:true});
  const{error}=await db.from('memberships').update({status:state,last_provider_update:new Date().toISOString()}).eq('id',member.id);if(error)return json({error:'DB failure'},500);
  await db.from('payment_events').insert({membership_id:member.id,event_type:`subscription_${state}`,mp_resource_id:String(subscription.id),payload:{provider_status:subscription.status,provider_date:subscription.last_modified||null}});
 }else if(topic==='payment'){
  const mp=await fetch(`https://api.mercadopago.com/v1/payments/${encodeURIComponent(id)}`,{headers:{Authorization:`Bearer ${token}`}});
  if(!mp.ok)return json({error:'Payment lookup failed'},502);
  const payment=await mp.json();
  // Attempt linking via a related preapproval ID. Do not assign user membership status from a single payment event.
  const preapproval=payment.point_of_interaction?.transaction_data?.subscription_id||payment.metadata?.preapproval_id||null;
  let memberId=null;
  if(preapproval){const{data:member}=await db.from('memberships').select('id').eq('mp_preapproval_id',String(preapproval)).maybeSingle();memberId=member?.id||null;}
  await db.from('payment_events').insert({membership_id:memberId,event_type:`payment_${payment.status||'unknown'}`,mp_resource_id:String(payment.id),payload:{status:payment.status,amount:payment.transaction_amount,currency:payment.currency_id,date_approved:payment.date_approved}});
 }
 return json({ok:true});
});
