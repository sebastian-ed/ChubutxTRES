import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
const origin=Deno.env.get('SITE_ORIGIN')||'https://sebastian-ed.github.io';
const headers={'Access-Control-Allow-Origin':origin,'Vary':'Origin','Access-Control-Allow-Headers':'authorization, x-client-info, apikey, content-type','Access-Control-Allow-Methods':'POST, OPTIONS','Content-Type':'application/json'};
const reply=(v:unknown,status=200)=>new Response(JSON.stringify(v),{status,headers});
const emailOk=(s:unknown)=>typeof s==='string'&&s.length<=254&&/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
Deno.serve(async req=>{
 if(req.method==='OPTIONS')return new Response(null,{status:204,headers});
 if(req.method!=='POST')return reply({error:'Método no permitido'},405);
 const bearer=req.headers.get('Authorization')||'';
 if(!bearer.startsWith('Bearer '))return reply({error:'Iniciá sesión'},401);
 const token=Deno.env.get('MP_ACCESS_TOKEN'),site=Deno.env.get('SITE_URL');
 if(!token||!site||!/^https:\/\//.test(site))return reply({error:'Configuración de pagos incompleta'},503);
 const url=Deno.env.get('SUPABASE_URL')!,anon=Deno.env.get('SUPABASE_ANON_KEY')!,service=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
 const auth=createClient(url,anon,{global:{headers:{Authorization:bearer}}});
 const db=createClient(url,service,{auth:{persistSession:false,autoRefreshToken:false}});
 const {data:{user},error:authError}=await auth.auth.getUser();
 if(authError||!user||!emailOk(user.email))return reply({error:'Iniciá sesión con un correo verificado'},401);
 let body:Record<string,unknown>;try{body=await req.json()}catch{return reply({error:'Solicitud inválida'},400)}
 // 1 ARS allowed as test; provider may enforce a higher minimum for some payment methods.
 const amount=body.amount_ars;
 if(typeof amount!=='number'||!Number.isSafeInteger(amount)||amount<1||amount>100000000)return reply({error:'El aporte debe ser un importe entero entre $1 y $100.000.000'},400);
 const {data:profile,error:profileError}=await db.from('profiles').select('organization,full_name').eq('id',user.id).maybeSingle();
 if(profileError||!profile?.organization?.trim())return reply({error:'Completá y guardá la razón social antes de aportar'},400);
 const {data:contribution,error:insertError}=await db.from('one_time_contributions').insert({user_id:user.id,amount_ars:amount,status:'creating'}).select('id').single();
 if(insertError||!contribution)return reply({error:'No fue posible registrar el aporte'},500);
 const base=site.replace(/\/$/,'');
 const preference={items:[{id:'aporte-chubutxtres',title:'Aporte único a ChubutxTRES',quantity:1,currency_id:'ARS',unit_price:amount}],
  external_reference:contribution.id,payer:{email:user.email},
  back_urls:{success:base+'/#/aporte/retorno',pending:base+'/#/aporte/retorno',failure:base+'/#/aporte/retorno'},
  auto_return:'approved',metadata:{source:'chubutxtres',kind:'one_time_contribution',contribution_id:contribution.id}};
 try{
  const response=await fetch('https://api.mercadopago.com/checkout/preferences',{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json','X-Idempotency-Key':contribution.id},body:JSON.stringify(preference),signal:AbortSignal.timeout(18000)});
  const text=await response.text();let data:Record<string,any>={};try{data=JSON.parse(text)}catch{}
  if(!response.ok||!data?.id||!data?.init_point){
   console.error('MP_ONE_TIME_PREFERENCE_REJECTED',JSON.stringify({http_status:response.status,code:data.error||null,message:String(data.message||'').slice(0,250)}));
   await db.from('one_time_contributions').update({status:'error',provider_detail:'Mercado Pago rechazó la preferencia'}).eq('id',contribution.id);
   return reply({error:'Mercado Pago rechazó el aporte. Revisá MP_ONE_TIME_PREFERENCE_REJECTED en Logs.',provider_status:response.status},502);
  }
  const {error:saveError}=await db.from('one_time_contributions').update({status:'pending',mp_preference_id:String(data.id),mp_init_point:String(data.init_point),updated_at:new Date().toISOString()}).eq('id',contribution.id);
  if(saveError){console.error('MP_ONE_TIME_DB_SAVE_FAILED',contribution.id);return reply({error:'El proveedor creó el checkout, pero falló el registro. No repitas el aporte; avisá a administración.'},500)}
  return reply({init_point:String(data.init_point),contribution_id:contribution.id});
 }catch(e){console.error('MP_ONE_TIME_NETWORK_ERROR',e instanceof Error?e.message:'unknown');return reply({error:'No podemos confirmar la operación; consultá a administración antes de reintentar'},504)}
});
