import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
const origin = Deno.env.get('SITE_ORIGIN') || 'https://sebastian-ed.github.io';
const cors = { 'Access-Control-Allow-Origin': origin, 'Vary': 'Origin', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type', 'Access-Control-Allow-Methods':'POST, OPTIONS', 'Content-Type':'application/json' };
const reply=(value:unknown,status=200)=>new Response(JSON.stringify(value),{status,headers:cors});
const allowedFrequency = (v:string)=>v==='months'||v==='years';
const safeEmail=(v:unknown)=>typeof v==='string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v) && v.length<=254;
async function providerResponse(response:Response){const txt=await response.text();try{return JSON.parse(txt)}catch{return {message:'Respuesta no JSON del proveedor'}}}
Deno.serve(async(req)=>{
 if(req.method==='OPTIONS') return new Response(null,{status:204,headers:cors});
 if(req.method!=='POST') return reply({error:'Método no permitido'},405);
 const token=Deno.env.get('MP_ACCESS_TOKEN'),site=Deno.env.get('SITE_URL');
 if(!token||!site) return reply({error:'Mercado Pago no está configurado'},503);
 if(!/^https:\/\//.test(site)) return reply({error:'SITE_URL debe ser HTTPS'},503);
 const authHeader=req.headers.get('Authorization')||'';
 if(!authHeader.startsWith('Bearer ')) return reply({error:'Debés iniciar sesión'},401);
 const url=Deno.env.get('SUPABASE_URL')!, anon=Deno.env.get('SUPABASE_ANON_KEY')!, service=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
 const client=createClient(url,anon,{global:{headers:{Authorization:authHeader}}});
 const db=createClient(url,service,{auth:{persistSession:false,autoRefreshToken:false}});
 const {data:{user},error:authError}=await client.auth.getUser();
 if(authError||!user) return reply({error:'Sesión inválida. Iniciá sesión nuevamente.'},401);
 let payload:Record<string,unknown>;
 try{payload=await req.json()}catch{return reply({error:'Solicitud inválida'},400)}
 if(typeof payload.category_id!=='string'||!/^[0-9a-f-]{36}$/i.test(payload.category_id)) return reply({error:'Categoría inválida'},400);
 const [{data:profile,error:profileError},{data:category,error:categoryError}]=await Promise.all([
   db.from('profiles').select('organization,full_name').eq('id',user.id).maybeSingle(),
   db.from('membership_categories').select('id,name,price_ars,frequency').eq('id',payload.category_id).eq('active',true).maybeSingle()
 ]);
 if(profileError||!profile?.organization?.trim()) return reply({error:'Completá y guardá la razón social antes de suscribirte'},400);
 if(categoryError||!category||!Number.isSafeInteger(category.price_ars)||category.price_ars<=0||!allowedFrequency(category.frequency))return reply({error:'Categoría no habilitada o importe inválido'},400);
 const testMode=Deno.env.get('MP_TEST_MODE')==='true';
 const payerEmail=testMode?Deno.env.get('MP_TEST_PAYER_EMAIL')?.trim():user.email;
 if(!safeEmail(payerEmail)) return reply({error:testMode?'MP_TEST_PAYER_EMAIL no contiene un correo válido':'La cuenta no tiene un correo válido'},503);
 // The unique partial DB index serializes concurrent requests. Never rely on SELECT alone.
 const {data:prior,error:priorError}=await db.from('memberships').select('id,status,mp_init_point,created_at').eq('user_id',user.id).in('status',['creating','pending','authorized','paused']).order('created_at',{ascending:false}).limit(1);
 if(priorError)return reply({error:'No pudimos verificar las adhesiones existentes'},500);
 if(prior?.length){const p=prior[0]; if(p.status==='pending'&&p.mp_init_point)return reply({init_point:p.mp_init_point,membership_id:p.id,reused:true});return reply({error:'Ya tenés una adhesión en trámite o activa. Revisá Mi cuenta antes de iniciar otra.'},409)}
 const {data:member,error:insertError}=await db.from('memberships').insert({user_id:user.id,category_id:category.id,amount_ars:category.price_ars,frequency:category.frequency,status:'creating'}).select('id').single();
 if(insertError||!member)return reply({error:'No se pudo crear la adhesión; verificá si ya tenés una abierta'},409);
 const body={reason:`ChubutxTRES — ${category.name}`, external_reference:member.id,payer_email:payerEmail,
  back_url:`${site.replace(/\/$/,'')}/#/pago/retorno`,
  auto_recurring:{frequency:1,frequency_type:category.frequency,transaction_amount:category.price_ars,currency_id:'ARS'},status:'pending'};
 try{
  const response=await fetch('https://api.mercadopago.com/preapproval',{method:'POST',headers:{'Authorization':`Bearer ${token}`,'Content-Type':'application/json','X-Idempotency-Key':member.id},body:JSON.stringify(body),signal:AbortSignal.timeout(18000)});
  const data=await providerResponse(response);
  if(!response.ok || !data?.id || !data?.init_point){
   console.error('MP_PREAPPROVAL_REJECTED',JSON.stringify({status:response.status,code:data?.error||data?.code||null,description:String(data?.message||'').slice(0,300)}));
   await db.from('memberships').update({status:'error'}).eq('id',member.id);
   return reply({error:'Mercado Pago rechazó la suscripción. Revisá el registro MP_PREAPPROVAL_REJECTED en Supabase.',provider_status:response.status,provider_message: String(data?.message||'').slice(0,180)},502);
  }
  const {error:saveError}=await db.from('memberships').update({status:'pending',mp_preapproval_id:String(data.id),mp_init_point:String(data.init_point),last_provider_update:new Date().toISOString()}).eq('id',member.id);
  if(saveError){console.error('MP_CREATED_DB_SAVE_FAILED',JSON.stringify({membership_id:member.id,mp_preapproval_id:String(data.id)}));return reply({error:'Mercado Pago creó una suscripción pero falló su registro local. No repitas el pago; contactá a administración.'},500)}
  return reply({init_point:data.init_point,membership_id:member.id});
 }catch(err){console.error('MP_REQUEST_FAILED',err instanceof Error?err.message:'desconocido');
  // Network timeouts are ambiguous: do not mark as error or create a second subscription automatically.
  return reply({error:'No pudimos confirmar la respuesta de Mercado Pago. No vuelvas a pagar hasta que administración revise la solicitud.'},504);
 }
});
