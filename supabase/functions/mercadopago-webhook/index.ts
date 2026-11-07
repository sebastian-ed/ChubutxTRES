import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
const json=(v:unknown,status=200)=>new Response(JSON.stringify(v),{status,headers:{'Content-Type':'application/json'}});
const eq=(a:string,b:string)=>{if(a.length!==b.length)return false;let diff=0;for(let i=0;i<a.length;i++)diff|=a.charCodeAt(i)^b.charCodeAt(i);return diff===0};
function parseSignature(h:string){const out:Record<string,string>={};for(const section of h.split(',')){const n=section.indexOf('=');if(n>0)out[section.slice(0,n).trim()]=section.slice(n+1).trim()}return out}
async function signatureValid(req:Request,id:string,secret:string){
 const sig=parseSignature(req.headers.get('x-signature')||'');const rid=req.headers.get('x-request-id')||'';
 if(!sig.ts||!sig.v1||!/^[0-9a-f]{64}$/i.test(sig.v1)||!rid||!id)return false;
 const t=Number(sig.ts);if(!Number.isFinite(t))return false;
 // MP signature docs have examples with millisecond Unix timestamps; accept seconds as well.
 const timestamp=sig.ts.length<=10?t*1000:t;
 if(Math.abs(Date.now()-timestamp)>10*60*1000)return false;
 const manifest=`id:${id.toLowerCase()};request-id:${rid};ts:${sig.ts};`;
 const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign']);
 const bytes=new Uint8Array(await crypto.subtle.sign('HMAC',key,new TextEncoder().encode(manifest)));
 const hex=[...bytes].map(x=>x.toString(16).padStart(2,'0')).join('');return eq(hex,sig.v1.toLowerCase());
}
const cleanId=(v:unknown)=>typeof v==='string'||typeof v==='number'?String(v):'';
async function mpGet(route:string,token:string){const r=await fetch(`https://api.mercadopago.com${route}`,{headers:{Authorization:`Bearer ${token}`},signal:AbortSignal.timeout(15000)});if(!r.ok)throw Error(`MP GET ${route.split('?')[0]} ${r.status}`);return r.json()}
function mapSubscriptionStatus(s:string){if(s==='canceled'||s==='cancelled')return 'cancelled';return ['pending','authorized','paused','rejected'].includes(s)?s:'pending'}
Deno.serve(async(req)=>{
 if(req.method!=='POST')return json({error:'Método no permitido'},405);
 const secret=Deno.env.get('MP_WEBHOOK_SECRET'),token=Deno.env.get('MP_ACCESS_TOKEN');if(!secret||!token)return json({error:'Configuración incompleta'},503);
 const url=new URL(req.url);let body:Record<string,any>;try{body=await req.json()}catch{return json({error:'JSON inválido'},400)}
 // Use query data.id for HMAC whenever available. Do not silently accept a missing signature.
 const id=url.searchParams.get('data.id')||cleanId(body.data?.id);
 if(!id||!await signatureValid(req,id,secret))return json({error:'Firma inválida'},401);
 const type=String(body.type||body.topic||url.searchParams.get('type')||'');
 const db=createClient(Deno.env.get('SUPABASE_URL')!,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,{auth:{persistSession:false,autoRefreshToken:false}});
 try{
  if(type==='subscription_preapproval'||type==='preapproval'){
   const p=await mpGet(`/preapproval/${encodeURIComponent(id)}`,token);
   if(!p.id||!p.external_reference)return json({ok:true,ignored:true});
   const {data:m,error:findError}=await db.from('memberships').select('id').eq('id',String(p.external_reference)).eq('mp_preapproval_id',String(p.id)).maybeSingle();
   if(findError)throw findError;if(!m)return json({ok:true,ignored:true});
   const status=mapSubscriptionStatus(String(p.status||''));
   const {error}=await db.from('memberships').update({status,last_provider_update:new Date().toISOString()}).eq('id',m.id);if(error)throw error;
   const {error:evError}=await db.from('provider_events').upsert({membership_id:m.id,event_type:'subscription_'+status,mp_resource_id:String(p.id),payload:{status:p.status,last_modified:p.last_modified||null}},{onConflict:'event_type,mp_resource_id'});if(evError)throw evError;
   return json({ok:true});
  }
  if(type==='subscription_authorized_payment'){
   const a=await mpGet(`/authorized_payments/${encodeURIComponent(id)}`,token);
   const pre=cleanId(a.preapproval_id),invoice=cleanId(a.id);
   if(!pre||!invoice)return json({ok:true,ignored:true});
   const {data:m,error:lookupError}=await db.from('memberships').select('id').eq('mp_preapproval_id',pre).maybeSingle();
   if(lookupError)throw lookupError;if(!m)return json({ok:true,ignored:true});
   const payId=cleanId(a.payment?.id)||null,payStatus=a.payment?.status||null;
   const {error:saveError}=await db.from('subscription_invoices').upsert({membership_id:m.id,mp_authorized_payment_id:invoice,mp_payment_id:payId,
     mp_preapproval_id:pre,status:String(a.status||'unknown'),payment_status:payStatus,amount_ars:Number(a.transaction_amount)||null,
     currency:a.currency_id||'ARS',debit_date:a.debit_date||null,approved_at:payStatus==='approved'?(a.last_modified||new Date().toISOString()):null,updated_at:new Date().toISOString()},{onConflict:'mp_authorized_payment_id'});
   if(saveError)throw saveError;
   const {error:evError}=await db.from('provider_events').upsert({membership_id:m.id,event_type:'invoice',mp_resource_id:invoice,payload:{status:a.status,payment_status:payStatus,amount:a.transaction_amount}},{onConflict:'event_type,mp_resource_id'});
   if(evError)throw evError;return json({ok:true});
  }
  if(type==='payment'){
   const p=await mpGet(`/v1/payments/${encodeURIComponent(id)}`,token);
   const paymentId=cleanId(p.id);if(!paymentId)return json({ok:true,ignored:true});
   let memberId:string|null=null;let invoiceId:string|null=null;
   // Best evidence: an invoice explicitly tied to this payment.
   const {data:known,error:kerr}=await db.from('subscription_invoices').select('id,membership_id').eq('mp_payment_id',paymentId).maybeSingle();if(kerr)throw kerr;
   if(known){memberId=known.membership_id;invoiceId=known.id}
   else {
    const r=await mpGet(`/authorized_payments/search?payment_id=${encodeURIComponent(paymentId)}&limit=10`,token);
    const candidates=Array.isArray(r.results)?r.results:[];
    for(const candidate of candidates){if(cleanId(candidate.payment?.id)!==paymentId)continue;
      const {data:member,error:lookupError}=await db.from('memberships').select('id').eq('mp_preapproval_id',cleanId(candidate.preapproval_id)).maybeSingle();if(lookupError)throw lookupError;
      if(member){memberId=member.id;
       const {data:inv,error:e}=await db.from('subscription_invoices').upsert({membership_id:member.id,mp_authorized_payment_id:cleanId(candidate.id),mp_payment_id:paymentId,mp_preapproval_id:cleanId(candidate.preapproval_id),status:String(candidate.status||'unknown'),payment_status:String(p.status||''),amount_ars:Number(p.transaction_amount)||null,currency:p.currency_id||'ARS',debit_date:candidate.debit_date||null,approved_at:p.status==='approved'?(p.date_approved||new Date().toISOString()):null,updated_at:new Date().toISOString()},{onConflict:'mp_authorized_payment_id'}).select('id').single();if(e)throw e;invoiceId=inv?.id||null;break}
    }
   }
   if(invoiceId){const {error}=await db.from('subscription_invoices').update({payment_status:String(p.status||'unknown'),approved_at:p.status==='approved'?(p.date_approved||new Date().toISOString()):null,updated_at:new Date().toISOString()}).eq('id',invoiceId);if(error)throw error}
   // Save unmatched payments for manual reconciliation, NEVER claim that they belong to a member.
   const {error:e}=await db.from('provider_events').upsert({membership_id:memberId,event_type:'payment',mp_resource_id:paymentId,payload:{status:p.status,amount:p.transaction_amount,currency:p.currency_id,date_approved:p.date_approved,linked:!!memberId}},{onConflict:'event_type,mp_resource_id'});if(e)throw e;
   return json({ok:true,linked:!!memberId});
  }
  return json({ok:true,ignored:true});
 }catch(err){console.error('WEBHOOK_PROCESSING_FAILED',err instanceof Error?err.message:'unknown');return json({error:'No pudo procesarse la notificación; el proveedor puede reintentar'},502)}
});
