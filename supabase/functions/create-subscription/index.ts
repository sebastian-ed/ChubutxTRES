import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
const headers={'Access-Control-Allow-Origin':Deno.env.get('SITE_ORIGIN')||'https://example.com','Access-Control-Allow-Headers':'authorization, x-client-info, apikey, content-type','Access-Control-Allow-Methods':'POST, OPTIONS','Content-Type':'application/json'};
const respond=(data:unknown,status=200)=>new Response(JSON.stringify(data),{status,headers});
Deno.serve(async req=>{
 if(req.method==='OPTIONS')return new Response(null,{headers});
 if(req.method!=='POST')return respond({error:'Method not allowed'},405);
 const url=Deno.env.get('SUPABASE_URL')!, anon=Deno.env.get('SUPABASE_ANON_KEY')!,service=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, token=Deno.env.get('MP_ACCESS_TOKEN'),site=Deno.env.get('SITE_URL');
 if(!token||!site)return respond({error:'Proveedor de pagos no configurado'},503);
 const client=createClient(url,anon,{global:{headers:{Authorization:req.headers.get('Authorization')||''}}});
 const admin=createClient(url,service);
 const {data:{user},error:authError}=await client.auth.getUser();if(authError||!user)return respond({error:'Iniciá sesión para suscribirte'},401);
 let input:Record<string,unknown>;try{input=await req.json()}catch{return respond({error:'JSON inválido'},400)}
 if(typeof input.category_id!=='string')return respond({error:'Categoría inválida'},400);
 const {data:profile}=await admin.from('profiles').select('organization,full_name').eq('id',user.id).single();
 if(!profile?.organization?.trim())return respond({error:'Completá la razón social antes de suscribirte'},400);
 const {data:category,error:categoryError}=await admin.from('membership_categories').select('id,name,price_ars,frequency').eq('id',input.category_id).eq('active',true).single();
 if(categoryError||!category||category.price_ars<=0)return respond({error:'Membresía no habilitada'},400);
 const {data:existing}=await admin.from('memberships').select('id,status').eq('user_id',user.id).in('status',['creating','pending','authorized','paused']).limit(1);
 if(existing?.length)return respond({error:'Ya existe una membresía abierta para este usuario'},409);
 const {data:m,error:insertError}=await admin.from('memberships').insert({user_id:user.id,category_id:category.id,amount_ars:category.price_ars,frequency:category.frequency,status:'creating'}).select('id').single();
 if(insertError||!m)return respond({error:'No fue posible crear la membresía'},409);
 const payload={reason:`ChubutxTRES — ${category.name}`,external_reference:m.id,payer_email:user.email,back_url:`${site.replace(/\/$/,'')}/#/pago/retorno`,auto_recurring:{frequency:1,frequency_type:category.frequency,transaction_amount:category.price_ars,currency_id:'ARS'},status:'pending'};
 try{
  const response=await fetch('https://api.mercadopago.com/preapproval',{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json','X-Idempotency-Key':m.id},body:JSON.stringify(payload)});
  const data=await response.json();
  if(!response.ok||!data.id||!data.init_point){await admin.from('memberships').update({status:'error'}).eq('id',m.id);return respond({error:'Mercado Pago no pudo iniciar la suscripción; verificá credenciales y configuración.'},502)}
  await admin.from('memberships').update({status:'pending',mp_preapproval_id:String(data.id),mp_init_point:String(data.init_point),last_provider_update:new Date().toISOString()}).eq('id',m.id);
  return respond({init_point:data.init_point,membership_id:m.id});
 }catch(e){await admin.from('memberships').update({status:'error'}).eq('id',m.id);return respond({error:'Fallo de comunicación con Mercado Pago'},502)}
});
